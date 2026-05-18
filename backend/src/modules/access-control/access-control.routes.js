import { Router } from 'express';
import { protect } from '../../middleware/auth.middleware.js';
import {
  attachUserPermissions,
  requirePermission,
} from '../../middleware/permission.middleware.js';
import validate from '../../middleware/validate.js';
import { accessControlController as c } from './access-control.controller.js';
import {
  inviteUserSchema,
  updateUserSchema,
  resetPasswordSchema,
  createRoleSchema,
  updateRoleSchema,
  auditQuerySchema,
} from './access-control.validation.js';

const router = Router();

// Every route requires authentication + permission resolution.
router.use(protect, attachUserPermissions);

// ── My own permissions (any signed-in user) ────────────────────────
router.get('/me', c.me);

// ── Permission registry (admins only — used by the matrix UI) ──────
router.get(
  '/registry',
  requirePermission('accessControl.manageUsers', 'accessControl.manageRoles'),
  c.getRegistry,
);

// ── Users ──────────────────────────────────────────────────────────
router.get(
  '/users',
  requirePermission('accessControl.manageUsers'),
  c.listUsers,
);
router.get(
  '/users/:id',
  requirePermission('accessControl.manageUsers'),
  c.getUser,
);
router.post(
  '/users',
  requirePermission('accessControl.manageUsers'),
  validate(inviteUserSchema),
  c.inviteUser,
);
router.patch(
  '/users/:id',
  requirePermission('accessControl.manageUsers'),
  validate(updateUserSchema),
  c.updateUser,
);
router.post(
  '/users/:id/reset-password',
  requirePermission('accessControl.manageUsers'),
  validate(resetPasswordSchema),
  c.resetUserPassword,
);

// ── Roles ──────────────────────────────────────────────────────────
router.get(
  '/roles',
  requirePermission('accessControl.manageRoles', 'accessControl.manageUsers'),
  c.listRoles,
);
router.get(
  '/roles/:id',
  requirePermission('accessControl.manageRoles', 'accessControl.manageUsers'),
  c.getRole,
);
router.post(
  '/roles',
  requirePermission('accessControl.manageRoles'),
  validate(createRoleSchema),
  c.createRole,
);
router.patch(
  '/roles/:id',
  requirePermission('accessControl.manageRoles'),
  validate(updateRoleSchema),
  c.updateRole,
);
router.delete(
  '/roles/:id',
  requirePermission('accessControl.manageRoles'),
  c.deleteRole,
);

// ── Audit log ──────────────────────────────────────────────────────
router.get(
  '/audit-log',
  requirePermission('accessControl.viewAuditLog', 'accessControl.manageUsers'),
  validate(auditQuerySchema, 'query'),
  c.getAuditLog,
);

export default router;
