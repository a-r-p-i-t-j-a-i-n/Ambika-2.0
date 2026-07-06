import { AppError } from '../../utils/apiResponse.js';

/**
 * Hard role-identity gate for the Digital Approval engine — deliberately
 * separate from `requirePermission` (backend/src/middleware/permission.middleware.js),
 * which layers grantable, per-user permission overlays on top of roles. The
 * business rule here is stricter: only a user who actually HOLDS the given
 * role (e.g. 'MD') may sign, replace, or remove a signature — that authority
 * can never be delegated via a permission grant to a non-MD user.
 *
 * Checks both the legacy single `role` field and the v2 `roles[]` array so it
 * works regardless of which access-control generation a user was created under.
 *
 * v1 note: routes call this with a static roleKey ('MD') since only one
 * approval level exists today. A future multi-level chain would instead read
 * the document's current level (`DocumentApproval.levels[currentLevelOrder]`)
 * inside the controller before gating — this middleware itself doesn't need
 * to change, only what it's called with.
 */
export const requireApprovalRole = (roleKey) => (req, _res, next) => {
  const user = req.user;
  const held = user?.role === roleKey || (Array.isArray(user?.roles) && user.roles.includes(roleKey));
  if (!held) {
    return next(new AppError(`Only a ${roleKey} user can perform this action`, 403));
  }
  next();
};
