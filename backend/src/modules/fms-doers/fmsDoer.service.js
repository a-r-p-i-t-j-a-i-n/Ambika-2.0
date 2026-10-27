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
import { purchaseTaskLink } from './fmsTaskLinks.js';
import {
  stepPlanOf, taskDoerIds, taskBuddyIds, plannedAtFor, isTaskOverdue, normalizePlanRow, sameIds, describePlan,
} from './fmsPlan.rules.js';

const ACTIVE = { isActive: true, isDeleted: false };
const USER_FIELDS = 'name email role roles permissionGrants permissionDenies isActive';
const O2D_ACTIVE_FMS_KEY = process.env.O2D_ACTIVE_FMS || 'CURRENT_SHEET'; // same switch o2d-fms.service uses
const COMPLETED_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // My Tasks → "Completed" looks back this far

const isUserActive = (u) => Boolean(u) && u.isActive !== false;
const userBrief = (u) => (u ? { _id: u._id, name: u.name || '', email: u.email || '', isActive: u.isActive !== false } : null);
// The doer-plan picker's shape (same as O2D's: string `id`).
const personBrief = (u) => (u ? { id: String(u._id), name: u.name || '', email: u.email || '', role: u.role || '', isActive: u.isActive !== false } : null);

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
  link: purchaseTaskLink(task)?.to || task.entityLink || null,
});

/**
 * stepKey → { doers, buddies, leadTime } from the saved plan — only people
 * who are still active (an inactive doer simply gets nothing new).
 */
const activePlanMap = async (fmsKey) => {
  const rows = await FmsDoerAssignment.find({ fmsKey, ...ACTIVE }).lean();
  const plans = rows.map((r) => [r.stepKey, stepPlanOf(r)]);
  const ids = new Set();
  plans.forEach(([, p]) => [...p.doerIds, ...p.buddyIds].forEach((id) => ids.add(id)));
  const users = ids.size ? await User.find({ _id: { $in: [...ids] } }).select('name isActive').lean() : [];
  const byId = new Map(users.filter(isUserActive).map((u) => [String(u._id), u]));
  const pick = (list) => list.map((id) => byId.get(id)).filter(Boolean);
  return new Map(plans.map(([stepKey, p]) => [stepKey, { doers: pick(p.doerIds), buddies: pick(p.buddyIds), leadTime: p.leadTime }]));
};

/**
 * Add the O2D-style read fields to task rows: doers / buddies (legacy-safe),
 * isOverdue, and the record link — checked against the record itself, so a
 * deleted record gives no link (linkIssue says why) instead of a broken page.
 */
const decorateTasks = async (tasks, { now = Date.now(), userId = null } = {}) => {
  const idsByType = new Map();
  for (const t of tasks) {
    if (!ENTITY_TYPES[t.entityType]) continue;
    if (!idsByType.has(t.entityType)) idsByType.set(t.entityType, new Set());
    idsByType.get(t.entityType).add(String(t.entityId));
  }
  const records = new Map(); // `${type}:${id}` → { isDeleted, indentId }
  await Promise.all([...idsByType].map(async ([type, ids]) => {
    const docs = await ENTITY_TYPES[type].model.find({ _id: { $in: [...ids] } }).select('_id isDeleted indentId').lean();
    docs.forEach((d) => records.set(`${type}:${d._id}`, d));
  }));
  const uid = userId ? String(userId) : null;
  return tasks.map((t) => {
    const rec = records.get(`${t.entityType}:${t.entityId}`);
    const gone = !rec || rec.isDeleted;
    const link = gone ? null : purchaseTaskLink(t, { serviceCompletionIndentId: rec.indentId });
    const doers = t.assignedDoerIds?.length ? t.assignedDoerIds : [t.assignedDoerId].filter(Boolean);
    const isDoer = uid ? taskDoerIds(t).includes(uid) : false;
    return {
      ...t,
      doers,
      buddies: t.buddyIds || [],
      fmsLabel: getFms(t.fmsKey)?.label || t.fmsKey,
      isOverdue: isTaskOverdue(t, now),
      link: link?.to || null,
      linkLabel: link?.label || '',
      linkAction: link?.action || '',
      linkIssue: link ? '' : (gone ? 'This record was deleted' : 'No page to open for this record'),
      ...(uid ? { asBuddy: !isDoer && taskBuddyIds(t).includes(uid) } : {}),
    };
  });
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

  // ═══════════════════════ Doer plan (O2D-style grid) ═════════════════════
  // One row per step — lead time, main doers, buddies — edited in place and
  // saved together, like FMS → Doer Assignment → O2D. New items take the plan
  // when they reach a step; items already waiting change only on request
  // ("Also update items already pending" / "Update pending items").

  /** Every step of the FMS with its saved setup and its pending items. */
  async getPlan(fmsKey) {
    const fms = requireEditableFms(fmsKey);
    const rows = await FmsDoerAssignment.find({ fmsKey: fms.key, ...ACTIVE }).lean();
    const byStep = new Map(rows.map((r) => [r.stepKey, r]));
    const ids = new Set();
    rows.forEach((r) => { const p = stepPlanOf(r); [...p.doerIds, ...p.buddyIds].forEach((id) => ids.add(id)); });
    const users = ids.size ? await User.find({ _id: { $in: [...ids] } }).select(USER_FIELDS).lean() : [];
    const userById = new Map(users.map((u) => [String(u._id), u]));
    const open = await FmsTask.find({ fmsKey: fms.key, status: FMS_TASK_STATUS.OPEN })
      .select('stepKey assignedDoerId assignedDoerIds buddyIds').lean();

    const steps = [];
    for (const step of fms.steps) {
      const row = byStep.get(step.key);
      const plan = stepPlanOf(row);
      const people = async (list) => {
        const out = [];
        for (const id of list) {
          const u = userById.get(id);
          if (!u) continue;
          out.push({ ...personBrief(u), missingPermissions: (await permissionStatus(u, step)).missing });
        }
        return out;
      };
      const doers = await people(plan.doerIds);
      const mine = open.filter((t) => t.stepKey === step.key);
      const unassigned = mine.filter((t) => !taskDoerIds(t).length).length;
      steps.push({
        sequence: step.sequence, stepKey: step.key, code: step.code, label: step.label, description: step.description,
        permissions: step.permissions,
        leadTime: plan.leadTime,
        doers,
        buddies: await people(plan.buddyIds),
        status: !doers.length ? 'UNASSIGNED' : (doers.some((d) => d.isActive) ? 'ASSIGNED' : 'DOER_INACTIVE'),
        updatedAt: row?.updatedAt || null,
        openTasks: {
          total: mine.length,
          unassigned,
          // Waiting items whose doers / buddies differ from this setup.
          notOnPlan: plan.doerIds.length
            ? mine.filter((t) => !sameIds(taskDoerIds(t), plan.doerIds) || !sameIds(taskBuddyIds(t), plan.buddyIds)).length
            : 0,
        },
      });
    }
    return { fms: { key: fms.key, label: fms.label, editable: true }, steps };
  },

  /**
   * Active users to pick from, each with the step permissions they lack
   * (missingByStep: { STEP_KEY: [slug] }) — being a doer grants nothing.
   */
  async planUsers(fmsKey) {
    const fms = requireEditableFms(fmsKey);
    const gated = fms.steps.filter((s) => s.permissions?.length);
    const users = await User.find({ isActive: { $ne: false } }).select(USER_FIELDS).sort('name').lean();
    const out = [];
    for (const u of users) {
      const missingByStep = {};
      for (const step of gated) {
        const { missing } = await permissionStatus(u, step);
        if (missing.length) missingByStep[step.key] = missing;
      }
      out.push({ ...personBrief(u), missingByStep });
    }
    return out;
  },

  /**
   * Save the CHANGED steps of the plan: main doers, buddies and (when sent)
   * lead time. Each change is kept in that step's history and the audit log.
   * Enforced permissions are refused (400); advisory ones need
   * acknowledgeMissingPermission (409 otherwise).
   */
  async savePlan(fmsKey, { steps: input = [], applyToOpenTasks = false, acknowledgeMissingPermission = false, reason = '' }, actor) {
    const fms = requireEditableFms(fmsKey);
    const rows = input.map(normalizePlanRow);
    const seen = new Set();
    for (const r of rows) {
      const step = getStep(fms.key, r.stepKey);
      if (!step) throw new AppError(`Step "${r.stepKey}" does not exist in ${fms.label}`, 400);
      if (seen.has(step.key)) throw new AppError(`Step ${step.code} is listed twice`, 400);
      seen.add(step.key);
      if (r.error) throw new AppError(`Step ${step.code} (${step.label}): ${r.error}`, 400);
      r.step = step;
    }

    const ids = new Set();
    rows.forEach((r) => [...r.doerIds, ...r.buddyIds].forEach((id) => ids.add(id)));
    const users = ids.size ? await User.find({ _id: { $in: [...ids] } }).select(USER_FIELDS).lean() : [];
    const userById = new Map(users.map((u) => [String(u._id), u]));
    if ([...ids].some((id) => !isUserActive(userById.get(id)))) {
      throw new AppError('A selected person is not an active user — pick someone else', 400);
    }

    // Permissions: main doers and buddies can both end up doing the step.
    const warnings = [];
    for (const r of rows) {
      for (const id of [...r.doerIds, ...r.buddyIds]) {
        const u = userById.get(id);
        const perm = await permissionStatus(u, r.step);
        if (perm.missingEnforced.length) {
          throw new AppError(`${u.name} does not have the permission required to perform ${r.step.label} (${perm.missingEnforced.join(', ')})`, 400);
        }
        if (perm.missing.length) warnings.push({ stepKey: r.step.key, text: `${u.name} — ${r.step.label} (${perm.missing.join(', ')})` });
      }
    }
    if (warnings.length && !acknowledgeMissingPermission) {
      throw new AppError(`Not everyone picked currently has permission to perform their step: ${warnings.map((w) => w.text).join('; ')}. Confirm to assign anyway.`, 409);
    }

    const names = (list) => list.map((id) => userById.get(id)?.name || id);
    const changed = [];
    for (const r of rows) {
      const filter = { fmsKey: fms.key, stepKey: r.step.key, ...ACTIVE };
      const existing = await FmsDoerAssignment.findOne(filter);
      const before = stepPlanOf(existing);
      const leadTime = r.leadTime !== undefined ? r.leadTime : before.leadTime;
      const sameLead = JSON.stringify(leadTime) === JSON.stringify(before.leadTime);
      if (sameIds(before.doerIds, r.doerIds) && sameIds(before.buddyIds, r.buddyIds) && sameLead) continue;

      const prevFirst = before.doerIds[0] || null;
      const nextFirst = r.doerIds[0] || null;
      const doersChanged = !sameIds(before.doerIds, r.doerIds);
      const stepWarnings = warnings.filter((w) => w.stepKey === r.step.key).map((w) => w.text);
      const entry = {
        action: !doersChanged ? 'UPDATED' : (!before.doerIds.length ? 'ASSIGNED' : (r.doerIds.length ? 'REASSIGNED' : 'UNASSIGNED')),
        fromUserId: prevFirst, toUserId: nextFirst,
        byUserId: actor?._id, byName: actor?.name || '',
        reason: reason || '',
        detail: describePlan({ doers: names(r.doerIds), buddies: names(r.buddyIds), leadTime }),
        note: stepWarnings.length ? `Assigned without permission: ${stepWarnings.join('; ')} (acknowledged)` : '',
        at: new Date(),
      };
      const set = {
        doerUserIds: r.doerIds, doerUserId: nextFirst, backupUserIds: r.buddyIds, leadTime, updatedBy: actor?._id,
      };

      let doc;
      if (existing) {
        Object.assign(existing, set);
        existing.history.push(entry);
        doc = await existing.save();
      } else {
        try {
          doc = await FmsDoerAssignment.create({ ...filter, ...set, createdBy: actor?._id, history: [entry] });
        } catch (err) {
          if (err?.code === 11000) throw new AppError('This step was just changed by someone else — refresh and try again', 409);
          throw err;
        }
      }
      await audit({
        entityName: 'FmsDoerAssignment', entityId: doc._id, action: existing ? 'UPDATE' : 'CREATE',
        oldValue: { fmsKey: fms.key, stepKey: r.step.key, doerUserIds: before.doerIds, buddyIds: before.buddyIds, leadTime: before.leadTime },
        newValue: { fmsKey: fms.key, stepKey: r.step.key, doerUserIds: r.doerIds, buddyIds: r.buddyIds, leadTime, reason: reason || '', permissionWarning: entry.note },
        updatedBy: actor?._id,
      });
      changed.push(r.step.key);
    }

    const openTasksUpdated = applyToOpenTasks && changed.length
      ? await this._applyPlanToOpenTasks(fms, changed, actor, reason || 'Doer Assignment saved with "also update items already pending"')
      : 0;
    return { ...(await this.getPlan(fms.key)), changedSteps: changed, openTasksUpdated };
  },

  /** "Update pending items": the whole saved plan onto every item already waiting. */
  async applyPlanToOpenTasks(fmsKey, { reason = '' } = {}, actor) {
    const fms = requireEditableFms(fmsKey);
    return { openTasksUpdated: await this._applyPlanToOpenTasks(fms, null, actor, reason || 'Applied the doer setup to pending items') };
  },

  /**
   * Items waiting at the given steps (all when null) take that step's main
   * doers and buddies from the plan. A step with no active main doer in the
   * plan is left alone; due dates are not touched (as on O2D). Each move is
   * recorded in the task's history. Returns how many tasks changed.
   */
  async _applyPlanToOpenTasks(fms, stepKeys, actor, reason) {
    const plans = await activePlanMap(fms.key);
    const now = new Date();
    let moved = 0;
    const gained = new Map(); // userId → { n, steps:Set }
    for (const step of fms.steps) {
      if (stepKeys && !stepKeys.includes(step.key)) continue;
      const plan = plans.get(step.key);
      if (!plan?.doers.length) continue;
      const doerIds = plan.doers.map((u) => String(u._id));
      const buddyIds = plan.buddies.map((u) => String(u._id)).filter((id) => !doerIds.includes(id));
      const tasks = await FmsTask.find({ fmsKey: fms.key, stepKey: step.key, status: FMS_TASK_STATUS.OPEN })
        .select('_id assignedDoerId assignedDoerIds buddyIds').lean();
      for (const t of tasks) {
        const had = taskDoerIds(t);
        if (sameIds(had, doerIds) && sameIds(taskBuddyIds(t), buddyIds)) continue;
        const res = await FmsTask.updateOne(
          { _id: t._id, status: FMS_TASK_STATUS.OPEN },
          {
            $set: { assignedDoerId: doerIds[0], assignedDoerIds: doerIds, buddyIds, assignedAt: now, assignmentSource: 'CONFIG' },
            $push: {
              history: {
                action: 'REASSIGNED', fromUserId: had[0] || null, toUserId: doerIds[0],
                byUserId: actor?._id || null, byName: actor?.name || '', reason,
                note: 'Applied the step doer setup to pending items', at: now,
              },
            },
          },
        );
        if (!res.modifiedCount) continue;
        moved += 1;
        doerIds.filter((id) => !had.includes(id)).forEach((id) => {
          const g = gained.get(id) || { n: 0, steps: new Set() };
          g.n += 1; g.steps.add(step.label);
          gained.set(id, g);
        });
      }
    }
    if (moved) {
      await audit({
        entityName: 'FmsTask', entityId: null, action: 'UPDATE',
        oldValue: { fmsKey: fms.key, steps: stepKeys || 'ALL' },
        newValue: { fmsKey: fms.key, appliedToOpenTasks: moved, reason },
        updatedBy: actor?._id,
      });
    }
    for (const [userId, g] of gained) {
      await notificationsService.notify(userId, {
        type: 'TASK_ASSIGNED',
        title: `${fms.label} tasks assigned: ${[...g.steps].join(', ')}`,
        body: `${g.n} pending item(s) are now waiting for your action.`,
        link: '/fms/my-tasks',
      });
    }
    return moved;
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
    if (sameIds(stepPlanOf(existing).doerIds, [doerUserId])) {
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
      // One doer from this (older, single-doer) endpoint: the step's main doers
      // become just that person; buddies and lead time are kept.
      existing.doerUserIds = doerUserId ? [doerUserId] : [];
      existing.backupUserIds = (existing.backupUserIds || []).filter((id) => String(id) !== String(doerUserId || ''));
      existing.updatedBy = actor?._id;
      existing.history.push(entry);
      doc = await existing.save();
    } else {
      try {
        doc = await FmsDoerAssignment.create({
          ...filter, doerUserId: doerUserId || null, doerUserIds: doerUserId ? [doerUserId] : [],
          createdBy: actor?._id, updatedBy: actor?._id, history: [entry],
        });
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
      action: h.action, at: h.at, reason: h.reason, note: h.note, detail: h.detail || '',
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
    const planMap = await activePlanMap(fms.key);
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
        if (await this._openTask(fms, step, entityType, doc, planMap.get(step.key) || null, { notify, openedVia })) opened += 1;
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

  /** plan = { doers, buddies, leadTime } of the step (active people only), or null. */
  async _openTask(fms, step, entityType, doc, plan, { notify, openedVia }) {
    const et = ENTITY_TYPES[entityType];
    const now = new Date();
    const doers = plan?.doers || [];
    const doerIds = doers.map((u) => u._id);
    const buddyIds = (plan?.buddies || []).map((u) => u._id).filter((id) => !doerIds.some((d) => String(d) === String(id)));
    const doer = doers[0] || null;
    let task;
    try {
      task = await FmsTask.create({
        fmsKey: fms.key, stepKey: step.key, stepCode: step.code, stepLabel: step.label, sequence: step.sequence,
        entityType, entityId: doc._id, entityRef: et.ref(doc), entityLink: et.link(doc), summary: et.summary(doc),
        status: FMS_TASK_STATUS.OPEN,
        assignedDoerId: doer?._id || null, assignedDoerIds: doerIds, buddyIds,
        assignedAt: doer ? now : null,
        assignmentSource: doer ? 'CONFIG' : 'NONE',
        openedAt: now, openedVia,
        plannedAt: plannedAtFor(now, plan?.leadTime),
        history: [{
          action: doer ? 'ASSIGNED' : 'UNASSIGNED', toUserId: doer?._id || null, at: now,
          note: doer
            ? `Assigned from the step doer setup${doers.length > 1 ? ` (${doers.map((u) => u.name).join(', ')})` : ''}`
            : 'No active doer configured for this step',
        }],
      });
    } catch (err) {
      if (err?.code === 11000) return false; // another sync opened it first
      throw err;
    }
    if (notify) {
      for (const u of doers) await notifyTask(u._id, fms, step, task);
    }
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
    return q.populate('assignedDoerId', 'name email isActive')
      .populate('assignedDoerIds', 'name email isActive')
      .populate('buddyIds', 'name email isActive')
      .populate('completedById', 'name');
  },

  /**
   * The caller's tasks, as on O2D's My Tasks: everything waiting on them as a
   * main doer or a buddy (asBuddy), plus what they completed in the last 30
   * days. Each row carries isOverdue and the link to its record.
   */
  async myTasks(user) {
    const uid = user._id;
    const mine = { $or: [{ assignedDoerIds: uid }, { assignedDoerId: uid }, { buddyIds: uid }] };
    const recent = {
      $or: [
        { status: FMS_TASK_STATUS.OPEN },
        { status: FMS_TASK_STATUS.DONE, completedAt: { $gte: new Date(Date.now() - COMPLETED_WINDOW_MS) } },
      ],
    };
    const tasks = await this._populate(FmsTask.find({ $and: [mine, recent] }))
      .sort({ fmsKey: 1, sequence: 1, openedAt: 1 }).limit(1000).lean();
    // Flag steps the user is assigned to but lacks the declared permission for.
    const warnings = {};
    for (const t of tasks) {
      const key = `${t.fmsKey}:${t.stepKey}`;
      if (warnings[key] !== undefined) continue;
      const step = getStep(t.fmsKey, t.stepKey);
      warnings[key] = step ? (await permissionStatus(user, step)).missing : [];
    }
    const rows = await decorateTasks(tasks, { userId: uid });
    return rows.map((t) => ({ ...t, missingPermissions: warnings[`${t.fmsKey}:${t.stepKey}`] || [] }));
  },

  async listTasks(query = {}) {
    const and = [];
    if (query.fmsKey) and.push({ fmsKey: String(query.fmsKey).toUpperCase() });
    if (query.stepKey) and.push({ stepKey: String(query.stepKey).toUpperCase() });
    if (query.status !== 'ALL') and.push({ status: query.status || FMS_TASK_STATUS.OPEN });
    if (query.doerId === 'none') {
      and.push({ assignedDoerId: null }, { $or: [{ assignedDoerIds: { $exists: false } }, { assignedDoerIds: { $size: 0 } }] });
    } else if (query.doerId) {
      and.push({ $or: [{ assignedDoerId: query.doerId }, { assignedDoerIds: query.doerId }] });
    }
    if (query.search) {
      const rx = { $regex: String(query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
      and.push({ $or: [{ entityRef: rx }, { summary: rx }, { stepLabel: rx }, { stepCode: rx }] });
    }
    const filter = and.length ? { $and: and } : {};
    const limit = Math.min(Number(query.limit) || 100, 500);
    const page = Math.max(Number(query.page) || 1, 1);
    const [docs, total] = await Promise.all([
      this._populate(FmsTask.find(filter)).sort({ fmsKey: 1, sequence: 1, openedAt: 1 }).skip((page - 1) * limit).limit(limit).lean(),
      FmsTask.countDocuments(filter),
    ]);
    return {
      docs: await decorateTasks(docs),
      pagination: { total, page, limit, pages: Math.ceil(total / limit) || 1 },
    };
  },

  /** Current-step responsibility for one workflow item (detail pages). */
  async tasksByEntity(entityType, entityId) {
    const raw = await this._populate(FmsTask.find({ entityType, entityId })).sort({ openedAt: -1 }).limit(30).lean();
    const tasks = raw.map((t) => ({
      ...t,
      doers: t.assignedDoerIds?.length ? t.assignedDoerIds : [t.assignedDoerId].filter(Boolean),
      buddies: t.buddyIds || [],
      isOverdue: isTaskOverdue(t),
    }));
    return {
      open: tasks.filter((t) => t.status === FMS_TASK_STATUS.OPEN),
      history: tasks.filter((t) => t.status !== FMS_TASK_STATUS.OPEN),
    };
  },

  /**
   * Hand one open task to other main doer(s) — doerUserIds, or the single
   * doerUserId of the older client. Its buddies stay (minus anyone who is now
   * a main doer); the step's plan is unchanged.
   */
  async reassignTask(id, { doerUserId, doerUserIds, reason = '' }, actor) {
    const task = await FmsTask.findById(id).lean();
    if (!task) throw new AppError('Task not found', 404);
    if (task.status !== FMS_TASK_STATUS.OPEN) throw new AppError('Only open tasks can be reassigned', 400);
    const wanted = [...new Set((doerUserIds?.length ? doerUserIds : [doerUserId]).filter(Boolean).map(String))];
    if (!wanted.length) throw new AppError('Pick at least one doer', 400);
    const users = await User.find({ _id: { $in: wanted } }).select(USER_FIELDS).lean();
    const byId = new Map(users.map((u) => [String(u._id), u]));
    if (wanted.some((uid) => !byId.has(uid))) throw new AppError('User not found', 404);
    if (wanted.some((uid) => !isUserActive(byId.get(uid)))) throw new AppError('This user is inactive and cannot be assigned', 400);
    const had = taskDoerIds(task);
    if (sameIds(had, wanted)) {
      const who = wanted.map((uid) => byId.get(uid).name).join(', ');
      throw new AppError(`${who} ${wanted.length > 1 ? 'are' : 'is'} already the doer${wanted.length > 1 ? 's' : ''} for this task`, 400);
    }
    const step = getStep(task.fmsKey, task.stepKey);
    const missing = [];
    for (const uid of wanted) {
      const perm = step ? await permissionStatus(byId.get(uid), step) : { missing: [], missingEnforced: [] };
      if (perm.missingEnforced.length) {
        throw new AppError(`${byId.get(uid).name} does not have the permission required to perform this step (${perm.missingEnforced.join(', ')})`, 400);
      }
      missing.push(...perm.missing);
    }

    const now = new Date();
    const buddyIds = taskBuddyIds(task).filter((uid) => !wanted.includes(uid));
    const res = await FmsTask.updateOne(
      { _id: task._id, status: FMS_TASK_STATUS.OPEN },
      {
        $set: { assignedDoerId: wanted[0], assignedDoerIds: wanted, buddyIds, assignedAt: now, assignmentSource: 'MANUAL' },
        $push: {
          history: {
            action: 'REASSIGNED', fromUserId: had[0] || null, toUserId: wanted[0], byUserId: actor?._id, byName: actor?.name || '', reason, at: now,
            ...(wanted.length > 1 ? { note: `Doers: ${wanted.map((uid) => byId.get(uid).name).join(', ')}` } : {}),
          },
        },
      },
    );
    if (!res.modifiedCount) throw new AppError('This task was just completed or changed — refresh and try again', 409);
    await audit({
      entityName: 'FmsTask', entityId: task._id, action: 'UPDATE',
      oldValue: { assignedDoerId: task.assignedDoerId || null, assignedDoerIds: had },
      newValue: { assignedDoerId: wanted[0], assignedDoerIds: wanted, reason, fmsKey: task.fmsKey, stepKey: task.stepKey, entityRef: task.entityRef },
      updatedBy: actor?._id,
    });
    const fms = getFms(task.fmsKey);
    if (fms && step) {
      for (const uid of wanted.filter((x) => !had.includes(x))) await notifyTask(uid, fms, step, task);
    }
    const [fresh] = await decorateTasks([await this._populate(FmsTask.findById(task._id)).lean()]);
    return { task: fresh, permissionWarning: [...new Set(missing)] };
  },

  /** Explicitly move a step's open tasks onto its current doer setup. */
  async applyConfigToOpenTasks(fmsKey, stepKey, { reason = '' }, actor) {
    const { fms, step } = requireStep(fmsKey, stepKey);
    const row = await FmsDoerAssignment.findOne({ fmsKey: fms.key, stepKey: step.key, ...ACTIVE }).lean();
    if (!stepPlanOf(row).doerIds.length) throw new AppError('Assign a doer to this step first', 400);
    if (!(await activePlanMap(fms.key)).get(step.key)?.doers.length) throw new AppError('The configured doer is inactive', 400);
    const moved = await this._applyPlanToOpenTasks(fms, [step.key], actor, reason || 'Applied the step doer setup to pending items');
    return { reassigned: moved };
  },
};

export default fmsDoerService;
