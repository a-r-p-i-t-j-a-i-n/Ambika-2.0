import Joi from 'joi';

const roleKey = Joi.string().pattern(/^[A-Z][A-Z0-9_]{1,40}$/);
const permSlug = Joi.string().pattern(/^[a-zA-Z]+\.[a-zA-Z]+$/);

export const inviteUserSchema = Joi.object({
  name:     Joi.string().min(2).max(80).required(),
  email:    Joi.string().email().required(),
  roles:    Joi.array().items(roleKey).default([]),
  password: Joi.string().min(6).optional(),
});

export const updateUserSchema = Joi.object({
  name:             Joi.string().min(2).max(80),
  roles:            Joi.array().items(roleKey),
  permissionGrants: Joi.array().items(permSlug),
  permissionDenies: Joi.array().items(permSlug),
  isActive:         Joi.boolean(),
  reason:           Joi.string().allow('').max(500),
}).min(1);

export const resetPasswordSchema = Joi.object({
  newPassword: Joi.string().min(6).required(),
});

export const createRoleSchema = Joi.object({
  key:         roleKey.required(),
  name:        Joi.string().min(2).max(80).required(),
  description: Joi.string().allow('').max(500),
  permissions: Joi.array().items(permSlug).default([]),
});

export const updateRoleSchema = Joi.object({
  name:        Joi.string().min(2).max(80),
  description: Joi.string().allow('').max(500),
  permissions: Joi.array().items(permSlug),
}).min(1);

export const auditQuerySchema = Joi.object({
  page:       Joi.number().integer().min(1).default(1),
  limit:      Joi.number().integer().min(1).max(200).default(50),
  actorId:    Joi.string().hex().length(24),
  action:     Joi.string(),
  targetType: Joi.string().valid('User', 'Role'),
});
