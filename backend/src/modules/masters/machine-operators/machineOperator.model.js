/**
 * Machine Operator master — the shop-floor workers who run the DPR entries.
 *
 * Source of truth: excel/"machine and operator.xlsx", column C (name) and
 * column E (the department of the row they appear on). The sheet gives operators
 * no employee code and no status of their own, so neither is invented — `code`
 * stays an optional free field and activity rides on the BaseSchema `isActive`.
 *
 * Identity is `nameKey` (trim + collapse whitespace + lowercase). The data
 * supports this: all 99 names are distinct once trimmed, and it is what
 * collapses the duplicated "Pallavi" row and the three names carrying trailing
 * spaces ("Chotu Balak ", "Pawan Lekha ", "Arvind ").
 *
 * `machineCodes` is a DERIVED MIRROR of MachineOperatorAssignment, kept only so
 * PPC's dependent DPR dropdown keeps working unchanged. It is written by exactly
 * one function — syncOperatorMachineCodes() in assignment.service.js — and must
 * never be set by a caller. The assignment collection is the authority.
 *
 * Keeps the Mongoose name 'Operator': PPC resolves it by that name.
 */
import mongoose from 'mongoose';
import { baseSchemaFields, baseSchemaOptions } from '../../../database/BaseSchema.js';

const { Schema, model } = mongoose;

/** The stable identity used for dedup and for idempotent import. */
export const operatorNameKey = (name) =>
  String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');

const OperatorSchema = new Schema({
  ...baseSchemaFields,

  name:    { type: String, required: true, trim: true },
  nameKey: { type: String, required: true, trim: true, lowercase: true },
  code:    { type: String, trim: true, uppercase: true, default: '' },

  /**
   * Primary department, plus the full set. Three operators legitimately appear
   * under two departments in the source (Appoo, Bhola, Rambabu), so a single
   * scalar would lose information — but a scalar is what every screen and the
   * DPR filter read, so both are kept.
   */
  department:  { type: String, trim: true, default: '' },
  departments: [{ type: String, trim: true }],

  shift: { type: String, trim: true, default: '' },

  /** Derived mirror — see the file header. Do not write directly. */
  machineCodes: [{ type: String, uppercase: true, trim: true }],
}, baseSchemaOptions);

OperatorSchema.pre('save', function applyNameKey(next) {
  if (this.name) this.nameKey = operatorNameKey(this.name);
  next();
});

/** Unique among LIVE operators only — see the matching note on Machine.code. */
OperatorSchema.index({ nameKey: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
OperatorSchema.index({ name: 'text', code: 'text', department: 'text' });
OperatorSchema.index({ machineCodes: 1 });
OperatorSchema.index({ isDeleted: 1, name: 1 });
OperatorSchema.index({ companyId: 1 });

const Operator = model('Operator', OperatorSchema);
export default Operator;
