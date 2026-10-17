import { FmsDoerAssignment, FmsTask, FMS_TASK_STATUS } from './fmsDoer.model.js';
import { FMS_CATALOG, ENTITY_TYPES, getFms, getStep } from './fmsCatalog.js';
import User from '../auth/auth.model.js';
import AuditLog from '../audit-logs/audit-log.model.js';
import { notificationsService } from '../notifications/notification.service.js';
import { computeEffectivePermissions } from '../../middleware/permission.middleware.js';
import { ROOT_PERMISSION } from '../../common/permissions/registry.js';
import { o2dFmsService } from '../o2d-fms/o2d-fms.service.js';
import { AppError } from '../../utils/apiResponse.js';
import { logger } from '../../utils/logger.js';

const ACTIVE = { isActive: true, isDeleted: false };
const USER_FIELDS = 'name email role roles permissionGrants permissionDenies isActive';
const O2D_ACTIVE_FMS_KEY = process.env.O2D_ACTIVE_FMS || 'CURRENT_SHEET'; // same switch o2d-fms.service uses

const isUserActive = (u) => Boolean(u) && u.isActive !== false;
const userBrief = (u) => (u ? { _id: u._id, name: u.name || '', email: u.email || '', isActive: u.isActive !== false } : null);

const requireEditableFms = (fmsKey) => {
  const fms = getFms(fmsKey);
  if (!fms) throw new AppError(`Unknown FMS "${fmsKey}"`, 404);
  if (!fms.editable) throw new AppError(`${fms.label} doers are configured in its own step catalog`, 400);
  return fms;
};
const requireStep = (fmsKey, stepKey) => {
  const fms = requireEditableFms(fmsKey);
  const step = getStep(fms.key, stepKey);
  if (!step) throw new AppError(`Step "${stepKey}" does not exist in ${fms.label}`, 404);
  return { fms, step };
};

/**
 * Does `user` hold the permissions a step declares? Uses the same effective-
 * permission resolution as the API guards (roles + grants − denies, root '*').
 * Returns OK | NOT_GATED (step has no permission in current RBAC) | MISSING.
 */
const permissionStatus = async (user, step) => {
  const declared = step.permissions || [];
  if (!declared.length) return { status: 'NOT_GATED', missing: [], missingEnforced: [] };
  const perms = await computeEffectivePermissions(user);
  const has = (slug) => perms.has(ROOT_PERMISSION) || perms.has(slug);
  const missing = declared.filter((p) => !has(p.slug));
  return {
    status: missing.length ? 'MISSING' : 'OK',
    missing: missing.map((p) => p.slug),
    missingEnforced: missing.filter((p) => p.enforced).map((p) => p.slug),
  };
};

const audit = (entry) => AuditLog.create({ module: 'fms-doers', ...entry })
  .catch((err) => logger.error(`[fms-doers] audit write failed: ${err.message}`));

const taskKey = (entityType, entityId) => `${entityType}:${entityId}`;

const notifyTask = (userId, fms, step, task) => notificationsService.notify(userId, {
  type: 'TASK_ASSIGNED',
  title: `${fms.label} task assigned: ${step.label}`,
  body: `${ENTITY_TYPES[task.entityType]?.label || task.entityType} ${task.entityRef || ''} is waiting for your action.`.replace(/\s+/g, ' ').trim(),
  link: task.entityLink || null,
});

/** stepKey → active doer user (only if that user is still active). */
const activeDoerMap = async (fmsKey) => {
  const rows = await FmsDoerAssignment.find({ fmsKey, ...ACTIVE, doerUserId: { $ne: null } }).lean();
  const users = await User.find({ _id: { $in: rows.map((r) => r.doerUserId) } }).select('name isActive').lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));
  const out = new Map();
  for (const r of rows) {
    const u = byId.get(String(r.doerUserId));
    if (isUserActive(u)) out.set(r.stepKey, u);
  }
  return out;
};

// ── Serialized sync queue — one reconcile at a time, each with its own actor ──
let syncChain = Promise.resolve();

export const fmsDoerService = {
  // ═══════════════════════════════ Catalog ═══════════════════════════════
  listCatalogs() {
    return Object.values(FMS_CATALOG).map((f) => ({
      key: f.key, label: f.label, editable: f.editable, configLinks: f.configLinks || [],
      stepCount: f.steps.length,
    }));
  },

  /** O2D: read-only view of its existing doer configuration (no second source of truth). */
  async o2dSteps() {
    const defs = await o2dFmsService.listDefinitions(O2D_ACTIVE_FMS_KEY);
    const templates = await o2dFmsService.listTemplates(O2D_ACTIVE_FMS_KEY);
    const tpl = (templates || []).find((t) => t.isDefault && t.isActive !== false) || null;
    const tplStep = new Map((tpl?.steps || []).map((s) => [s.stepCode, s]));
    const ids = new Set();
    defs.forEach((d) => { const id = d.defaultOwnerUserId?._id || d.defaultOwnerUserId; if (id) ids.add(String(id)); });
    tplStep.forEach((s) => (s.assigneeUserIds?.length ? s.assigneeUserIds : [s.assigneeUserId]).filter(Boolean).forEach((id) => ids.add(String(id))));
    const users = await User.find({ _id: { $in: [...ids] } }).select('name email isActive').lean();
    const byId = new Map(users.map((u) => [String(u._id), u]));
    return defs.filter((d) => d.isActive !== false).map((d, i) => {
      const t = tplStep.get(d.stepCode);
      const tplIds = (t?.assigneeUserIds?.length ? t.assigneeUserIds : [t?.assigneeUserId]).filter(Boolean);
      // Mirrors O2D's own resolution order: template assignees, then the
      // definition's default owner user, then its default role.
      const doers = tplIds.length
        ? tplIds.map((id) => userBrief(byId.get(String(id)))).filter(Boolean)
        : [userBrief(byId.get(String(d.defaultOwnerUserId?._id || d.defaultOwnerUserId)))].filter(Boolean);
      return {
        sequence: d.sequence || i + 1,
        stepKey: d.stepCode, code: d.stepCode, label: d.name,
        doers,
        doerRole: !doers.length ? (t?.assigneeRole || d.defaultOwnerRole || null) : null,
        source: tplIds.length ? `Task template "${tpl.name}"` : (d.defaultOwnerUserId ? 'Step Builder default owner' : (d.defaultOwnerRole ? 'Step Builder default role' : '')),
      };
    });
  },

  // ═══════════════════════════════ Config ════════════════════════════════
  async listAssignments(fmsKey) {
    const fms = getFms(fmsKey);
    if (!fms) throw new AppError(`Unknown FMS "${fmsKey}"`, 404);
    if (!fms.editable) return { fms: { key: fms.key, label: fms.label, editable: false, configLinks: fms.configLinks }, steps: await this.o2dSteps() };

    const rows = await FmsDoerAssignment.find({ fmsKey: fms.key, ...ACTIVE }).lean();
    const byStep = new Map(rows.map((r) => [r.stepKey, r]));
    const users = await User.find({ _id: { $in: rows.map((r) => r.doerUserId).filter(Boolean) } }).select(USER_FIELDS).lean();
    const userById = new Map(users.map((u) => [String(u._id), u]));

    const counts = await FmsTask.aggregate([
      { $match: { fmsKey: fms.key, status: FMS_TASK_STATUS.OPEN } },
      { $group: { _id: { stepKey: '$stepKey', doer: '$assignedDoerId' }, n: { $sum: 1 } } },
    ]);

    const steps = [];
    for (const step of fms.steps) {
      const row = byStep.get(step.key);
      const doer = row?.doerUserId ? userById.get(String(row.doerUserId)) : null;
      const perm = doer ? await permissionStatus(doer, step) : null;
      const mine = counts.filter((c) => c._id.stepKey === step.key);
      const open = mine.reduce((s, c) => s + c.n, 0);
      const withDoer = doer ? mine.filter((c) => String(c._id.doer) === String(doer._id)).reduce((s, c) => s + c.n, 0) : 0;
      const unassigned = mine.filter((c) => !c._id.doer).reduce((s, c) => s + c.n, 0);
      steps.push({
        sequence: step.sequence, stepKey: step.key, code: step.code, label: step.label, description: step.description,
        permissions: step.permissions,
        doer: userBrief(doer),
        status: !row?.doerUserId ? 'UNASSIGNED' : (isUserActive(doer) ? 'ASSIGNED' : 'DOER_INACTIVE'),
        permissionStatus: perm?.status || (step.permissions.length ? null : 'NOT_GATED'),
        missingPermissions: perm?.missing || [],
        updatedAt: row?.updatedAt || null,
        openTasks: { total: open, withConfiguredDoer: withDoer, unassigned, withOtherDoer: open - withDoer - unassigned },
      });
    }
    return { fms: { key: fms.key, label: fms.label, editable: true }, steps };
  },

  /** Active users with their permission status for a step (for the doer picker). */
  async assignableUsers(fmsKey, stepKey) {
    const { step } = requireStep(fmsKey, stepKey);
    const users = await User.find({ isActive: { $ne: false } }).select(USER_FIELDS).sort('name').lean();
    const out = [];
    for (const u of users) {
      const perm = await permissionStatus(u, step);
      out.push({ ...userBrief(u), role: u.role || '', permissionStatus: perm.status, missingPermissions: perm.missing });
    }
    return out;
  },

  async setAssignment(fmsKey, stepKey, { doerUserId = null, reason = '', acknowledgeMissingPermission = false }, actor) {
    const { fms, step } = requireStep(fmsKey, stepKey);

    let user = null; let perm = null;
    if (doerUserId) {
      user = await User.findById(doerUserId).select(USER_FIELDS).lean();
      if (!user) throw new AppError('User not found', 404);
      if (!isUserActive(user)) throw new AppError('This user is inactive and cannot be assigned as a doer', 400);
      perm = await permissionStatus(user, step);
      if (perm.missingEnforced.length) {
        throw new AppError(`This user does not have the permission required to perform this step (${perm.missingEnforced.join(', ')})`, 400);
      }
      if (perm.missing.length && !acknowledgeMissingPermission) {
        throw new AppError(`This user does not currently have permission to perform this step (${perm.missing.join(', ')}). Confirm to assign anyway.`, 409);
      }
    }

    const filter = { fmsKey: fms.key, stepKey: step.key, ...ACTIVE };
    const existing = await FmsDoerAssignment.findOne(filter);
    const prev = existing?.doerUserId || null;
    if (String(prev || '') === String(doerUserId || '')) {
      throw new AppError(user ? `${user.name} is already the doer for this step` : 'This step is already unassigned', 400);
    }

    const entry = {
      action: !prev ? 'ASSIGNED' : (doerUserId ? 'REASSIGNED' : 'UNASSIGNED'),
      fromUserId: prev, toUserId: doerUserId || null,
      byUserId: actor?._id, byName: actor?.name || '',
      reason: reason || '',
      note: perm?.missing?.length ? `Assigned without permission: ${perm.missing.join(', ')} (acknowledged)` : '',
      at: new Date(),
    };

    let doc;
    if (existing) {
      existing.doerUserId = doerUserId || null;
      existing.updatedBy = actor?._id;
      existing.history.push(entry);
      doc = await existing.save();
    } else {
      try {
        doc = await FmsDoerAssignment.create({ ...filter, doerUserId: doerUserId || null, createdBy: actor?._id, updatedBy: actor?._id, history: [entry] });
      } catch (err) {
        if (err?.code === 11000) throw new AppError('This step was just assigned by someone else — refresh and try again', 409);
        throw err;
      }
    }

    await audit({
      entityName: 'FmsDoerAssignment', entityId: doc._id, action: existing ? 'UPDATE' : 'CREATE',
      oldValue: { fmsKey: fms.key, stepKey: step.key, doerUserId: prev },
      newValue: { fmsKey: fms.key, stepKey: step.key, doerUserId: doerUserId || null, reason: reason || '', permissionWarning: entry.note || '' },
      updatedBy: actor?._id,
    });

    // Report (never touch) the open work already on this step.
    const open = await FmsTask.find({ fmsKey: fms.key, stepKey: step.key, status: FMS_TASK_STATUS.OPEN }).select('assignedDoerId').lean();
    return {
      assignment: { fmsKey: fms.key, stepKey: step.key, doer: userBrief(user), updatedAt: doc.updatedAt },
      permissionWarning: perm?.missing?.length ? perm.missing : [],
      openTasks: {
        total: open.length,
        notWithNewDoer: open.filter((t) => String(t.assignedDoerId || '') !== String(doerUserId || '')).length,
      },
    };
  },

  async assignmentHistory(fmsKey, stepKey) {
    const { fms, step } = requireStep(fmsKey, stepKey);
    const row = await FmsDoerAssignment.findOne({ fmsKey: fms.key, stepKey: step.key, ...ACTIVE })
      .populate('history.fromUserId', 'name').populate('history.toUserId', 'name').populate('history.byUserId', 'name').lean();
    return (row?.history || []).slice().reverse().map((h) => ({
      action: h.action, at: h.at, reason: h.reason, note: h.note,
      from: h.fromUserId ? { _id: h.fromUserId._id, name: h.fromUserId.name } : null,
      to: h.toUserId ? { _id: h.toUserId._id, name: h.toUserId.name } : null,
      by: h.byUserId ? { _id: h.byUserId._id, name: h.byUserId.name } : (h.byName ? { name: h.byName } : null),
    }));
  },

  // ═══════════════════════════════ Runtime sync ══════════════════════════
  /**
   * Reconcile tasks with the workflow: open a task (doer snapshotted from the
   * config) for every item now waiting at a step, and resolve open tasks whose
   * item has moved on. Reads workflow documents only.
   *   actor     — authenticated user whose action triggered the sync; recorded
   *               as the actual performer of tasks resolved by it
   *   notify    — send TASK_ASSIGNED notifications for newly opened tasks
   *   openedVia — WORKFLOW (request-triggered) | SYNC (startup / periodic)
   */
  async syncFms(fmsKey, { actor = null, notify = true, openedVia = 'WORKFLOW' } = {}) {
    const fms = getFms(fmsKey);
    if (!fms?.editable) return { opened: 0, resolved: 0 };
    const doerMap = await activeDoerMap(fms.key);
    let opened = 0; let resolved = 0;

    for (const step of fms.steps) {
      const pending = new Map();
      let failed = false;
      for (const src of step.sources) {
        try {
          const docs = await src.find();
          for (const d of docs) pending.set(taskKey(src.entityType, d._id), { entityType: src.entityType, doc: d });
        } catch (err) {
          // A failed source must not be read as "nothing pending" — skip the step.
          logger.error(`[fms-doers] ${fms.key}/${step.key} source ${src.entityType} failed: ${err.message}`);
          failed = true;
        }
      }
      if (failed) continue;

      const open = await FmsTask.find({ fmsKey: fms.key, stepKey: step.key, status: FMS_TASK_STATUS.OPEN }).lean();
      const openKeys = new Set(open.map((t) => taskKey(t.entityType, t.entityId)));

      for (const [k, { entityType, doc }] of pending) {
        if (openKeys.has(k)) continue;
        if (await this._openTask(fms, step, entityType, doc, doerMap.get(step.key) || null, { notify, openedVia })) opened += 1;
      }
      for (const t of open) {
        if (pending.has(taskKey(t.entityType, t.entityId))) continue;
        if (await this._resolveTask(t, actor)) resolved += 1;
      }
    }

    // Open tasks on a step that no longer exists in the catalog (e.g. the retired
    // Service Completion step) would never be reconciled — close them.
    const now = new Date();
    const retired = await FmsTask.updateMany(
      { fmsKey: fms.key, status: FMS_TASK_STATUS.OPEN, stepKey: { $nin: fms.steps.map((s) => s.key) } },
      {
        $set: { status: FMS_TASK_STATUS.CLOSED, completedAt: now, closedReason: 'Step removed from the workflow' },
        $push: { history: { action: 'CLOSED', at: now, note: 'Step removed from the workflow' } },
      },
    );
    resolved += retired.modifiedCount || 0;
    return { opened, resolved };
  },

  async _openTask(fms, step, entityType, doc, doer, { notify, openedVia }) {
    const et = ENTITY_TYPES[entityType];
    const now = new Date();
    let task;
    try {
      task = await FmsTask.create({
        fmsKey: fms.key, stepKey: step.key, stepCode: step.code, stepLabel: step.label, sequence: step.sequence,
        entityType, entityId: doc._id, entityRef: et.ref(doc), entityLink: et.link(doc), summary: et.summary(doc),
        status: FMS_TASK_STATUS.OPEN,
        assignedDoerId: doer?._id || null, assignedAt: doer ? now : null,
        assignmentSource: doer ? 'CONFIG' : 'NONE',
        openedAt: now, openedVia,
        history: [{
          action: doer ? 'ASSIGNED' : 'UNASSIGNED', toUserId: doer?._id || null, at: now,
          note: doer ? 'Assigned from the step doer configuration' : 'No active doer configured for this step',
        }],
      });
    } catch (err) {
      if (err?.code === 11000) return false; // another sync opened it first
      throw err;
    }
    if (doer && notify) await notifyTask(doer._id, fms, step, task);
    return true;
  },

  async _resolveTask(task, actor) {
    const et = ENTITY_TYPES[task.entityType];
    const entity = et ? await et.model.findById(task.entityId).lean() : null;
    const closed = !entity || et.terminated(entity);
    let performerId = actor?._id || null;
    let performerName = actor?.name || '';
    if (!performerId && entity?.updatedBy) {
      performerId = entity.updatedBy;
      performerName = (await User.findById(performerId).select('name').lean())?.name || '';
    }
    const now = new Date();
    const res = await FmsTask.updateOne(
      { _id: task._id, status: FMS_TASK_STATUS.OPEN },
      {
        $set: {
          status: closed ? FMS_TASK_STATUS.CLOSED : FMS_TASK_STATUS.DONE,
          completedAt: now, completedById: performerId, completedByName: performerName,
          closedReason: closed ? (!entity || entity.isDeleted ? 'Item deleted' : 'Item cancelled / rejected') : '',
        },
        $push: {
          history: {
            action: closed ? 'CLOSED' : 'COMPLETED', byUserId: performerId, byName: performerName, at: now,
            note: closed ? 'Item left the step without completing it' : 'Item moved past this step',
          },
        },
      },
    );
    return res.modifiedCount > 0;
  },

  /** Queue a reconcile of every editable FMS (serialized; never throws). */
  enqueueSync(opts = {}) {
    syncChain = syncChain
      .then(async () => {
        for (const fms of Object.values(FMS_CATALOG)) {
          if (fms.editable) await this.syncFms(fms.key, opts);
        }
      })
      .catch((err) => logger.error(`[fms-doers] sync failed: ${err.message}`));
    return syncChain;
  },

  // ═══════════════════════════════ Tasks ═════════════════════════════════
  _populate(q) {
    return q.populate('assignedDoerId', 'name email isActive').populate('completedById', 'name');
  },

  async myTasks(user) {
    const tasks = await this._populate(FmsTask.find({ assignedDoerId: user._id, status: FMS_TASK_STATUS.OPEN }))
      .sort({ fmsKey: 1, sequence: 1, openedAt: 1 }).lean();
    // Flag steps the user is assigned to but lacks the declared permission for.
    const warnings = {};
    for (const t of tasks) {
      const key = `${t.fmsKey}:${t.stepKey}`;
      if (warnings[key] !== undefined) continue;
      const step = getStep(t.fmsKey, t.stepKey);
      warnings[key] = step ? (await permissionStatus(user, step)).missing : [];
    }
    return tasks.map((t) => ({
      ...t, fmsLabel: getFms(t.fmsKey)?.label || t.fmsKey,
      missingPermissions: warnings[`${t.fmsKey}:${t.stepKey}`] || [],
    }));
  },

  async listTasks(query = {}) {
    const filter = {};
    if (query.fmsKey) filter.fmsKey = String(query.fmsKey).toUpperCase();
    if (query.stepKey) filter.stepKey = String(query.stepKey).toUpperCase();
    filter.status = query.status && query.status !== 'ALL' ? query.status : FMS_TASK_STATUS.OPEN;
    if (query.status === 'ALL') delete filter.status;
    if (query.doerId === 'none') filter.assignedDoerId = null;
    else if (query.doerId) filter.assignedDoerId = query.doerId;
    if (query.search) filter.entityRef = { $regex: String(query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    const limit = Math.min(Number(query.limit) || 100, 500);
    const page = Math.max(Number(query.page) || 1, 1);
    const [docs, total] = await Promise.all([
      this._populate(FmsTask.find(filter)).sort({ fmsKey: 1, sequence: 1, openedAt: 1 }).skip((page - 1) * limit).limit(limit).lean(),
      FmsTask.countDocuments(filter),
    ]);
    return {
      docs: docs.map((t) => ({ ...t, fmsLabel: getFms(t.fmsKey)?.label || t.fmsKey })),
      pagination: { total, page, limit, pages: Math.ceil(total / limit) || 1 },
    };
  },

  /** Current-step responsibility for one workflow item (detail pages). */
  async tasksByEntity(entityType, entityId) {
    const tasks = await this._populate(FmsTask.find({ entityType, entityId })).sort({ openedAt: -1 }).limit(30).lean();
    return {
      open: tasks.filter((t) => t.status === FMS_TASK_STATUS.OPEN),
      history: tasks.filter((t) => t.status !== FMS_TASK_STATUS.OPEN),
    };
  },

  async reassignTask(id, { doerUserId, reason = '' }, actor) {
    const task = await FmsTask.findById(id).lean();
    if (!task) throw new AppError('Task not found', 404);
    if (task.status !== FMS_TASK_STATUS.OPEN) throw new AppError('Only open tasks can be reassigned', 400);
    const user = await User.findById(doerUserId).select(USER_FIELDS).lean();
    if (!user) throw new AppError('User not found', 404);
    if (!isUserActive(user)) throw new AppError('This user is inactive and cannot be assigned', 400);
    if (String(task.assignedDoerId || '') === String(user._id)) throw new AppError(`${user.name} is already the doer for this task`, 400);
    const step = getStep(task.fmsKey, task.stepKey);
    const perm = step ? await permissionStatus(user, step) : { missing: [], missingEnforced: [] };
    if (perm.missingEnforced.length) {
      throw new AppError(`This user does not have the permission required to perform this step (${perm.missingEnforced.join(', ')})`, 400);
    }

    const now = new Date();
    const res = await FmsTask.updateOne(
      { _id: task._id, status: FMS_TASK_STATUS.OPEN },
      {
        $set: { assignedDoerId: user._id, assignedAt: now, assignmentSource: 'MANUAL' },
        $push: { history: { action: 'REASSIGNED', fromUserId: task.assignedDoerId || null, toUserId: user._id, byUserId: actor?._id, byName: actor?.name || '', reason, at: now } },
      },
    );
    if (!res.modifiedCount) throw new AppError('This task was just completed or changed — refresh and try again', 409);
    await audit({
      entityName: 'FmsTask', entityId: task._id, action: 'UPDATE',
      oldValue: { assignedDoerId: task.assignedDoerId || null },
      newValue: { assignedDoerId: user._id, reason, fmsKey: task.fmsKey, stepKey: task.stepKey, entityRef: task.entityRef },
      updatedBy: actor?._id,
    });
    const fms = getFms(task.fmsKey);
    if (fms && step) await notifyTask(user._id, fms, step, task);
    const fresh = await this._populate(FmsTask.findById(task._id)).lean();
    return { task: fresh, permissionWarning: perm.missing };
  },

  /** Explicitly move a step's open tasks onto its currently configured doer. */
  async applyConfigToOpenTasks(fmsKey, stepKey, { reason = '' }, actor) {
    const { fms, step } = requireStep(fmsKey, stepKey);
    const row = await FmsDoerAssignment.findOne({ fmsKey: fms.key, stepKey: step.key, ...ACTIVE }).lean();
    if (!row?.doerUserId) throw new AppError('Assign a doer to this step first', 400);
    const user = await User.findById(row.doerUserId).select('name isActive').lean();
    if (!isUserActive(user)) throw new AppError('The configured doer is inactive', 400);

    const tasks = await FmsTask.find({
      fmsKey: fms.key, stepKey: step.key, status: FMS_TASK_STATUS.OPEN, assignedDoerId: { $ne: user._id },
    }).select('_id assignedDoerId entityRef').lean();
    const now = new Date();
    let moved = 0;
    for (const t of tasks) {
      const res = await FmsTask.updateOne(
        { _id: t._id, status: FMS_TASK_STATUS.OPEN, assignedDoerId: t.assignedDoerId },
        {
          $set: { assignedDoerId: user._id, assignedAt: now, assignmentSource: 'CONFIG' },
          $push: { history: { action: 'REASSIGNED', fromUserId: t.assignedDoerId || null, toUserId: user._id, byUserId: actor?._id, byName: actor?.name || '', reason, note: 'Applied the step doer configuration to open tasks', at: now } },
        },
      );
      moved += res.modifiedCount;
    }
    await audit({
      entityName: 'FmsDoerAssignment', entityId: row._id, action: 'UPDATE',
      oldValue: { fmsKey: fms.key, stepKey: step.key, openTasksReassigned: 0 },
      newValue: { fmsKey: fms.key, stepKey: step.key, appliedToOpenTasks: moved, doerUserId: user._id, reason },
      updatedBy: actor?._id,
    });
    if (moved) {
      await notificationsService.notify(user._id, {
        type: 'TASK_ASSIGNED',
        title: `${fms.label} tasks assigned: ${step.label}`,
        body: `${moved} pending item(s) at ${step.label} are now waiting for your action.`,
        link: '/fms/my-tasks',
      });
    }
    return { reassigned: moved };
  },
};

export default fmsDoerService;
