/**
 * Permission middlewares.
 *
 *   attachUserPermissions  — runs after `protect`, resolves the user's effective
 *                            permission set ONCE per request and stashes it on
 *                            `req.userPermissions` (a Set for O(1) checks).
 *
 *   requirePermission(...) — gate route handlers. Pass one slug or many (OR logic).
 *                            Use `requireAllPermissions(...)` for AND logic.
 *
 * The effective set is computed as:
 *     union(permissions of each assigned role)
 *       + permissionGrants
 *       + session grants (Delegation Suite sign-in, see auth.middleware)
 *       − permissionDenies
 *
 * A user whose effective set contains the sentinel '*' (ROOT_PERMISSION) bypasses
 * every check. This is granted exclusively by the seeded `MD` role (`isRoot: true`).
 *
 * Legacy compat: if a user has the legacy `role: 'MD'` field but no `roles[]`
 * entry yet (pre-migration), we still treat them as root. The Step-2 migration
 * removes this fallback by writing `roles: ['MD']` onto the doc.
 */

import asyncHandler from './asyncHandler.js';
import { AppError } from '../utils/apiResponse.js';
import { ROOT_PERMISSION } from '../common/permissions/registry.js';
import Role from '../modules/access-control/role.model.js';

/**
 * In-memory cache of role → permission-set.
 * Roles change rarely; flushing happens on role create/edit/delete (see access-control service).
 */
const roleCache = new Map();

export const invalidateRoleCache = (roleKey) => {
  if (roleKey) roleCache.delete(roleKey);
  else roleCache.clear();
};

const loadRolePermissions = async (roleKey) => {
  if (roleCache.has(roleKey)) return roleCache.get(roleKey);
  const role = await Role.findOne({ key: roleKey, isDeleted: { $ne: true } }).lean();
  if (!role) {
    roleCache.set(roleKey, { permissions: new Set(), isRoot: false });
    return roleCache.get(roleKey);
  }
  const permissions = new Set(role.isRoot ? [ROOT_PERMISSION] : role.permissions || []);
  const entry = { permissions, isRoot: !!role.isRoot };
  roleCache.set(roleKey, entry);
  return entry;
};

const computeEffectivePermissions = async (user, sessionGrants = []) => {
  if (!user) return new Set();

  const effective = new Set();
  let isRoot = false;

  // 1) Legacy compat: pre-migration users with role: 'MD' are root.
  if (user.role === 'MD' && (!user.roles || user.roles.length === 0)) {
    isRoot = true;
  }

  // 2) Walk every assigned role.
  const roleKeys = Array.isArray(user.roles) ? user.roles : [];
  for (const key of roleKeys) {
    const { permissions, isRoot: roleIsRoot } = await loadRolePermissions(key);
    if (roleIsRoot) isRoot = true;
    for (const p of permissions) effective.add(p);
  }

  // 3) Direct grants (overlay on top of role perms).
  for (const p of user.permissionGrants || []) effective.add(p);

  // 3b) Grants carried by this session's token (Delegation Suite sign-in).
  for (const p of sessionGrants) effective.add(p);

  // 4) Direct denies (revoke even if granted by role).
  for (const p of user.permissionDenies || []) effective.delete(p);

  // Root overrides everything.
  if (isRoot) {
    effective.add(ROOT_PERMISSION);
  }

  return effective;
};

export const attachUserPermissions = asyncHandler(async (req, _res, next) => {
  if (!req.user) return next();
  req.userPermissions = await computeEffectivePermissions(req.user, req.sessionGrants);
  req.userIsRoot = req.userPermissions.has(ROOT_PERMISSION);
  next();
});

const userHas = (permSet, slug) => permSet.has(ROOT_PERMISSION) || permSet.has(slug);

/**
 * Gate a route on at least ONE of the supplied permission slugs.
 *   requirePermission('pricing.revise')
 *   requirePermission('pricing.approve', 'pricing.revise')  // OR
 */
export const requirePermission = (...slugs) => asyncHandler(async (req, _res, next) => {
  if (!req.userPermissions) {
    req.userPermissions = await computeEffectivePermissions(req.user, req.sessionGrants);
  }
  const ok = slugs.some((s) => userHas(req.userPermissions, s));
  if (!ok) {
    return next(new AppError(
      `Forbidden — requires permission: ${slugs.join(' OR ')}`,
      403,
    ));
  }
  next();
});

/** AND-logic variant. Use sparingly. */
export const requireAllPermissions = (...slugs) => asyncHandler(async (req, _res, next) => {
  if (!req.userPermissions) {
    req.userPermissions = await computeEffectivePermissions(req.user, req.sessionGrants);
  }
  const ok = slugs.every((s) => userHas(req.userPermissions, s));
  if (!ok) {
    return next(new AppError(
      `Forbidden — requires all permissions: ${slugs.join(' AND ')}`,
      403,
    ));
  }
  next();
});

/** Exported for non-middleware contexts (service layer decisions). */
export const userHasPermission = (req, slug) => {
  if (!req.userPermissions) return false;
  return userHas(req.userPermissions, slug);
};

export { computeEffectivePermissions };
