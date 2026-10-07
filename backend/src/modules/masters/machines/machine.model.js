/**
 * Machine master — every press / spinning / cutting / buffing unit on the floor,
 * keyed by the short code the operator picks in the DPR (e.g. "SAP01", "S07").
 *
 * Source of truth: excel/"machine and operator.xlsx", sheet
 * "Machine Name with Code & Operat", columns A–N. Every field here maps to a
 * real column on that sheet — nothing is invented. `make` and
 * `maintenanceManualType` exist as columns but are empty in the source, so they
 * default to '' and are simply editable from the UI.
 *
 * Two fields are derived, never hand-entered:
 *   uid          `${code} - ${name}`  — holds for 109/109 source rows
 *   machineType  inferred from the code prefix; a controlled 9-value vocabulary
 *                that ProcessRoute matches against (NOT the display name)
 *
 * This model lives under masters/ but keeps the Mongoose name 'Machine' — PPC's
 * DPR form and OEE dashboards resolve it by that name.
 */
import mongoose from 'mongoose';
import { baseSchemaFields, baseSchemaOptions } from '../../../database/BaseSchema.js';
import { MACHINE_TYPES, DEFAULT_MACHINE_TYPE, machineTypeFromCode } from './machineType.js';

const { Schema, model } = mongoose;

/**
 * Column I of the sheet is headed "In Use/ Not in Use/ Scrap(Dead)". Only the
 * first two appear in the data (In use ×120, Not in Use ×3); SCRAP is carried
 * because the header authorises it and the floor needs somewhere to retire a
 * machine to without deleting its history.
 */
export const MACHINE_STATUSES = ['IN_USE', 'NOT_IN_USE', 'SCRAP'];

/** Columns J and K are Y/N columns that are blank on most rows. */
export const YES_NO = ['YES', 'NO', ''];

export const CAPACITY_UNITS = ['TON', 'HP', ''];

/** "In use" → IN_USE, "Scrap(Dead)" → SCRAP. Unknown/blank falls back to IN_USE. */
export const normalizeMachineStatus = (raw) => {
  const v = String(raw || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!v) return 'IN_USE';
  if (v.startsWith('not in use') || v === 'not used' || v === 'idle') return 'NOT_IN_USE';
  if (v.includes('scrap') || v.includes('dead')) return 'SCRAP';
  if (v.startsWith('in use')) return 'IN_USE';
  return 'IN_USE';
};

/**
 * Capacity is stored verbatim (the sheet mixes "5 HP", "50 Ton" and bare "4.5"),
 * with a best-effort parse alongside it for sorting/filtering. A bare number
 * yields a value with no unit rather than a guessed one.
 */
export const parseCapacity = (raw) => {
  const text = String(raw ?? '').trim();
  if (!text) return { capacityValue: null, capacityUnit: '' };
  const m = text.match(/^([\d.]+)\s*(ton|tn|hp)?$/i);
  if (!m) return { capacityValue: null, capacityUnit: '' };
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return { capacityValue: null, capacityUnit: '' };
  const rawUnit = (m[2] || '').toLowerCase();
  const unit = rawUnit === 'hp' ? 'HP' : (rawUnit ? 'TON' : '');
  return { capacityValue: value, capacityUnit: unit };
};

export const buildMachineUid = (code, name) => {
  const c = String(code || '').trim().toUpperCase();
  const n = String(name || '').trim();
  if (!c) return '';
  return n ? `${c} - ${n}` : c;
};

/**
 * Everything computed from other fields. Called by the pre-save hook and, for
 * the findOneAndUpdate paths, directly by the service against the merged doc.
 */
export const deriveMachineFields = (doc = {}) => {
  const machineStatus = MACHINE_STATUSES.includes(doc.machineStatus)
    ? doc.machineStatus
    : normalizeMachineStatus(doc.machineStatus);
  return {
    uid: buildMachineUid(doc.code, doc.name),
    machineType: doc.machineType || machineTypeFromCode(doc.code),
    machineStatus,
    // The BaseSchema flag follows the business status; machineStatus stays authoritative.
    isActive: machineStatus === 'IN_USE',
    ...parseCapacity(doc.capacity),
  };
};

const MachineSchema = new Schema({
  ...baseSchemaFields,

  // ── Identity ────────────────────────────────────────────────────
  code: { type: String, required: true, uppercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  uid:  { type: String, trim: true, default: '' },          // derived: `${code} - ${name}`

  // ── Classification ──────────────────────────────────────────────
  machineType: { type: String, enum: MACHINE_TYPES, default: DEFAULT_MACHINE_TYPE, index: true },
  department:  { type: String, trim: true, default: '' },
  make:        { type: String, trim: true, default: '' },   // column F — empty throughout the source

  // ── Specification ───────────────────────────────────────────────
  capacity:         { type: String, trim: true, default: '' },   // verbatim: "5 HP", "50 Ton", "4.5"
  capacityValue:    { type: Number, default: null },             // parsed, null when no clean number
  capacityUnit:     { type: String, enum: CAPACITY_UNITS, default: '' },
  installationYear: { type: Number, default: null, min: 1900 },

  // ── Lifecycle ───────────────────────────────────────────────────
  machineStatus: { type: String, enum: MACHINE_STATUSES, default: 'IN_USE', index: true },

  // ── Maintenance ─────────────────────────────────────────────────
  amc:                   { type: String, enum: YES_NO, default: '' },
  maintenanceManual:     { type: String, enum: YES_NO, default: '' },
  maintenanceManualType: { type: String, trim: true, default: '' },  // column L — empty in the source
  dailyClitSheet:        { type: Boolean, default: false },
  dailyClitLink:         { type: String, trim: true, default: '' },
  halfYearlyPm:          { type: Boolean, default: false },
  halfYearlyPmLink:      { type: String, trim: true, default: '' },

  // ── PPC / DPR ───────────────────────────────────────────────────
  defaultSpm: { type: Number, default: 0, min: 0 },   // fallback strokes-per-minute
}, baseSchemaOptions);

MachineSchema.pre('save', function applyDerived(next) {
  Object.assign(this, deriveMachineFields(this.toObject()));
  next();
});

/**
 * Unique among LIVE machines only. A plain unique index would keep a
 * soft-deleted row squatting on its code forever, so a deleted machine's code
 * could never be reused — and it would disagree with the service, which only
 * treats non-deleted rows as a conflict. Partial keeps the two in step.
 */
MachineSchema.index({ code: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
MachineSchema.index({ name: 'text', code: 'text', department: 'text' });
MachineSchema.index({ machineStatus: 1, code: 1 });
MachineSchema.index({ isDeleted: 1, code: 1 });
MachineSchema.index({ companyId: 1 });

const Machine = model('Machine', MachineSchema);
export default Machine;
