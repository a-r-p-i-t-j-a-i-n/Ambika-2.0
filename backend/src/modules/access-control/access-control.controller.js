import asyncHandler from '../../middleware/asyncHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import * as svc from './access-control.service.js';

export const accessControlController = {
  // ── Registry ───────────────────────────────────────────────────
  getRegistry: asyncHandler(async (_req, res) => {
    res.json(ApiResponse.ok('Permission registry', svc.getPermissionRegistry()));
  }),

  // ── Users ──────────────────────────────────────────────────────
  listUsers: asyncHandler(async (req, res) => {
    const data = await svc.listUsers(req.query);
    res.json(ApiResponse.ok('Users', data));
  }),

  getUser: asyncHandler(async (req, res) => {
    const data = await svc.getUserDetail(req.params.id);
    res.json(ApiResponse.ok('User detail', data));
  }),

  inviteUser: asyncHandler(async (req, res) => {
    const data = await svc.inviteUser(req.body, req.user, req);
    res.status(201).json(ApiResponse.created('User invited', data));
  }),

  updateUser: asyncHandler(async (req, res) => {
    const data = await svc.updateUser(req.params.id, req.body, req.user, req);
    res.json(ApiResponse.ok('User updated', data));
  }),

  resetUserPassword: asyncHandler(async (req, res) => {
    const data = await svc.resetUserPassword(req.params.id, req.body.newPassword, req.user, req);
    res.json(ApiResponse.ok('Password reset', data));
  }),

  // ── Roles ──────────────────────────────────────────────────────
  listRoles: asyncHandler(async (_req, res) => {
    const data = await svc.listRoles();
    res.json(ApiResponse.ok('Roles', data));
  }),

  getRole: asyncHandler(async (req, res) => {
    const data = await svc.getRoleDetail(req.params.id);
    res.json(ApiResponse.ok('Role detail', data));
  }),

  createRole: asyncHandler(async (req, res) => {
    const data = await svc.createRole(req.body, req.user, req);
    res.status(201).json(ApiResponse.created('Role created', data));
  }),

  updateRole: asyncHandler(async (req, res) => {
    const data = await svc.updateRole(req.params.id, req.body, req.user, req);
    res.json(ApiResponse.ok('Role updated', data));
  }),

  deleteRole: asyncHandler(async (req, res) => {
    const data = await svc.deleteRole(req.params.id, req.user, req);
    res.json(ApiResponse.ok('Role deleted', data));
  }),

  // ── Audit log ──────────────────────────────────────────────────
  getAuditLog: asyncHandler(async (req, res) => {
    const data = await svc.getAuditLog(req.query);
    res.json(ApiResponse.ok('Access audit log', data));
  }),

  // ── Convenience: my own permissions (for the SPA on boot) ──────
  me: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('Current permissions', {
      user: {
        _id:         req.user._id,
        name:        req.user.name,
        email:       req.user.email,
        mobile:      req.user.mobile,
        role:        req.user.role,         // legacy enum (used by sidebar + UI labels)
        roles:       req.user.roles || [],  // v2 role keys
        isActive:    req.user.isActive,
        invitedAt:   req.user.invitedAt,
        lastLoginAt: req.user.lastLoginAt,
        createdAt:   req.user.createdAt,
        updatedAt:   req.user.updatedAt,
      },
      permissions: [...(req.userPermissions || [])],
      isRoot: !!req.userIsRoot,
    }));
  }),
};
