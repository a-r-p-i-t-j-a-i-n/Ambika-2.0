/**
 * Access Control — service layer.
 *
 * Business rules enforced here (in addition to permission gates on the routes):
 *
 *   1. The MD role cannot be edited, renamed, or deleted.
 *   2. A user cannot remove their own MD role (anti-self-lockout).
 *   3. The system always keeps ≥ 1 active MD user — the last MD cannot be
 *      demoted, suspended or deleted.
 *   4. System roles can have their permissions updated, but cannot be deleted.
 *   5. Every mutation writes an AccessAuditLog row.
 */

import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User from '../auth/auth.model.js';
import Role from './role.model.js';
import AccessAuditLog from './access-audit.model.js';
import { AppError } from '../../utils/apiResponse.js';
import {
  PERMISSIONS,
  ALL_PERMISSION_SLUGS,
  permissionsByModule,
  ROOT_PERMISSION,
} from '../../common/permissions/registry.js';
import {
  computeEffectivePermissions,
  invalidateRoleCache,
} from '../../middleware/permission.middleware.js';

const MD_ROLE_KEY = 'MD';

// ── helpers ────────────────────────────────────────────────────────
const sanitizeUser = (u) => {
  if (!u) return null;
  const o = u.toObject ? u.toObject() : u;
  delete o.password;
  return o;
};

const validatePermissionsList = (slugs) => {
  if (!Array.isArray(slugs)) return [];
  const cleaned = [];
  for (const s of slugs) {
    if (s === ROOT_PERMISSION) continue; // never persist '*'; only MD role grants it
    if (!ALL_PERMISSION_SLUGS.has(s)) {
      throw new AppError(`Unknown permission slug: '${s}'`, 400);
    }
    if (!cleaned.includes(s)) cleaned.push(s);
  }
  return cleaned;
};

const ensureAtLeastOneActiveMd = async (excludingUserId = null) => {
  const filter = {
    roles: MD_ROLE_KEY,
    isActive: { $ne: false },
  };
  if (excludingUserId) filter._id = { $ne: excludingUserId };
  const count = await User.countDocuments(filter);
  if (count < 1) {
    throw new AppError(
      'Cannot proceed: the system must keep at least one active Managing Director (MD).',
      400,
    );
  }
};

const writeAudit = async ({ actor, action, targetType, targetId, targetLabel, before, after, reason, req }) => {
  await AccessAuditLog.create({
    actorId:    actor._id,
    actorName:  actor.name,
    actorEmail: actor.email,
    action,
    targetType,
    targetId,
    targetLabel,
    before,
    after,
    reason: reason || '',
    ipAddress: req?.ip,
    userAgent: req?.get?.('User-Agent') || '',
  });
};

// ── Public registry (for UI rendering) ─────────────────────────────
export const getPermissionRegistry = () => ({
  permissions: PERMISSIONS,
  grouped: permissionsByModule(),
});

// ── Users ──────────────────────────────────────────────────────────
export const listUsers = async ({ search = '', status = 'all' } = {}) => {
  const filter = {};
  if (search) {
    const rx = new RegExp(search.trim(), 'i');
    filter.$or = [{ name: rx }, { email: rx }];
  }
  if (status === 'active') filter.isActive = { $ne: false };
  if (status === 'suspended') filter.isActive = false;

  const users = await User
    .find(filter)
    .select('-password')
    .sort({ createdAt: -1 })
    .lean();

  // Attach role labels for fast list rendering.
  const allRoles = await Role.find({}).select('key name isRoot').lean();
  const byKey = new Map(allRoles.map((r) => [r.key, r]));

  return users.map((u) => ({
    ...u,
    roleLabels: (u.roles || []).map((k) => byKey.get(k)?.name || k),
    isRoot:    (u.roles || []).some((k) => byKey.get(k)?.isRoot),
  }));
};

export const getUserDetail = async (userId) => {
  const user = await User.findById(userId).select('-password').lean();
  if (!user) throw new AppError('User not found', 404);

  const allRoles = await Role.find({}).select('key name isRoot permissions').lean();
  const assignedRoles = allRoles.filter((r) => (user.roles || []).includes(r.key));

  // Source of each permission slug: roles | granted | denied
  const provenance = {};
  for (const r of assignedRoles) {
    if (r.isRoot) {
      // For UI clarity we expand the root sentinel into every slug.
      for (const slug of ALL_PERMISSION_SLUGS) {
        provenance[slug] = { source: 'role', roleKey: r.key, roleName: r.name };
      }
    } else {
      for (const slug of r.permissions || []) {
        if (!provenance[slug]) {
          provenance[slug] = { source: 'role', roleKey: r.key, roleName: r.name };
        }
      }
    }
  }
  for (const slug of user.permissionGrants || []) {
    provenance[slug] = { source: 'granted' };
  }
  for (const slug of user.permissionDenies || []) {
    provenance[slug] = { source: 'denied' };
  }

  const effective = await computeEffectivePermissions(user);

  return {
    user,
    assignedRoles,
    provenance,
    effectivePermissions: [...effective],
    isRoot: effective.has(ROOT_PERMISSION),
  };
};

export const inviteUser = async ({ name, email, mobile, roles = [], password }, actor, req) => {
  const exists = await User.findOne({ email: email.toLowerCase() });
  if (exists) throw new AppError('A user with this email already exists.', 409);

  // Validate every role key.
  if (roles.length) {
    const found = await Role.find({ key: { $in: roles } }).select('key').lean();
    const foundKeys = new Set(found.map((r) => r.key));
    for (const k of roles) {
      if (!foundKeys.has(k)) throw new AppError(`Unknown role: ${k}`, 400);
    }
  }

  const tempPassword = password || `Welcome@${Math.floor(100000 + Math.random() * 900000)}`;

  // Legacy `role` field is required (enum). Map first role to a legacy-compatible value
  // for back-compat with `restrictTo('MD')` in older routes.
  const legacyRole = roles.includes(MD_ROLE_KEY) ? 'MD' : 'EA';

  const user = await User.create({
    name,
    email: email.toLowerCase(),
    mobile,
    password: tempPassword,
    role: legacyRole,
    roles,
    invitedAt: new Date(),
    isActive: true,
  });

  await writeAudit({
    actor,
    action: 'USER_INVITED',
    targetType: 'User',
    targetId: user._id,
    targetLabel: user.name,
    before: null,
    after: { email: user.email, roles },
    req,
  });

  const safe = sanitizeUser(user);
  return { user: safe, tempPassword };
};

export const updateUser = async (userId, patch, actor, req) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const user = await User.findById(userId).session(session);
    if (!user) throw new AppError('User not found', 404);

    const before = {
      roles: [...(user.roles || [])],
      permissionGrants: [...(user.permissionGrants || [])],
      permissionDenies: [...(user.permissionDenies || [])],
      isActive: user.isActive,
    };

    // ── Validate inputs ───────────────────────────────────────────
    if (patch.roles !== undefined) {
      if (!Array.isArray(patch.roles)) throw new AppError('roles must be an array of role keys', 400);
      if (patch.roles.length) {
        const found = await Role.find({ key: { $in: patch.roles } }).select('key').lean();
        if (found.length !== new Set(patch.roles).size) {
          throw new AppError('One or more role keys are invalid.', 400);
        }
      }
    }
    if (patch.permissionGrants !== undefined) {
      patch.permissionGrants = validatePermissionsList(patch.permissionGrants);
    }
    if (patch.permissionDenies !== undefined) {
      patch.permissionDenies = validatePermissionsList(patch.permissionDenies);
    }

    // ── Lockout guards ────────────────────────────────────────────
    const willHaveMd = (patch.roles ?? user.roles ?? []).includes(MD_ROLE_KEY);
    const willBeActive = patch.isActive === undefined ? user.isActive : patch.isActive;

    // Don't allow an MD to demote themselves.
    if (
      String(actor._id) === String(user._id) &&
      (user.roles || []).includes(MD_ROLE_KEY) &&
      !willHaveMd
    ) {
      throw new AppError('You cannot remove your own MD role.', 400);
    }

    // Keep ≥ 1 active MD in the system.
    const losingMdStatus =
      (user.roles || []).includes(MD_ROLE_KEY) &&
      (!willHaveMd || !willBeActive);
    if (losingMdStatus) {
      await ensureAtLeastOneActiveMd(user._id);
    }

    // ── Apply changes ─────────────────────────────────────────────
    if (patch.roles !== undefined) {
      user.roles = patch.roles;
      // Keep legacy `role` enum in sync minimally.
      if (patch.roles.includes(MD_ROLE_KEY)) user.role = 'MD';
    }
    if (patch.permissionGrants !== undefined) user.permissionGrants = patch.permissionGrants;
    if (patch.permissionDenies !== undefined) user.permissionDenies = patch.permissionDenies;
    if (patch.isActive !== undefined) user.isActive = patch.isActive;
    if (patch.name !== undefined) user.name = patch.name;

    await user.save({ session });

    const after = {
      roles: [...(user.roles || [])],
      permissionGrants: [...(user.permissionGrants || [])],
      permissionDenies: [...(user.permissionDenies || [])],
      isActive: user.isActive,
    };

    // ── Audit ─────────────────────────────────────────────────────
    let action = 'USER_UPDATED';
    if (before.isActive !== after.isActive) {
      action = after.isActive ? 'USER_REACTIVATED' : 'USER_SUSPENDED';
    }

    await AccessAuditLog.create([{
      actorId: actor._id,
      actorName: actor.name,
      actorEmail: actor.email,
      action,
      targetType: 'User',
      targetId: user._id,
      targetLabel: user.name,
      before,
      after,
      reason: patch.reason || '',
      ipAddress: req?.ip,
      userAgent: req?.get?.('User-Agent') || '',
    }], { session });

    await session.commitTransaction();
    invalidateRoleCache(); // role-list per-user changed; cheap to flush
    return sanitizeUser(user);
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
};

export const resetUserPassword = async (userId, newPassword, actor, req) => {
  const user = await User.findById(userId);
  if (!user) throw new AppError('User not found', 404);
  user.password = newPassword;
  await user.save();
  await writeAudit({
    actor,
    action: 'USER_UPDATED',
    targetType: 'User',
    targetId: user._id,
    targetLabel: user.name,
    before: { passwordReset: false },
    after:  { passwordReset: true },
    reason: 'Password reset by admin',
    req,
  });
  return { ok: true };
};

// ── Roles ──────────────────────────────────────────────────────────
export const listRoles = async () => {
  const roles = await Role.find({}).sort({ isRoot: -1, isSystem: -1, name: 1 }).lean();
  return roles;
};

export const getRoleDetail = async (roleId) => {
  const role = await Role.findById(roleId).lean();
  if (!role) throw new AppError('Role not found', 404);
  return role;
};

export const createRole = async ({ key, name, description, permissions = [] }, actor, req) => {
  if (key === MD_ROLE_KEY) throw new AppError('Cannot create another MD role.', 400);
  const exists = await Role.findOne({ key });
  if (exists) throw new AppError(`Role '${key}' already exists.`, 409);

  const validated = validatePermissionsList(permissions);
  const role = await Role.create({
    key, name, description,
    permissions: validated,
    isSystem: false,
    isRoot: false,
    createdBy: actor._id,
  });
  await writeAudit({
    actor, action: 'ROLE_CREATED',
    targetType: 'Role', targetId: role._id, targetLabel: role.key,
    before: null, after: { name, permissions: validated }, req,
  });
  invalidateRoleCache(role.key);
  return role.toObject();
};

export const updateRole = async (roleId, patch, actor, req) => {
  const role = await Role.findById(roleId);
  if (!role) throw new AppError('Role not found', 404);
  if (role.isRoot) throw new AppError('The MD role is immutable.', 400);

  const before = {
    name: role.name,
    description: role.description,
    permissions: [...role.permissions],
  };

  if (patch.name !== undefined) role.name = patch.name;
  if (patch.description !== undefined) role.description = patch.description;
  if (patch.permissions !== undefined) {
    role.permissions = validatePermissionsList(patch.permissions);
  }
  role.updatedBy = actor._id;
  await role.save();

  await writeAudit({
    actor, action: 'ROLE_UPDATED',
    targetType: 'Role', targetId: role._id, targetLabel: role.key,
    before, after: {
      name: role.name, description: role.description, permissions: [...role.permissions],
    },
    req,
  });
  invalidateRoleCache(role.key);
  return role.toObject();
};

export const deleteRole = async (roleId, actor, req) => {
  const role = await Role.findById(roleId);
  if (!role) throw new AppError('Role not found', 404);
  if (role.isRoot)   throw new AppError('The MD role cannot be deleted.', 400);
  if (role.isSystem) throw new AppError('System roles cannot be deleted (you can edit their permissions).', 400);

  const inUse = await User.countDocuments({ roles: role.key });
  if (inUse > 0) {
    throw new AppError(`Role '${role.key}' is still assigned to ${inUse} user(s). Reassign them first.`, 400);
  }

  await role.deleteOne();
  await writeAudit({
    actor, action: 'ROLE_DELETED',
    targetType: 'Role', targetId: role._id, targetLabel: role.key,
    before: { key: role.key, name: role.name, permissions: [...role.permissions] },
    after: null,
    req,
  });
  invalidateRoleCache(role.key);
  return { ok: true };
};

// ── Audit Log ──────────────────────────────────────────────────────
export const getAuditLog = async ({
  page = 1, limit = 50, actorId, action, targetType,
} = {}) => {
  const filter = {};
  if (actorId) filter.actorId = actorId;
  if (action) filter.action = action;
  if (targetType) filter.targetType = targetType;

  const skip = (Math.max(1, page) - 1) * limit;
  const [rows, total] = await Promise.all([
    AccessAuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    AccessAuditLog.countDocuments(filter),
  ]);
  return { rows, total, page, limit };
};
