/**
 * Idempotent seed for the canonical Role set.
 *
 * Run on app boot. Safe to run multiple times — it upserts by `key` and
 * only refreshes the permissions list on system roles. Custom roles created
 * by MD via the UI are never touched.
 *
 * Also backfills `User.roles[]` for users that still have only the legacy
 * `role` enum field set.
 */

import Role from './role.model.js';
import User from '../auth/auth.model.js';
import { invalidateRoleCache } from '../../middleware/permission.middleware.js';
import { logger } from '../../utils/logger.js';

// ── Seed definitions ────────────────────────────────────────────────
const SEEDED_ROLES = [
  {
    key: 'MD',
    name: 'Managing Director',
    description: 'Root role — bypasses all permission checks. Cannot be reduced or deleted.',
    isSystem: true,
    isRoot:   true,
    permissions: [], // ignored — root bypasses
  },
  {
    key: 'PLANNER',
    name: 'Production Planner',
    description: 'Plans dispatch phases, manages SKUs, can revise prices (subject to approval threshold).',
    isSystem: true,
    isRoot:   false,
    permissions: [
      'pricing.view', 'pricing.revise',
      'quotes.view', 'quotes.create', 'quotes.edit', 'quotes.exportPdf',
      'orders.view',
      'planning.view', 'planning.editPhases', 'planning.reschedule',
      'execution.view',
      'masters.viewSku', 'masters.editSku', 'masters.viewParty',
    ],
  },
  {
    key: 'SALES_EXEC',
    name: 'Sales Executive',
    description: 'Books customer orders, creates quotes, views prices.',
    isSystem: true,
    isRoot:   false,
    permissions: [
      'pricing.view',
      'quotes.view', 'quotes.create', 'quotes.edit', 'quotes.send', 'quotes.exportPdf',
      'orders.view', 'orders.create',
      'planning.view',
      'masters.viewSku', 'masters.viewParty',
    ],
  },
  {
    key: 'DISPATCH_SUPERVISOR',
    name: 'Dispatch Supervisor',
    description: 'Records actual dispatches against plan phases.',
    isSystem: true,
    isRoot:   false,
    permissions: [
      'orders.view',
      'planning.view',
      'execution.view', 'execution.recordDispatch',
      'masters.viewSku', 'masters.viewParty',
    ],
  },
  {
    key: 'FINANCE',
    name: 'Finance Officer',
    description: 'Reviews quotes, invoices, and price master.',
    isSystem: true,
    isRoot:   false,
    permissions: [
      'pricing.view',
      'quotes.view', 'quotes.exportPdf',
      'orders.view',
      'execution.view',
      'masters.viewSku', 'masters.viewParty',
    ],
  },
  {
    key: 'VIEWER',
    name: 'Read-only',
    description: 'View-only access to every module. Cannot make changes.',
    isSystem: true,
    isRoot:   false,
    permissions: [
      'pricing.view',
      'quotes.view',
      'orders.view',
      'planning.view',
      'execution.view',
      'masters.viewSku', 'masters.viewParty',
      'settings.view',
      'accessControl.viewAuditLog',
    ],
  },
];

/** Map a legacy `User.role` enum value to a v2 Role.key. */
const legacyRoleToKey = (legacyRole) => {
  if (legacyRole === 'MD') return 'MD';
  // Everyone else gets VIEWER by default — MD will reassign through the UI.
  return 'VIEWER';
};

const upsertSeededRoles = async () => {
  let created = 0;
  let refreshed = 0;
  for (const def of SEEDED_ROLES) {
    const existing = await Role.findOne({ key: def.key });
    if (!existing) {
      await Role.create(def);
      created += 1;
    } else if (existing.isSystem) {
      // Refresh permissions / metadata for system roles, preserve member count.
      existing.name        = def.name;
      existing.description = def.description;
      existing.isRoot      = def.isRoot;
      existing.permissions = def.permissions;
      existing.isSystem    = true;
      await existing.save();
      refreshed += 1;
    }
  }
  invalidateRoleCache();
  return { created, refreshed };
};

const backfillUserRoles = async () => {
  // Users that have no v2 `roles[]` yet — populate from legacy `role`.
  const usersToBackfill = await User.find({
    $or: [{ roles: { $exists: false } }, { roles: { $size: 0 } }],
  }).select('_id role roles');

  let updated = 0;
  for (const u of usersToBackfill) {
    const key = legacyRoleToKey(u.role);
    u.roles = [key];
    await u.save({ validateModifiedOnly: true });
    updated += 1;
  }
  return updated;
};

const refreshRoleMemberCounts = async () => {
  const roles = await Role.find({}).select('_id key');
  for (const r of roles) {
    const count = await User.countDocuments({ roles: r.key, isActive: { $ne: false } });
    if (r.memberCount !== count) {
      await Role.updateOne({ _id: r._id }, { memberCount: count });
    }
  }
};

/** Public entry point. Call once on app boot. */
export const seedAccessControl = async () => {
  try {
    const { created, refreshed } = await upsertSeededRoles();
    const backfilled = await backfillUserRoles();
    await refreshRoleMemberCounts();
    logger.info(
      `[access-control] seed complete — roles created:${created}, refreshed:${refreshed}, users backfilled:${backfilled}`,
    );
  } catch (err) {
    logger.error('[access-control] seed failed:', err);
    // Don't crash the app — seed failure is recoverable at runtime.
  }
};

export default seedAccessControl;
