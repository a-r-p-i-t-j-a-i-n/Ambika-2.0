import mongoose from 'mongoose';
import { baseSchemaFields, baseSchemaOptions } from '../../database/BaseSchema.js';

const { Schema, model } = mongoose;

/**
 * Scrap Record — one cut of a coil, and what was left over.
 *
 * Mirrors one row of the client's "Summary Scrap" sheet. That sheet is not a
 * data-entry form: every column in it is a formula pulling from elsewhere —
 * location, date, batch, coil and rate come from the coil's Purchase record,
 * the circle figures are a TEXTJOIN over Coil Out & Circle In, scrap is
 * `coil weight − circle weight` and yield is `circle weight ÷ coil weight`.
 * Exactly ONE column is typed by a human: "Scrap Verified".
 *
 * So this document is a materialised view of a cut, kept for three reasons the
 * ledger cannot serve on its own: the verification state (the only real input),
 * the yield per batch, and the split between in-house and job-work cutting.
 *
 * ── THIS IS NOT THE SCRAP BALANCE ───────────────────────────────────────────
 * This document is a record of a CUT, not a stock row. The scrap BALANCE lives
 * where every other balance lives — InventoryStock, against the scrap SKU,
 * moved only by InventoryMovement. The two are deliberately separate
 * collections:
 *
 *   • This model answers "what did each cut leave behind, and was it checked?"
 *     Its totals are a production/yield measure and must stay comparable with
 *     the client's Summary Scrap sheet, so manual Scrap In/Out — which is not a
 *     cut — never writes here. That is what keeps every dashboard figure in
 *     this module numerically identical to what it reported before stock
 *     existed.
 *   • InventoryMovement answers "how much scrap do we hold, and where did it
 *     go?"
 *
 * An IN-HOUSE cut (location PLG01) now also posts one SCRAP_IN movement, linked
 * from `stockMovementId` below. That is NOT a double deduction: the coil left
 * stock as a CONVERT_OUT for its WHOLE weight, and the offcut is returned to a
 * DIFFERENT sku — the scrap one. Nothing is taken out of the coil twice.
 *
 * A JOB-WORK cut (location JW001) posts nothing. Those offcuts stayed with the
 * job worker and were never stock Ambika held — see the disposition note below,
 * which is the evidence for the rule.
 *
 * Historical rows predate all of this and carry no `stockMovementId`. The coil
 * deduction they caused already happened as an ADJUST_OUT posted by the RM
 * import, and that stays untouched — no scrap stock is backfilled from them.
 *
 * ── UNCUT BATCHES ───────────────────────────────────────────────────────────
 * Fifteen rows of the sheet describe coils that were never cut. Their circle
 * weight is empty, so the sheet's own formula makes "Scrap Generated" equal the
 * WHOLE coil — 2,890 kg of "scrap" from a 2,890 kg coil that is still intact.
 * They are stored faithfully but marked batchStatus UNCUT, and every scrap
 * total excludes them. Without that, scrap reads 287,489 kg instead of 246,674.
 */

/** Where the cutting happened. The sheet only ever uses these two. */
export const SCRAP_LOCATIONS = ['PLG01', 'JW001'];

/**
 * What was decided about the scrap. The sheet's vocabulary is
 * LOCATION-SPECIFIC, which is the evidence behind the whole PLG01/JW001 rule:
 *   DONE / REJECTED  appear only at PLG01 — in-house, physically verifiable
 *   JOB_WORK         appears only at JW001 — the offcuts stayed with the job
 *                    worker and never became stock Ambika holds
 *   PENDING          the sheet's blank — not yet checked
 */
export const SCRAP_DISPOSITIONS = ['DONE', 'JOB_WORK', 'REJECTED', 'PENDING'];

/** Whether the coil was actually cut. UNCUT rows are not scrap — see above. */
export const SCRAP_BATCH_STATUS = ['CUT', 'UNCUT'];

const scrapRecordSchema = new Schema({
  ...baseSchemaFields,

  /**
   * Import identity: `EXCEL_RM_24_25|SCRAP|<batch no>`. The batch number is the
   * client's own identifier for a cut, so the same sheet row can never produce
   * a second record. Unique+sparse, so anything created in-app later (which
   * sets no sourceRef) sits outside the index and cannot collide.
   */
  sourceRef: { type: String, trim: true, default: undefined },

  batchNo:   { type: String, trim: true, default: '', index: true },
  scrapDate: { type: Date, default: null, index: true },
  location:  { type: String, enum: SCRAP_LOCATIONS, required: true, index: true },

  // The coil that was cut. Scrap has no identity of its own anywhere in the
  // source, so the coil IS how a scrap record is identified.
  coilSkuId:   { type: Schema.Types.ObjectId, ref: 'SKU', index: true },
  coilSkuCode: { type: String, trim: true, uppercase: true, default: '' },
  coilSkuName: { type: String, trim: true, default: '' },

  coilWeightKg:    { type: Number, default: 0, min: 0 },   // went into the machine
  circlesWeightKg: { type: Number, default: 0, min: 0 },   // came out as usable circles
  scrapKg:         { type: Number, default: 0, min: 0 },   // the difference
  yieldRatioPct:   { type: Number, default: null },        // circles ÷ coil, as a percent

  disposition: { type: String, enum: SCRAP_DISPOSITIONS, default: 'PENDING', index: true },
  // The sheet's "Actual" column — the date the scrap was checked.
  verifiedAt:  { type: Date, default: null },

  /**
   * The COIL's rate, not a scrap rate. Named explicitly because the sheet's
   * "Rate" column sits beside the scrap figures and reads like scrap pricing —
   * it is not. Its values overlap the coil purchase rates exactly. There is no
   * scrap rate anywhere in the source, so scrap cannot be valued.
   */
  coilRate: { type: Number, default: 0, min: 0 },

  batchStatus: { type: String, enum: SCRAP_BATCH_STATUS, default: 'CUT', index: true },

  // Back-reference to the conversion this scrap came from, where one exists.
  // UNCUT rows have none, because nothing was cut.
  conversionId:     { type: Schema.Types.ObjectId, ref: 'CoilConversion', default: null },
  conversionNumber: { type: String, trim: true, default: '' },

  /**
   * WHICH physical coil this scrap came off — the GRN_IN movement that brought
   * it in. Carried across from the conversion so the chain the Cut Coils work
   * established (receipt → cut → circles) does not stop where scrap begins.
   *
   * Null on every imported record: the historical rows name a batch, not a
   * receipt, and nothing is back-filled because nothing is known.
   */
  coilReceiptId: { type: Schema.Types.ObjectId, ref: 'InventoryMovement', default: null, index: true },
  // The manual-entry coil (no goods receipt) this scrap came off, copied from
  // the conversion. Mutually exclusive with coilReceiptId; null on every older row.
  manualCoilId: { type: Schema.Types.ObjectId, ref: 'ManualCoil', default: null, index: true },

  /**
   * The SCRAP_IN movement this cut posted into scrap stock, where it posted one.
   *
   * Null means no stock was created, and that is the normal case for most of
   * the collection: every imported historical row, every UNCUT batch, and every
   * JW001 job-work cut. Only an in-house PLG01 cut with real scrap puts a
   * movement here, written in the same transaction as this record.
   *
   * It is the audit link between the production view and the balance — "this
   * cut is why scrap stock went up by 447 kg".
   */
  stockMovementId: { type: Schema.Types.ObjectId, ref: 'InventoryMovement', default: null, index: true },

  /**
   * The submission that produced this record, copied from the conversion.
   *
   * It is NOT the idempotency guard here — the conversion already refuses a
   * replay before any of this runs, and the partial index below makes a second
   * record for one conversion impossible. This is for tracing a record back to
   * the request that created it.
   */
  clientRequestId: { type: String, trim: true, default: undefined },

  remarks: { type: String, trim: true, default: '' },
}, baseSchemaOptions);

// Idempotency guard for imported history — sparse, so app-created records are
// not covered by it.
scrapRecordSchema.index({ sourceRef: 1 }, { unique: true, sparse: true });
/**
 * One scrap record per conversion, enforced by the database.
 *
 * PARTIAL, not sparse. A sparse index still indexes an explicit `null`, and 15
 * imported records carry `conversionId: null` because their coil was never cut
 * — they would collide with each other on a unique sparse index. Restricting
 * the index to real ObjectIds leaves those 15 outside it and still guarantees
 * that a cut can never produce two scrap records, whichever code path runs.
 */
scrapRecordSchema.index(
  { conversionId: 1 },
  { unique: true, partialFilterExpression: { conversionId: { $type: 'objectId' } } },
);
// The two readings the dashboard takes: by location over time, and by coil.
scrapRecordSchema.index({ location: 1, scrapDate: -1 });
scrapRecordSchema.index({ coilSkuId: 1, scrapDate: -1 });
scrapRecordSchema.index({ batchStatus: 1, disposition: 1 });

const ScrapRecord = model('ScrapRecord', scrapRecordSchema);
export default ScrapRecord;
