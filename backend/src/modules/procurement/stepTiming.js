/**
 * Adds `stepTiming` (Planned / Actual / Done By / Assigned Doer) to Purchase
 * FMS list rows — read-only, two batched queries per page. See
 * stepTiming.rules.js for which existing field feeds each value.
 */
import User from '../auth/auth.model.js';
import { FmsTask } from '../fms-doers/fmsDoer.model.js';
import { getStep } from '../fms-doers/fmsCatalog.js';
import { logger } from '../../utils/logger.js';
import { STEP_TIMING, resolveStepTiming } from './stepTiming.rules.js';

export async function attachStepTiming(listKey, docs) {
  const def = STEP_TIMING[listKey];
  if (!def || !Array.isArray(docs) || !docs.length) return docs;
  try {
    const entityTypes = new Set();
    const entityIds = new Set();
    const userIds = new Set();
    for (const doc of docs) {
      for (const e of def.entities(doc)) {
        if (!e) continue;
        entityTypes.add(e.entityType);
        entityIds.add(String(e.entityId));
      }
      for (const s of def.steps) {
        const u = s.byUserId?.(doc);
        if (u) userIds.add(String(u));
      }
    }

    const [tasks, users] = await Promise.all([
      entityIds.size
        ? FmsTask.find({
          fmsKey: 'PURCHASE',
          stepKey: { $in: def.steps.map((s) => s.key) },
          entityType: { $in: [...entityTypes] },
          entityId: { $in: [...entityIds] },
        }).select('stepKey entityType entityId status assignedDoerId openedAt')
          .populate('assignedDoerId', 'name').lean()
        : [],
      userIds.size ? User.find({ _id: { $in: [...userIds] } }).select('name').lean() : [],
    ]);

    const names = new Map(users.map((u) => [String(u._id), u.name]));
    const meta = Object.fromEntries(def.steps.map((s) => {
      const step = getStep('PURCHASE', s.key);
      return [s.key, { code: step?.code || '', label: step?.label || s.key }];
    }));
    return docs.map((doc) => ({ ...doc, stepTiming: resolveStepTiming(doc, def, { tasks, names, meta }) }));
  } catch (err) {
    // Display-only enrichment — never fail the list over it.
    logger.error(`[step-timing] ${listKey}: ${err.message}`);
    return docs;
  }
}
