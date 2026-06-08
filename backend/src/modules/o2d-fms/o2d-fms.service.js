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

// Notify the owner (and buddy) that a step is now waiting on them.
const notifyStepOwners = async (process, step) => {
  const link = `/o2d-fms/process/${process._id}`;
  const title = `Your turn: ${step.taskTitle || step.stepCode}`;
  const body = `Order ${process.soNumber || ''} — ${process.partyName || ''}`;
  if (step.assignedTo) await notificationsService.notify(step.assignedTo, { type: 'TASK_ASSIGNED', title, body, link });
  if (step.buddyUserId && String(step.buddyUserId) !== String(step.assignedTo)) {
    await notificationsService.notify(step.buddyUserId, { type: 'TASK_ASSIGNED', title: `Backup: ${title}`, body, link });
  }
};

const addMinutes = (date, mins) => new Date(new Date(date).getTime() + (mins || 0) * 60000);
const leadTimeToMins = (lt) => (lt?.value ? lt.value * (LEAD_TIME_UNIT_MINUTES[lt.unit] || 60) : null);
const computeDelayMins = (planned, actual) => {
  if (!planned || !actual) return 0;
  return Math.max(0, Math.round((new Date(actual).getTime() - new Date(planned).getTime()) / 60000));
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
  async buildProcessForOrder(order) {
    const existing = await O2DProcess.findOne({ salesOrderId: order._id });
    if (existing) return existing;

    const defs = await StepDefinition.find({ isActive: true, isDeleted: { $ne: true } })
      .sort({ sequence: 1 }).lean();
    if (!defs.length) {
      logger.warn(`[O2D-FMS] No active StepDefinitions — process not created for SO ${order.soNumber}`);
      return null;
    }

    // The default task template (if any) supplies the per-step task title,
    // checklist, lead time, assignee and buddy.
    const template = await TaskTemplate.findOne({ isDefault: true, isActive: true, isDeleted: { $ne: true } }).lean();
    const tplByStep = new Map((template?.steps || []).map((t) => [t.stepCode, t]));

    const received = order.receivedAt || order.createdAt || new Date();

    const steps = [];
    for (let i = 0; i < defs.length; i += 1) {
      const def = defs[i];
      const tpl = tplByStep.get(def.stepCode);

      // Lead time: template override (any unit) wins over the StepDefinition SLA.
      const leadTimeMins = leadTimeToMins(tpl?.leadTime) ?? def.slaMinutes;

      // Planned is known up-front only for the first step or for steps clocked
      // from the order date. PREV_ACTUAL steps get their planned set when the
      // previous step is completed.
      let planned = null;
      if (i === 0 || def.slaFrom === 'ORDER_RECEIVED') planned = addMinutes(received, leadTimeMins);

      // Owner: template assignee (user→role) overrides the StepDefinition default.
      const assignedTo = tpl?.assigneeUserId
        || (tpl?.assigneeRole ? await resolveOwner({ defaultOwnerRole: tpl.assigneeRole }) : null)
        || await resolveOwner(def);

      steps.push({
        stepCode: def.stepCode,
        planned,
        leadTimeMins,
        status: O2D_STEP_STATUS.PENDING,
        assignedTo,
        buddyUserId: tpl?.buddyUserId || null,
        taskTitle: tpl?.taskTitle || def.name,
        instructions: tpl?.instructions || def.description || null,
        checklist: (tpl?.checklist || []).map((c) => ({ text: c.text, done: false })),
        startedAt: i === 0 ? received : null,
      });
    }

    return O2DProcess.create({
      salesOrderId: order._id,
      soNumber: order.soNumber,
      poNumber: order.poNumber,
      partyName: order.partyName,
      uniqueO2DId: order.uniqueO2DId,
      currentStepCode: defs[0].stepCode,
      createdBy: order.createdBy,
      steps,
    });
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
      .populate('steps.assignedTo', 'name email role')
      .populate('steps.buddyUserId', 'name email role')
      .populate('steps.completedBy', 'name email role')
      .populate('steps.comments.userId', 'name');
    if (!process) throw new AppError('O2D process not found', 404);
    const defMap = await loadDefMap();
    return enrichSteps(process, defMap);
  },

  async getProcessByOrder(salesOrderId) {
    const process = await O2DProcess.findOne({ salesOrderId })
      .populate('steps.assignedTo', 'name email role')
      .populate('steps.buddyUserId', 'name email role')
      .populate('steps.completedBy', 'name email role')
      .populate('steps.comments.userId', 'name');
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
      if (!next.planned || nextDef?.slaFrom !== 'ORDER_RECEIVED') {
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

  /** Per-order owner override. */
  async assignStep(processId, stepCode, userId, actor) {
    const process = await O2DProcess.findById(processId);
    if (!process) throw new AppError('O2D process not found', 404);
    const step = process.steps.find((s) => s.stepCode === stepCode);
    if (!step) throw new AppError(`Step '${stepCode}' not found on this process`, 404);

    step.assignedTo = userId || null;
    process.activityTimeline.push({
      action: 'STEP_REASSIGNED',
      description: `${stepCode} reassigned`,
      actorId: actor?._id || null,
    });
    await process.save();
    // Notify the newly-assigned owner if this step is still pending.
    if (userId && step.status === O2D_STEP_STATUS.PENDING) await notifyStepOwners(process, step);
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
    const query = orderRef?.salesOrderId
      ? { salesOrderId: orderRef.salesOrderId }
      : { soNumber: orderRef?.soNumber };
    if (!query.salesOrderId && !query.soNumber) return null;

    const process = await O2DProcess.findOne(query).select('_id steps').lean();
    if (!process) return null;

    const defMap = await loadDefMap();
    const target = (process.steps || []).find((s) =>
      ![O2D_STEP_STATUS.DONE, O2D_STEP_STATUS.DELAYED, O2D_STEP_STATUS.SKIPPED].includes(s.status)
      && defMap.get(s.stepCode)?.triggerKey === triggerKey);
    if (!target) return null;

    return this.completeStep(
      process._id, target.stepCode,
      { remarks: `Auto-completed by ${triggerKey}` }, actor,
      { bypassRequirements: true },
    );
  },

  /** The doer's "My Tasks" — pending steps where I'm the owner OR the buddy. */
  async getMyTasks(user, query = {}) {
    const uid = String(user._id);
    const filter = {
      isCompleted: false,
      isDeleted: { $ne: true },
      steps: { $elemMatch: {
        status: O2D_STEP_STATUS.PENDING,
        $or: [{ assignedTo: user._id }, { buddyUserId: user._id }],
      } },
    };
    const processes = await O2DProcess.find(filter).lean();
    const defMap = await loadDefMap();

    const tasks = [];
    for (const p of processes) {
      for (const s of p.steps) {
        if (s.status !== O2D_STEP_STATUS.PENDING) continue;
        const isOwner = String(s.assignedTo) === uid;
        const isBuddy = String(s.buddyUserId) === uid;
        if (!isOwner && !isBuddy) continue;
        const def = defMap.get(s.stepCode);
        const checklist = s.checklist || [];
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
          requiresLink: !!def?.requiresLink,
          requiresAttachment: !!def?.requiresAttachment,
          checklistTotal: checklist.length,
          checklistDone: checklist.filter((c) => c.done).length,
          planned: s.planned,
          isOverdue: !!(s.planned && new Date(s.planned) < new Date()),
        });
      }
    }
    tasks.sort((a, b) => new Date(a.planned || 0) - new Date(b.planned || 0));
    return tasks;
  },

  /** Tick / untick a checklist item on a step. */
  async toggleChecklistItem(processId, stepCode, itemId, done, user) {
    const process = await O2DProcess.findById(processId);
    if (!process) throw new AppError('O2D process not found', 404);
    const step = process.steps.find((s) => s.stepCode === stepCode);
    if (!step) throw new AppError(`Step '${stepCode}' not found`, 404);
    const item = step.checklist.id(itemId);
    if (!item) throw new AppError('Checklist item not found', 404);
    item.done = !!done;
    item.doneBy = done ? user?._id || null : null;
    item.doneAt = done ? new Date() : null;
    await process.save();
    const defMap = await loadDefMap();
    return enrichSteps(process, defMap);
  },

  /** Add a comment to a step. */
  async addComment(processId, stepCode, text, user) {
    const process = await O2DProcess.findById(processId);
    if (!process) throw new AppError('O2D process not found', 404);
    const step = process.steps.find((s) => s.stepCode === stepCode);
    if (!step) throw new AppError(`Step '${stepCode}' not found`, 404);
    step.comments.push({ userId: user?._id || null, userName: user?.name || null, text, at: new Date() });
    await process.save();
    const defMap = await loadDefMap();
    return enrichSteps(
      await O2DProcess.findById(processId)
        .populate('steps.assignedTo steps.buddyUserId steps.completedBy', 'name email role'),
      defMap,
    );
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
      if (sp.assignedTo !== undefined) step.assignedTo = sp.assignedTo || null;
      if (sp.buddyUserId !== undefined) step.buddyUserId = sp.buddyUserId || null;
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
          return { text: c.text, done: old?.done || false, doneBy: old?.doneBy || null, doneAt: old?.doneAt || null };
        });
      }
    }
    process.activityTimeline.push({ action: 'ORDER_PLANNED', description: 'Per-order plan updated', actorId: actor?._id || null });
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
