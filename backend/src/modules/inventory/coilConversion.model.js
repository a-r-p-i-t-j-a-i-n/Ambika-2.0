import mongoose from 'mongoose';
import { baseSchemaFields, baseSchemaOptions } from '../../database/BaseSchema.js';

const { Schema, model } = mongoose;

/**
 * Coil → Circle conversion (the factory's blanking/cutting step).
 *
 * A raw-material COIL is consumed and cut into one or more CIRCLE SKUs. The
 * difference between the coil weight in and the total circle weight out is
 * SCRAP; yield% = circle weight / coil weight. Each conversion also writes the
 * matching inventory movements (coil CONVERT_OUT, each circle CONVERT_IN) so the
 * RM IMS on-hand always reconciles with the ledger.
 *
 * Mirrors the client's "Scrap Summary" + "Circle In/Out" sheets.
 */
const producedCircleSchema = new Schema({
  circleSkuId:   { type: Schema.Types.ObjectId, ref: 'SKU' },
  circleSkuCode: { type: String, trim: true, uppercase: true, default: '' },
  circleSkuName: { type: String, trim: true, default: '' },
  sizeLabel:     { type: String, trim: true, default: '' },     // e.g. "Cu - 0.8mm - 8.50""
  pcs:           { type: Number, default: 0, min: 0 },          // circles produced (pieces)
  weightKg:      { type: Number, default: 0, min: 0 },          // weight of those circles
  movementId:     { type: Schema.Types.ObjectId, ref: 'InventoryMovement' },
  movementNumber: { type: String, trim: true, default: '' },
}, { _id: true });

const coilConversionSchema = new Schema({
  ...baseSchemaFields,

  conversionNumber: { type: String, unique: true, trim: true, index: true }, // RMC-001/26-27
  conversionDate:   { type: Date, default: Date.now, index: true },

  // The coil consumed.
  batchNo:     { type: String, trim: true, default: '', index: true },
  coilSkuId:   { type: Schema.Types.ObjectId, ref: 'SKU', required: true, index: true },
  coilSkuCode: { type: String, trim: true, uppercase: true, default: '' },
  coilSkuName: { type: String, trim: true, default: '' },
  coilWeightKg:{ type: Number, required: true, min: 0 },        // weight in (coil)
  rate:        { type: Number, default: 0, min: 0 },            // ₹/kg of the coil

  circles:     [producedCircleSchema],

  // Derived & stored for the summary view.
  circlesWeightKg: { type: Number, default: 0, min: 0 },        // Σ circle weight
  scrapKg:         { type: Number, default: 0 },                // coil − circles (can be ~0)
  yieldRatioPct:   { type: Number, default: 0 },                // circles / coil × 100

  // REJECTED is additive: the client's Summary Scrap sheet carries that state on
  // two historical batches, and mapping it to PENDING would lose what they
  // recorded. Existing documents are unaffected — nothing is re-validated.
  scrapVerified: { type: String, enum: ['PENDING', 'JOB_WORK', 'DONE', 'REJECTED'], default: 'PENDING' },

  /**
   * Where this conversion came from, when it was not keyed in through the app.
   *
   * Historical batches imported from the client's workbook carry
   * `EXCEL_RM_24_25|CONVERSION|<batch no>` here, which is what makes the import
   * idempotent: the batch number is the client's own identifier for the cut, so
   * the same row can never produce a second document. Unique+sparse, so the
   * documents the app creates itself (which never set it) are untouched and the
   * index costs nothing for them.
   */
  sourceRef: { type: String, trim: true, default: undefined },
  coilMovementId:     { type: Schema.Types.ObjectId, ref: 'InventoryMovement' },
  coilMovementNumber: { type: String, trim: true, default: '' },

  /**
   * WHICH physical coil was cut — the GRN_IN movement that brought it in.
   *
   * `batchNo` above is the coil's business identifier and is what people read,
   * but it is free text: a typo, or a supplier one day reusing a number, and
   * the trail to the receipt is gone. This is the exact link, so a conversion
   * can always be traced back to the arrival it consumed, the rate actually
   * paid for it, and the GRN/PO behind it.
   *
   * Null on every conversion that does not name a physical coil: all 481
   * historical ones, and any cut booked through the manual by-item fallback.
   * Nothing is back-filled, because nothing is known — a coil received without
   * a batch number cannot be identified after the fact, and guessing which
   * arrival a historical cut drew on would be fabrication.
   */
  coilReceiptId:     { type: Schema.Types.ObjectId, ref: 'InventoryMovement', default: null, index: true },
  coilReceiptNumber: { type: String, trim: true, default: '' },

  /**
   * WHICH physical coil was cut, when that coil has NO goods receipt — the
   * ManualCoil entered on Cut Coils under "Manual Entry — No GRN".
   *
   * Mutually exclusive with `coilReceiptId`: a cut names its coil by its
   * receipt, or by its manual entry, or (historical / "No receipt available")
   * by neither. Null on everything recorded before manual coils existed.
   */
  manualCoilId: { type: Schema.Types.ObjectId, ref: 'ManualCoil', default: null, index: true },

  /**
   * The submission this conversion came from.
   *
   * The entry screen mints an id per submission, so a double-click, a browser
   * retry or a second tab all carry the SAME id. InventoryRequestKey catches
   * the replay first, but those rows are disposable — they expire after seven
   * days. This keeps the guarantee permanently, in the database rather than in
   * the application: the unique index below means a second conversion for one
   * submission cannot exist, however late the retry arrives.
   *
   * Sparse, so the 481 historical conversions and any caller that sends no id
   * are not covered by it and cannot collide with each other.
   */
  clientRequestId: { type: String, trim: true, default: undefined },

  /**
   * What the operator SAID this round would be — "Full cutting" (take every
   * kilogram the coil has left) or "Partial cutting" (take the weight typed).
   *
   * An INSTRUCTION, not a status. The coil's status (Not / Partially / Fully
   * cut) and each round's outcome stay derived from the weights in
   * coilLineage.js and are never stored. The two usually agree, but not always:
   * a Partial round typed at exactly the remaining weight finishes the coil.
   * Stored because it cannot be recovered afterwards, and because the server
   * needs it to enforce that a FULL round takes exactly what is left.
   *
   * Absent on every conversion made before it existed (all historical ones),
   * and nothing back-fills it — a guess at intent is not a record of it.
   */
  cuttingType: { type: String, enum: ['FULL', 'PARTIAL'], default: undefined },

  remarks: { type: String, trim: true, default: '' },
}, baseSchemaOptions);

coilConversionSchema.index({ conversionDate: -1 });
// Idempotency guard for imported history — sparse, so app-created conversions
// (which leave sourceRef unset) are not covered by it and cannot collide.
coilConversionSchema.index({ sourceRef: 1 }, { unique: true, sparse: true });
// One conversion per submission, enforced by the database. Sparse for the same
// reason sourceRef is: documents without an id are simply not in the index.
coilConversionSchema.index({ clientRequestId: 1 }, { unique: true, sparse: true });
coilConversionSchema.index({ coilSkuCode: 1, conversionDate: -1 });

const CoilConversion = model('CoilConversion', coilConversionSchema);
export default CoilConversion;
