import mongoose from 'mongoose';
import { baseSchemaFields, baseSchemaOptions } from '../../database/BaseSchema.js';
import { RM_RECEIVED_AT_LOCATIONS } from './inventoryStock.model.js';

const { Schema, model } = mongoose;

/**
 * A PHYSICAL COIL THAT HAS NO GOODS RECEIPT — "Manual Entry — No GRN" on Cut Coils.
 *
 * Every other physical coil is identified by its GRN_IN movement, and every
 * lineage reader (rounds, remaining weight, Cutting History, Scrap by Physical
 * Coil) is keyed on that movement's id. A coil cut before its GRN was raised,
 * or one that never had a GRN, has no such movement, and the only option used
 * to be "No receipt available" — a cut that names no coil at all, so its
 * original weight is lost, a second round cannot find the first, and its scrap
 * is untraceable.
 *
 * This record is the identity such a coil is missing, and nothing more:
 *
 *   • It is NOT a receipt. It posts no stock, carries no GRN/PO/supplier, and
 *     no movement points at it as a GRN_IN. The coil's weight still has to be
 *     in RM stock already (opening stock, a Stock In, an unbatched GRN) — the
 *     cut takes it off the SKU at item level with the same stock check every
 *     no-receipt cut has always had.
 *   • It stores exactly one fact the ledger cannot answer: the ORIGINAL weight
 *     of the whole coil, as the operator weighed it. Rounds and the remaining
 *     weight stay derived from its CoilConversions (`manualCoilId`), the same
 *     arithmetic GRN coils use (coilLineage.js) — there is no counter here.
 *
 * One record per batch number, enforced by the database (`batchKey`), so
 * entering the same coil a second time cannot create a second identity with a
 * second original weight. A batch that already has a goods receipt is refused
 * by the service: that coil is cut from its GRN, never from here.
 */
const manualCoilSchema = new Schema({
  ...baseSchemaFields,

  // As typed (trimmed) — what people read.
  batchNo:  { type: String, trim: true, required: true },
  // Upper-cased, trimmed copy used for uniqueness and lookups: operators type
  // batch numbers off a label in whatever case the label uses.
  batchKey: { type: String, trim: true, uppercase: true, required: true },

  coilSkuId:   { type: Schema.Types.ObjectId, ref: 'SKU', required: true, index: true },
  coilSkuCode: { type: String, trim: true, uppercase: true, default: '' },
  coilSkuName: { type: String, trim: true, default: '' },
  unit:        { type: String, trim: true, default: 'KGS' },

  // The whole physical coil, before any round. Never recalculated from a cut.
  originalWeightKg: { type: Number, required: true, min: 0.001 },

  // Where the operator said the coil is held/cut on the first round, and the
  // rate typed then. Defaults for later rounds only — each round still records
  // its own location and rate on its conversion.
  warehouse: { type: String, enum: [...RM_RECEIVED_AT_LOCATIONS, null], default: null },
  rate:      { type: Number, default: 0, min: 0 },

  /**
   * Touched by every round, inside the round's session. Not a fact anyone
   * reads for its value: writing the coil's own document is what makes two
   * rounds of the SAME manual coil saved at the same moment conflict with each
   * other (on a replica set), instead of both passing the remaining-weight check.
   */
  lastRoundSavedAt: { type: Date, default: null },
}, baseSchemaOptions);

// One identity per batch number. Partial on isDeleted so a soft-deleted entry
// never blocks re-entering a coil correctly.
manualCoilSchema.index(
  { batchKey: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } },
);

export const manualBatchKey = (batchNo) => String(batchNo ?? '').trim().toUpperCase();

const ManualCoil = model('ManualCoil', manualCoilSchema);
export default ManualCoil;
