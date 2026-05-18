/**
 * Role model.
 *
 * Roles are DATA (MD can add / rename / soft-delete them at runtime).
 * Permission *slugs*, on the other hand, are part of the application
 * contract and live in `common/permissions/registry.js`.
 *
 * Hard rules enforced here:
 *   - `key` is the unique slug (e.g. 'MD', 'SALES_EXEC') — never edited.
 *   - `isRoot: true` ⇒ this role bypasses all permission checks. Reserved for MD.
 *   - `isSystem: true` ⇒ seeded role; cannot be deleted (renaming/permission edits
 *     are still allowed on non-root system roles).
 *   - Every slug in `permissions[]` is validated against the registry at save.
 */

import mongoose from 'mongoose';
import { baseSchemaFields, baseSchemaOptions } from '../../database/BaseSchema.js';
import { assertValidPermission } from '../../common/permissions/registry.js';

const { Schema, model } = mongoose;

const RoleSchema = new Schema({
  ...baseSchemaFields,

  key: {
    type: String,
    required: true,
    uppercase: true,
    trim: true,
    match: [/^[A-Z][A-Z0-9_]{1,40}$/, 'Role key must be UPPER_SNAKE_CASE and start with a letter.'],
  },
  name:        { type: String, required: true, trim: true },
  description: { type: String, default: '' },

  isSystem: { type: Boolean, default: false }, // seeded role, cannot be deleted
  isRoot:   { type: Boolean, default: false }, // bypasses permission checks (MD only)

  permissions: { type: [String], default: [] },

  memberCount: { type: Number, default: 0 }, // denormalised; refreshed when users change
}, baseSchemaOptions);

RoleSchema.index({ key: 1 }, { unique: true });

// Validate every permission slug against the registry on save.
RoleSchema.pre('save', function (next) {
  try {
    for (const slug of this.permissions) assertValidPermission(slug);
    next();
  } catch (err) {
    next(err);
  }
});

const Role = model('Role', RoleSchema);
export default Role;
