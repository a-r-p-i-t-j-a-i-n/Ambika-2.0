/**
 * O2D FMS service — the flow engine.
 *
 * The two formulas that mirror the client's sheet live here and nowhere else:
 *   planned   = (slaFrom === ORDER_RECEIVED ? receivedAt : prevStep.actual) + slaMinutes
 *   delayMins = max(0, round((actual - planned) / 60000))
 */

import { StepDefinition, O2DProcess, TaskTemplate, O2D_STEP_STATUS, LEAD_TIME_UNIT_MINUTES } from './o2d-fms.model.js';
import User from '../auth/auth.model.js';
import { ApiFeatures } from '../../utils/apiFeatures.js';
import { AppError } from '../../utils/apiResponse.js';
import { logger } from '../../utils/logger.js';
import { notificationsService } from '../notifications/notification.service.js';

// Notify every assigned doer (and every buddy) that a step is waiting on them.
const notifyStepOwners = async (process, step) => {
  const link = `/o2d-fms/task/${process._id}/${encodeURIComponent(step.stepCode)}`;
  const title = `Your turn: ${step.taskTitle || step.stepCode}`;
  const body = `Order ${process.soNumber || ''} — ${process.partyName || ''}`;
  const doers = stepDoerIds(step);
  const buddies = stepBuddyIds(step).filter((id) => !doers.includes(id));
  for (const id of doers) await notificationsService.notify(id, { type: 'TASK_ASSIGNED', title, body, link });
  for (const id of buddies) await notificationsService.notify(id, { type: 'TASK_ASSIGNED', title: `Backup (buddy): ${title}`, body, link });
};

const addMinutes = (date, mins) => new Date(new Date(date).getTime() + (mins || 0) * 60000);
const leadTimeToMins = (lt) => (lt?.value ? lt.value * (LEAD_TIME_UNIT_MINUTES[lt.unit] || 60) : null);
const computeDelayMins = (planned, actual) => {
  if (!planned || !actual) return 0;
  return Math.max(0, Math.round((new Date(actual).getTime() - new Date(planned).getTime()) / 60000));
};

// Union of array + legacy-single user ids on a step.
const idStr = (v) => (v ? String(v._id || v) : null);
const stepDoerIds  = (step) => [...new Set([...(step.assignees || []).map(idStr), idStr(step.assignedTo)].filter(Boolean))];
const stepBuddyIds = (step) => [...new Set([...(step.buddies || []).map(idStr), idStr(step.buddyUserId)].filter(Boolean))];

// A step can be acted on by ANY assigned doer, ANY buddy, or a privileged user
// (root / o2dfms.act / o2dfms.manage). Because it's one shared step record, when
// one of them ticks the checklist or completes it, it's consistent for everyone.
const isAssigneeOrBuddy = (step, user) => {
  const uid = String(user?._id || '');
  return !!uid && (stepDoerIds(step).includes(uid) || stepBuddyIds(step).includes(uid));
};
const assertCanAct = (step, user, privileged) => {
  if (privileged || isAssigneeOrBuddy(step, user)) return;
  throw new AppError('This step is assigned to someone else — you can view it but not action it.', 403);
};

/** Resolve a StepDefinition's default owner to a User _id (or null). */
const resolveOwner = async (def) => {
  if (def.defaultOwnerUserId) return def.defaultOwnerUserId;
  if (def.defaultOwnerRole) {
    const u = await User.findOne({
      isActive: true,
      $or: [{ roles: def.defaultOwnerRole }, { role: def.defaultOwnerRole }],
    }).select('_id').lean();
    return u?._id || null;
  }
  return null;
};

/** Attach the matching StepDefinition (Who/What/How/When) onto each runtime step. */
const enrichSteps = (process, defMap) => {
  const obj = process.toObject ? process.toObject() : process;
  obj.steps = (obj.steps || []).map((s) => {
    const def = defMap.get(s.stepCode);
    return {
      ...s,
      name:        def?.name || s.stepCode,
      description: def?.description || '',
      tool:        def?.tool || null,
      slaMinutes:  def?.slaMinutes ?? null,
      phase:       def?.phase || null,
      sequence:    def?.sequence ?? 0,
      requiresLink:       !!def?.requiresLink,
      requiresAttachment: !!def?.requiresAttachment,
      allowIncompleteChecklist: !!def?.allowIncompleteChecklist,
      defaultOwnerRole:   def?.defaultOwnerRole || null,
      triggerKey:         def?.triggerKey || 'MANUAL',
      checklistTotal: (s.checklist || []).length,
      checklistDone:  (s.checklist || []).filter((c) => c.done).length,
      isOverdue: s.status === O2D_STEP_STATUS.PENDING && s.planned && new Date(s.planned) < new Date(),
    };
  }).sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
  return obj;
};

const loadDefMap = async () => {
  const defs = await StepDefinition.find({ isDeleted: { $ne: true } }).lean();
  return new Map(defs.map((d) => [d.stepCode, d]));
};

export const o2dFmsService = {
  // ── Process lifecycle ─────────────────────────────────────────────────────

  /**
   * Build the O2DProcess for a freshly-created Sales Order from the active
   * StepDefinition catalog. Idempotent — returns the existing process if one
   * already exists. Safe to call without an owner/catalog.
   */
  /** Seed step instances from the active catalog + default template. Shared by
   *  the Sales-Order and Order-Intake process builders. */
  async _seedSteps(received) {
    const defs = await StepDefinition.find({ isActive: true, isDeleted: { $ne: true } })
      .sort({ sequence: 1 }).lean();
    if (!defs.length) return { steps: [], defs: [] };

    const template = await TaskTemplate.findOne({ isDefault: true, isActive: true, isDeleted: { $ne: true } }).lean();
    const tplByStep = new Map((template?.steps || []).map((t) => [t.stepCode, t]));

    const steps = [];
    let cursor = received; // running planned-date cursor; each step adds its lead/SLA time
    for (let i = 0; i < defs.length; i += 1) {
      const def = defs[i];
      const tpl = tplByStep.get(def.stepCode);
      const leadTimeMins = leadTimeToMins(tpl?.leadTime) ?? def.slaMinutes;
      // Every step gets a planned due-date up-front, derived from the cumulative
      // lead/SLA times (so the whole schedule is visible the moment the FMS starts).
      cursor = addMinutes(cursor, leadTimeMins);
      const planned = cursor;

      // Doers: template multi-list → legacy single → role → step-definition default.
      let assignees = (tpl?.assigneeUserIds?.length ? tpl.assigneeUserIds
        : (tpl?.assigneeUserId ? [tpl.assigneeUserId] : []))
        .map((x) => String(x));
      if (!assignees.length && tpl?.assigneeRole) {
        const u = await resolveOwner({ defaultOwnerRole: tpl.assigneeRole });
        if (u) assignees = [String(u)];
      }
      if (!assignees.length) {
        const u = await resolveOwner(def);
        if (u) assignees = [String(u)];
      }
      const buddies = (tpl?.buddyUserIds?.length ? tpl.buddyUserIds
        : (tpl?.buddyUserId ? [tpl.buddyUserId] : []))
        .map((x) => String(x));

      steps.push({
        stepCode: def.stepCode,
        planned,
        leadTimeMins,
        status: O2D_STEP_STATUS.PENDING,
        assignees,
        buddies,
        assignedTo: assignees[0] || null,   // primary mirror
        buddyUserId: buddies[0] || null,
        taskTitle: tpl?.taskTitle || def.name,
        instructions: tpl?.instructions || def.description || null,
        checklist: (tpl?.checklist || []).map((c) => ({ text: c.text, done: false })),
        startedAt: i === 0 ? received : null,
      });
    }
    return { steps, defs };
  },

  async buildProcessForOrder(order) {
    const existing = await O2DProcess.findOne({ salesOrderId: order._id });
    if (existing) return existing;

    const { steps, defs } = await this._seedSteps(order.receivedAt || order.createdAt || new Date());
    if (!steps.length) {
      logger.warn(`[O2D-FMS] No active StepDefinitions — process not created for SO ${order.soNumber}`);
      return null;
    }

    // Direct Sales Order (no preceding intake): skip ORDER_INTAKE steps so they
    // don't dangle forever, and start at the first remaining step.
    const defMap = new Map(defs.map((d) => [d.stepCode, d]));
    steps.forEach((s) => {
      if (defMap.get(s.stepCode)?.triggerKey === 'ORDER_INTAKE') { s.status = O2D_STEP_STATUS.SKIPPED; s.startedAt = null; s.planned = null; }
    });
    const firstPending = steps.find((s) => s.status === O2D_STEP_STATUS.PENDING);
    if (firstPending && !firstPending.startedAt) firstPending.startedAt = order.receivedAt || new Date();

    return O2DProcess.create({
      salesOrderId: order._id,
      source: 'SALES_ORDER',
      soNumber: order.soNumber,
      poNumber: order.poNumber,
      partyName: order.partyName,
      uniqueO2DId: order.uniqueO2DId,
      currentStepCode: firstPending?.stepCode || defs[0].stepCode,
      createdBy: order.createdBy,
      steps,
    });
  },

  /** Start the FMS from an Order Intake (call/email/WhatsApp). Completes the
   *  ORDER_INTAKE step. The Sales Order is linked later on conversion. */
  async buildProcessForIntake(intake) {
    const existing = await O2DProcess.findOne({ intakeId: intake._id });
    if (existing) return existing;

    const { steps, defs } = await this._seedSteps(intake.receivedAt || new Date());
    if (!steps.length) return null;

    const process = await O2DProcess.create({
      intakeId: intake._id,
      source: 'INTAKE',
      soNumber: null,
      partyName: intake.partyName,
      currentStepCode: defs[0].stepCode,
      createdBy: intake.createdBy,
      steps,
    });
    // Auto-complete the "order received" step (whatever is mapped to ORDER_INTAKE).
    try { await this.advanceByTrigger({ processId: process._id }, 'ORDER_INTAKE', intake.createdBy ? { _id: intake.createdBy } : null); }
    catch (err) { logger.error(`[O2D-FMS] ORDER_INTAKE advance failed: ${err.message}`); }
    return process;
  },

  /** Conversion: attach the now-created Sales Order to the intake's process and
   *  advance the ORDER_ENTRY step. Keeps a single process across the lifecycle. */
  async linkIntakeProcessToOrder(intakeId, order) {
    const process = await O2DProcess.findOne({ intakeId });
    if (!process) return null;
    process.salesOrderId = order._id;
    process.soNumber = order.soNumber;
    process.poNumber = order.poNumber;
    if (!process.uniqueO2DId) process.uniqueO2DId = order.uniqueO2DId;
    await process.save();
    await this.advanceByTrigger({ processId: process._id }, 'ORDER_ENTRY', order.createdBy ? { _id: order.createdBy } : null);
    return process;
  },

  async listProcesses(query) {
    const features = new ApiFeatures(O2DProcess.find({ isDeleted: { $ne: true } }), query)
      .filter().search(['soNumber', 'poNumber', 'partyName', 'uniqueO2DId']).sort().paginate();
    const { docs, pagination } = await features.exec();
    const defMap = await loadDefMap();
    return { docs: docs.map((d) => enrichSteps(d, defMap)), pagination };
  },

  async getProcessById(id) {
    const process = await O2DProcess.findById(id)
      .populate('steps.assignees steps.buddies', 'name email role')
      .populate('steps.assignedTo', 'name email role')
      .populate('steps.buddyUserId', 'name email role')
      .populate('steps.completedBy', 'name email role')
      .populate('steps.comments.userId', 'name')
      .populate('activityTimeline.actorId', 'name');
    if (!process) throw new AppError('O2D process not found', 404);
    const defMap = await loadDefMap();
    return enrichSteps(process, defMap);
  },

  async getProcessByOrder(salesOrderId) {
    const process = await O2DProcess.findOne({ salesOrderId })
      .populate('steps.assignees steps.buddies', 'name email role')
      .populate('steps.assignedTo', 'name email role')
      .populate('steps.buddyUserId', 'name email role')
      .populate('steps.completedBy', 'name email role')
      .populate('steps.comments.userId', 'name')
      .populate('activityTimeline.actorId', 'name');
    if (!process) return null;
    const defMap = await loadDefMap();
    return enrichSteps(process, defMap);
  },

  // ── Doer actions ──────────────────────────────────────────────────────────

  /** Complete a single step: stamp actual, compute delay, advance the flow.
   *  opts.bypassRequirements — skip link/attachment gates (used by the auto-advance
   *  bridge, since the real action already happened in another module). */
  async completeStep(processId, stepCode, payload, user, opts = {}) {
    const process = await O2DProcess.findById(processId);
    if (!process) throw new AppError('O2D process not found', 404);

    const idx = process.steps.findIndex((s) => s.stepCode === stepCode);
    if (idx === -1) throw new AppError(`Step '${stepCode}' not found on this process`, 404);

    const step = process.steps[idx];
    if (!opts.bypassRequirements) assertCanAct(step, user, opts.privileged);
    if ([O2D_STEP_STATUS.DONE, O2D_STEP_STATUS.DELAYED].includes(step.status)) {
      throw new AppError(`Step '${stepCode}' is already completed`, 409);
    }

    const defMap = await loadDefMap();
    const def = defMap.get(stepCode);
    if (!opts.bypassRequirements) {
      if (def?.requiresLink && !payload.link) throw new AppError('This step requires a link', 422);
      if (def?.requiresAttachment && !(payload.attachments?.length || step.attachments?.length)) {
        throw new AppError('This step requires an attachment', 422);
      }
      // Checklist gate: every item must be ticked unless the step allows otherwise.
      const pending = (step.checklist || []).filter((c) => !c.done).length;
      if (pending > 0 && !def?.allowIncompleteChecklist) {
        throw new AppError(`Complete all checklist items first (${pending} remaining)`, 422);
      }
    }

    const actual = new Date();
    step.actual = actual;
    step.completedBy = user?._id || null;
    if (payload.link !== undefined) step.link = payload.link;
    if (payload.remarks !== undefined) step.remarks = payload.remarks;
    if (payload.attachments?.length) step.attachments.push(...payload.attachments);
    step.delayMins = computeDelayMins(step.planned, actual);
    step.status = step.delayMins > 0 ? O2D_STEP_STATUS.DELAYED : O2D_STEP_STATUS.DONE;

    // Advance: set the next step's planned (lead time wins over SLA), mark it
    // started, and move currentStep.
    const next = process.steps[idx + 1];
    if (next) {
      const nextDef = defMap.get(next.stepCode);
      // Planned dates are scheduled up-front from cumulative lead/SLA time. Only
      // fill one in if it's somehow missing — never override the schedule (keeps
      // the plan monotonic and faithful to the configured lead times).
      if (!next.planned) {
        const mins = next.leadTimeMins ?? nextDef?.slaMinutes ?? 60;
        next.planned = addMinutes(actual, mins);
      }
      next.startedAt = actual;
      process.currentStepCode = next.stepCode;
      await notifyStepOwners(process, next);
    } else {
      process.isCompleted = true;
      process.completedAt = actual;
      process.currentStepCode = null;
    }

    process.activityTimeline.push({
      action: 'STEP_COMPLETED',
      description: `${stepCode} completed${step.delayMins > 0 ? ` (late by ${step.delayMins} min)` : ''}`,
      actorId: user?._id || null,
    });

    await process.save();
    return enrichSteps(process, defMap);
  },

  /** Per-order reassignment — set multiple doers and/or buddies on a step. */
  async assignStep(processId, stepCode, { assignees = [], buddies = [] }, actor) {
    const process = await O2DProcess.findById(processId);
    if (!process) throw new AppError('O2D process not found', 404);
    const step = process.steps.find((s) => s.stepCode === stepCode);
    if (!step) throw new AppError(`Step '${stepCode}' not found on this process`, 404);

    step.assignees = assignees || [];
    step.buddies = buddies || [];
    step.assignedTo = step.assignees[0] || null;   // primary mirror
    step.buddyUserId = step.buddies[0] || null;
    process.activityTimeline.push({
      action: 'STEP_REASSIGNED',
      description: `${stepCode} reassigned (${step.assignees.length} doer(s), ${step.buddies.length} buddy(ies))`,
      actorId: actor?._id || null,
    });
    await process.save();
    if (step.status === O2D_STEP_STATUS.PENDING && (step.assignees.length || step.buddies.length)) {
      await notifyStepOwners(process, step);
    }
    const defMap = await loadDefMap();
    return enrichSteps(process, defMap);
  },

  /**
   * Auto-advance bridge. Called by other modules after a real business action
   * (dispatch plan saved, actual dispatch recorded, invoice created…). Finds the
   * order's process, locates the first non-done step whose definition has the
   * matching triggerKey, and completes it. Non-fatal: callers wrap in try/catch.
   *
   * @param orderRef  { salesOrderId } or { soNumber }
   */
  async advanceByTrigger(orderRef, triggerKey, actor = null) {
    let query = null;
    if (orderRef?.processId) query = { _id: orderRef.processId };
    else if (orderRef?.salesOrderId) query = { salesOrderId: orderRef.salesOrderId };
    else if (orderRef?.intakeId) query = { intakeId: orderRef.intakeId };
    else if (orderRef?.soNumber) query = { soNumber: orderRef.soNumber };
    if (!query) return null;

    const process = await O2DProcess.findOne(query);
    if (!process) return null;

    const defMap = await loadDefMap();
    const target = process.steps.find((s) =>
      ![O2D_STEP_STATUS.DONE, O2D_STEP_STATUS.DELAYED, O2D_STEP_STATUS.SKIPPED].includes(s.status)
      && defMap.get(s.stepCode)?.triggerKey === triggerKey);
    if (!target) return null;

    // If the step still has an unfinished checklist, the real action only makes it
    // the ACTIVE task — the assigned doer must still tick the checklist to finish it.
    // (So the step is never shown "complete" while its checklist is pending.)
    const pendingChecklist = (target.checklist || []).some((c) => !c.done);
    if (pendingChecklist) {
      if (!target.startedAt) target.startedAt = new Date();
      process.currentStepCode = target.stepCode;
      target.comments.push({
        userName: 'System',
        text: `${triggerKey.replace('_', ' ').toLowerCase()} done automatically — please complete the checklist to finish this step.`,
        at: new Date(),
      });
      process.activityTimeline.push({
        action: 'TRIGGER_AWAITS_CHECKLIST',
        description: `${target.stepCode} · ${triggerKey} done; checklist pending`,
        actorId: actor?._id || null,
      });
      await process.save();
      return enrichSteps(process, defMap);
    }

    // No checklist left — the real action IS the proof, so auto-complete & advance.
    return this.completeStep(
      process._id, target.stepCode,
      { remarks: `Auto-completed by ${triggerKey}` }, actor,
      { bypassRequirements: true },
    );
  },

  /** The doer's "My Tasks" — every step where I'm the owner OR buddy, with its
   *  status, so the UI can show actionable (pending) vs completed. */
  async getMyTasks(user, query = {}) {
    const uid = String(user._id);
    const filter = {
      isDeleted: { $ne: true },
      steps: { $elemMatch: { $or: [
        { assignees: user._id }, { assignedTo: user._id },
        { buddies: user._id }, { buddyUserId: user._id },
      ] } },
    };
    const processes = await O2DProcess.find(filter).lean();
    const defMap = await loadDefMap();

    const tasks = [];
    for (const p of processes) {
      for (const s of p.steps) {
        const isOwner = stepDoerIds(s).includes(uid);
        const isBuddy = stepBuddyIds(s).includes(uid);
        if (!isOwner && !isBuddy) continue;
        const def = defMap.get(s.stepCode);
        const checklist = s.checklist || [];
        const isDone = [O2D_STEP_STATUS.DONE, O2D_STEP_STATUS.DELAYED].includes(s.status);
        tasks.push({
          processId: p._id,
          salesOrderId: p.salesOrderId,
          soNumber: p.soNumber,
          partyName: p.partyName,
          stepCode: s.stepCode,
          stepId: s._id,
          name: s.taskTitle || def?.name || s.stepCode,
          tool: def?.tool || null,
          description: s.instructions || def?.description || '',
          asBuddy: isBuddy && !isOwner,
          status: s.status,
          requiresLink: !!def?.requiresLink,
          requiresAttachment: !!def?.requiresAttachment,
          checklistTotal: checklist.length,
          checklistDone: checklist.filter((c) => c.done).length,
          planned: s.planned,
          completedAt: s.actual,
          delayMins: s.delayMins || 0,
          isOverdue: !isDone && !!(s.planned && new Date(s.planned) < new Date()),
        });
      }
    }
    // Actionable first (pending, most overdue), completed after.
    tasks.sort((a, b) => {
      const ap = a.status === O2D_STEP_STATUS.PENDING ? 0 : 1;
      const bp = b.status === O2D_STEP_STATUS.PENDING ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return new Date(a.planned || 0) - new Date(b.planned || 0);
    });
    return tasks;
  },

  /** Manager/MD view — every step across every order as a task row, with the
   *  doers, status and timing. Frontend filters & computes stats client-side. */
  async getAllTasks() {
    const processes = await O2DProcess.find({ isDeleted: { $ne: true } })
      .populate('steps.assignees steps.assignedTo steps.completedBy', 'name')
      .lean();
    const defMap = await loadDefMap();
    const now = Date.now();
    const tasks = [];
    for (const p of processes) {
      for (const s of p.steps) {
        const def = defMap.get(s.stepCode);
        const isDone = [O2D_STEP_STATUS.DONE, O2D_STEP_STATUS.DELAYED].includes(s.status);
        const doerObjs = (s.assignees?.length ? s.assignees : [s.assignedTo]).filter(Boolean);
        tasks.push({
          processId: p._id,
          stepCode: s.stepCode,
          soNumber: p.soNumber || (p.source === 'INTAKE' ? 'Intake' : ''),
          partyName: p.partyName,
          name: s.taskTitle || def?.name || s.stepCode,
          status: s.status,
          doers: doerObjs.map((u) => ({ _id: String(u._id || u), name: u.name || 'User' })),
          completedBy: s.completedBy?.name || null,
          planned: s.planned,
          completedAt: s.actual,
          delayMins: s.delayMins || 0,
          checklistTotal: (s.checklist || []).length,
          checklistDone: (s.checklist || []).filter((c) => c.done).length,
          isOverdue: !isDone && !!(s.planned && new Date(s.planned) < now),
        });
      }
    }
    return tasks;
  },

  /** Tick / untick a checklist item on a step. */
  async toggleChecklistItem(processId, stepCode, itemId, done, user, privileged = false) {
    const process = await O2DProcess.findById(processId);
    if (!process) throw new AppError('O2D process not found', 404);
    const step = process.steps.find((s) => s.stepCode === stepCode);
    if (!step) throw new AppError(`Step '${stepCode}' not found`, 404);
    assertCanAct(step, user, privileged);
    const item = step.checklist.id(itemId);
    if (!item) throw new AppError('Checklist item not found', 404);
    item.done = !!done;
    item.doneBy = done ? user?._id || null : null;
    item.doneByName = done ? user?.name || null : null;
    item.doneAt = done ? new Date() : null;
    process.activityTimeline.push({
      action: done ? 'CHECKLIST_TICKED' : 'CHECKLIST_UNTICKED',
      description: `${stepCode} · ${item.text}`,
      actorId: user?._id || null,
    });
    await process.save();
    const defMap = await loadDefMap();
    return enrichSteps(process, defMap);
  },

  /** Add a comment to a step. */
  async addComment(processId, stepCode, text, user, privileged = false) {
    const process = await O2DProcess.findById(processId);
    if (!process) throw new AppError('O2D process not found', 404);
    const step = process.steps.find((s) => s.stepCode === stepCode);
    if (!step) throw new AppError(`Step '${stepCode}' not found`, 404);
    assertCanAct(step, user, privileged);
    step.comments.push({ userId: user?._id || null, userName: user?.name || null, text, at: new Date() });
    await process.save();
    const defMap = await loadDefMap();
    return enrichSteps(
      await O2DProcess.findById(processId)
        .populate('steps.assignedTo steps.buddyUserId steps.completedBy', 'name email role'),
      defMap,
    );
  },

  /** Attach proof files / voice notes to a step. */
  async addAttachments(processId, stepCode, items, user, privileged = false) {
    const process = await O2DProcess.findById(processId);
    if (!process) throw new AppError('O2D process not found', 404);
    const step = process.steps.find((s) => s.stepCode === stepCode);
    if (!step) throw new AppError(`Step '${stepCode}' not found`, 404);
    assertCanAct(step, user, privileged);

    const kindOf = (mime = '') => (mime.startsWith('audio/') ? 'audio'
      : mime.startsWith('video/') ? 'video'
      : mime.startsWith('image/') ? 'image' : 'file');

    for (const it of items || []) {
      step.attachments.push({
        fileName: it.fileName, fileUrl: it.fileUrl, fileKey: it.fileKey || null,
        fileType: it.fileType || null, sizeBytes: it.sizeBytes || 0,
        kind: it.kind || kindOf(it.fileType), uploadedBy: user?._id || null,
        uploadedByName: user?.name || null, uploadedAt: new Date(),
      });
    }
    process.activityTimeline.push({
      action: 'STEP_ATTACHMENT', description: `${items?.length || 0} file(s) attached to ${stepCode}`, actorId: user?._id || null,
    });
    await process.save();
    const defMap = await loadDefMap();
    return enrichSteps(
      await O2DProcess.findById(processId)
        .populate('steps.assignedTo steps.buddyUserId steps.completedBy', 'name email role'),
      defMap,
    );
  },

  /** Remove an attachment from a step (and from S3 if applicable). */
  async removeAttachment(processId, stepCode, attachmentId, user, privileged = false) {
    const process = await O2DProcess.findById(processId);
    if (!process) throw new AppError('O2D process not found', 404);
    const step = process.steps.find((s) => s.stepCode === stepCode);
    if (!step) throw new AppError(`Step '${stepCode}' not found`, 404);
    assertCanAct(step, user, privileged);
    const att = step.attachments.id(attachmentId);
    if (att?.fileKey) { try { const { deleteObject } = await import('../../common/uploads/s3.service.js'); await deleteObject(att.fileKey); } catch { /* non-fatal */ } }
    step.attachments.pull(attachmentId);
    await process.save();
    const defMap = await loadDefMap();
    return enrichSteps(process, defMap);
  },

  /** Per-order custom plan: override task/assignee/buddy/leadTime/checklist per step. */
  async planOrder(processId, stepsPlan, actor) {
    const process = await O2DProcess.findById(processId);
    if (!process) throw new AppError('O2D process not found', 404);

    for (const sp of stepsPlan || []) {
      const step = process.steps.find((s) => s.stepCode === sp.stepCode);
      if (!step) continue;
      if (sp.taskTitle !== undefined) step.taskTitle = sp.taskTitle;
      if (sp.instructions !== undefined) step.instructions = sp.instructions;
      if (sp.assignees !== undefined) {
        step.assignees = sp.assignees || [];
        step.assignedTo = step.assignees[0] || null;
      } else if (sp.assignedTo !== undefined) {
        step.assignedTo = sp.assignedTo || null;
        step.assignees = sp.assignedTo ? [sp.assignedTo] : [];
      }
      if (sp.buddies !== undefined) {
        step.buddies = sp.buddies || [];
        step.buddyUserId = step.buddies[0] || null;
      } else if (sp.buddyUserId !== undefined) {
        step.buddyUserId = sp.buddyUserId || null;
        step.buddies = sp.buddyUserId ? [sp.buddyUserId] : [];
      }
      if (sp.leadTime !== undefined) {
        const mins = leadTimeToMins(sp.leadTime);
        if (mins != null) {
          step.leadTimeMins = mins;
          // Re-time a not-yet-started step from now (only if still pending & unplanned-by-actual).
          if (step.status === O2D_STEP_STATUS.PENDING && step.startedAt) {
            step.planned = addMinutes(step.startedAt, mins);
          }
        }
      }
      if (Array.isArray(sp.checklist)) {
        // Replace checklist, preserving done-state for matching texts.
        const prev = new Map((step.checklist || []).map((c) => [c.text, c]));
        step.checklist = sp.checklist.map((c) => {
          const old = prev.get(c.text);
          return { text: c.text, done: old?.done || false, doneBy: old?.doneBy || null, doneByName: old?.doneByName || null, doneAt: old?.doneAt || null };
        });
      }
      process.activityTimeline.push({
        action: 'STEP_PLAN_UPDATED',
        description: `${sp.stepCode} · task/plan updated`,
        actorId: actor?._id || null,
      });
    }
    await process.save();
    const defMap = await loadDefMap();
    return enrichSteps(process, defMap);
  },

  // ── MD dashboard ────────────────────────────────────────────────────────--

  async getDashboard() {
    const now = new Date();

    const [byStep, byPerson, totals, overdue] = await Promise.all([
      // Bottleneck: pending count, overdue count and total delay per step.
      O2DProcess.aggregate([
        { $match: { isDeleted: { $ne: true } } },
        { $unwind: '$steps' },
        { $group: {
          _id: '$steps.stepCode',
          pending:  { $sum: { $cond: [{ $eq: ['$steps.status', 'PENDING'] }, 1, 0] } },
          overdue:  { $sum: { $cond: [{ $and: [
            { $eq: ['$steps.status', 'PENDING'] },
            { $ne: ['$steps.planned', null] },
            { $lt: ['$steps.planned', now] },
          ] }, 1, 0] } },
          delayMins: { $sum: '$steps.delayMins' },
          completed: { $sum: { $cond: [{ $in: ['$steps.status', ['DONE', 'DELAYED']] }, 1, 0] } },
        } },
        { $sort: { delayMins: -1 } },
      ]),
      // Accountability: pending load + accumulated delay per assigned person.
      O2DProcess.aggregate([
        { $match: { isDeleted: { $ne: true } } },
        { $unwind: '$steps' },
        { $match: { 'steps.assignedTo': { $ne: null } } },
        { $group: {
          _id: '$steps.assignedTo',
          pending:  { $sum: { $cond: [{ $eq: ['$steps.status', 'PENDING'] }, 1, 0] } },
          overdue:  { $sum: { $cond: [{ $and: [
            { $eq: ['$steps.status', 'PENDING'] },
            { $ne: ['$steps.planned', null] },
            { $lt: ['$steps.planned', now] },
          ] }, 1, 0] } },
          delayMins: { $sum: '$steps.delayMins' },
        } },
        { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
        { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
        { $project: { name: '$user.name', email: '$user.email', pending: 1, overdue: 1, delayMins: 1 } },
        { $sort: { delayMins: -1 } },
      ]),
      O2DProcess.aggregate([
        { $match: { isDeleted: { $ne: true } } },
        { $group: {
          _id: null,
          total: { $sum: 1 },
          completed: { $sum: { $cond: ['$isCompleted', 1, 0] } },
          inProgress: { $sum: { $cond: ['$isCompleted', 0, 1] } },
        } },
      ]),
      // Flat list of overdue steps for the action table.
      O2DProcess.aggregate([
        { $match: { isCompleted: false, isDeleted: { $ne: true } } },
        { $unwind: '$steps' },
        { $match: { 'steps.status': 'PENDING', 'steps.planned': { $ne: null, $lt: now } } },
        { $lookup: { from: 'users', localField: 'steps.assignedTo', foreignField: '_id', as: 'owner' } },
        { $unwind: { path: '$owner', preserveNullAndEmptyArrays: true } },
        { $project: {
          processId: '$_id', soNumber: 1, partyName: 1,
          stepCode: '$steps.stepCode', planned: '$steps.planned',
          ownerName: '$owner.name', ownerEmail: '$owner.email',
          overdueMins: { $round: [{ $divide: [{ $subtract: [now, '$steps.planned'] }, 60000] }, 0] },
        } },
        { $sort: { overdueMins: -1 } },
        { $limit: 100 },
      ]),
    ]);

    const defMap = await loadDefMap();
    const labelStep = (rows) => rows.map((r) => ({ ...r, name: defMap.get(r._id)?.name || r._id }));

    return {
      totals: totals[0] || { total: 0, completed: 0, inProgress: 0 },
      overdueCount: overdue.length,
      byStep: labelStep(byStep),
      byPerson,
      overdue: overdue.map((o) => ({ ...o, name: defMap.get(o.stepCode)?.name || o.stepCode })),
    };
  },

  /**
   * Doer scoreboard — per-person performance over completed steps.
   *   punctuality  = % of completed steps finished on/before planned
   *   avgDelayMins = mean lateness across completed steps
   *   throughput   = number of steps completed
   *   accuracy     = % of checklist items that were ticked (vs total) on their steps
   */
  async getDoerScores() {
    const rows = await O2DProcess.aggregate([
      { $match: { isDeleted: { $ne: true } } },
      { $unwind: '$steps' },
      { $match: { 'steps.status': { $in: ['DONE', 'DELAYED'] }, 'steps.completedBy': { $ne: null } } },
      { $group: {
        _id: '$steps.completedBy',
        throughput: { $sum: 1 },
        onTime:     { $sum: { $cond: [{ $eq: ['$steps.delayMins', 0] }, 1, 0] } },
        totalDelay: { $sum: '$steps.delayMins' },
        checklistTotal: { $sum: { $size: { $ifNull: ['$steps.checklist', []] } } },
        checklistDone:  { $sum: { $size: { $filter: { input: { $ifNull: ['$steps.checklist', []] }, as: 'c', cond: '$$c.done' } } } },
      } },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
      { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
      { $project: {
        name: '$user.name', email: '$user.email',
        throughput: 1, totalDelay: 1,
        punctuality: { $round: [{ $multiply: [{ $cond: [{ $gt: ['$throughput', 0] }, { $divide: ['$onTime', '$throughput'] }, 0] }, 100] }, 0] },
        avgDelayMins: { $round: [{ $cond: [{ $gt: ['$throughput', 0] }, { $divide: ['$totalDelay', '$throughput'] }, 0] }, 0] },
        accuracy: { $round: [{ $multiply: [{ $cond: [{ $gt: ['$checklistTotal', 0] }, { $divide: ['$checklistDone', '$checklistTotal'] }, 1] }, 100] }, 0] },
      } },
      { $sort: { punctuality: -1, throughput: -1 } },
    ]);
    return rows;
  },

  /** Pending steps past their SLA that have not yet been escalated. For the email job. */
  async findOverdueSteps() {
    const now = new Date();
    const processes = await O2DProcess.find({
      isCompleted: false,
      isDeleted: { $ne: true },
      steps: { $elemMatch: { status: O2D_STEP_STATUS.PENDING, planned: { $ne: null, $lt: now }, escalatedAt: null } },
    }).populate('steps.assignedTo', 'name email').lean();

    const defMap = await loadDefMap();
    const breaches = [];
    for (const p of processes) {
      for (const s of p.steps) {
        if (s.status !== O2D_STEP_STATUS.PENDING || !s.planned || new Date(s.planned) >= now || s.escalatedAt) continue;
        breaches.push({
          processId: p._id, soNumber: p.soNumber, partyName: p.partyName,
          stepCode: s.stepCode, stepName: defMap.get(s.stepCode)?.name || s.stepCode,
          planned: s.planned, owner: s.assignedTo,
        });
      }
    }
    return breaches;
  },

  /** Stamp escalatedAt so the same breach isn't emailed twice. */
  async markEscalated(processId, stepCode) {
    await O2DProcess.updateOne(
      { _id: processId, 'steps.stepCode': stepCode },
      { $set: { 'steps.$.escalatedAt': new Date() } },
    );
  },

  // ── StepDefinition CRUD (config) ──────────────────────────────────────────

  async listDefinitions() {
    return StepDefinition.find({ isDeleted: { $ne: true } })
      .populate('defaultOwnerUserId', 'name email role')
      .sort({ sequence: 1 }).lean();
  },

  async createDefinition(data, actor) {
    const exists = await StepDefinition.findOne({ stepCode: data.stepCode, isDeleted: { $ne: true } });
    if (exists) throw new AppError(`Step code '${data.stepCode}' already exists`, 409);
    return StepDefinition.create({ ...data, createdBy: actor?._id });
  },

  async updateDefinition(id, data, actor) {
    const def = await StepDefinition.findById(id);
    if (!def) throw new AppError('Step definition not found', 404);
    Object.assign(def, data, { updatedBy: actor?._id });
    await def.save();
    return def.toObject();
  },

  async reorderDefinitions(orderList, actor) {
    // orderList = [{ id, sequence }]
    await Promise.all(orderList.map(({ id, sequence }) =>
      StepDefinition.updateOne({ _id: id }, { $set: { sequence, updatedBy: actor?._id } })));
    return this.listDefinitions();
  },

  async deactivateDefinition(id, actor) {
    const def = await StepDefinition.findByIdAndUpdate(
      id, { $set: { isActive: false, updatedBy: actor?._id } }, { new: true });
    if (!def) throw new AppError('Step definition not found', 404);
    return def.toObject();
  },

  // ── TaskTemplate CRUD (the reusable work plan) ────────────────────────────

  async listTemplates() {
    return TaskTemplate.find({ isDeleted: { $ne: true } })
      .populate('steps.assigneeUserId steps.buddyUserId', 'name email role')
      .sort({ isDefault: -1, name: 1 }).lean();
  },

  async getTemplate(id) {
    const tpl = await TaskTemplate.findById(id)
      .populate('steps.assigneeUserId steps.buddyUserId', 'name email role').lean();
    if (!tpl) throw new AppError('Template not found', 404);
    return tpl;
  },

  async createTemplate(data, actor) {
    if (data.isDefault) await TaskTemplate.updateMany({ isDefault: true }, { $set: { isDefault: false } });
    return TaskTemplate.create({ ...data, createdBy: actor?._id });
  },

  async updateTemplate(id, data, actor) {
    if (data.isDefault) await TaskTemplate.updateMany({ _id: { $ne: id }, isDefault: true }, { $set: { isDefault: false } });
    const tpl = await TaskTemplate.findById(id);
    if (!tpl) throw new AppError('Template not found', 404);
    Object.assign(tpl, data, { updatedBy: actor?._id });
    await tpl.save();
    return tpl.toObject();
  },

  async setDefaultTemplate(id) {
    await TaskTemplate.updateMany({ isDefault: true }, { $set: { isDefault: false } });
    const tpl = await TaskTemplate.findByIdAndUpdate(id, { $set: { isDefault: true, isActive: true } }, { new: true });
    if (!tpl) throw new AppError('Template not found', 404);
    return tpl.toObject();
  },

  async deleteTemplate(id) {
    const tpl = await TaskTemplate.findByIdAndUpdate(id, { $set: { isDeleted: true, isDefault: false } }, { new: true });
    if (!tpl) throw new AppError('Template not found', 404);
    return { id };
  },
};

export default o2dFmsService;
