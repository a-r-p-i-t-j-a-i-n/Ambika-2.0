import mongoose from 'mongoose';
import { baseSchemaFields, baseSchemaOptions } from '../../database/BaseSchema.js';

const { Schema, model } = mongoose;

/**
 * Inventory Movement — append-only stock ledger.
 *
 * Every stock change (GRN receipt, adjustment, future dispatch/return) is one
 * row here, written by `inventory.service`. The InventoryStock on-hand is the
 * running total of these rows. Each row keeps a back-reference to its source
 * document (refType/refId/refNumber) so a future Inventory Ledger screen can
 * trace any quantity back to e.g. its GRN.
 */

export const MOVEMENT_TYPE = { IN: 'IN', OUT: 'OUT' };

export const TXN_TYPE = {
  GRN_IN:        'GRN_IN',         // Purchase FMS — goods received
  OPENING:       'OPENING',        // opening balance
  ADJUST_IN:     'ADJUST_IN',      // manual correction up
  ADJUST_OUT:    'ADJUST_OUT',     // manual correction down
  TRANSFER_IN:   'TRANSFER_IN',
  TRANSFER_OUT:  'TRANSFER_OUT',
  RETURN_OUT:    'RETURN_OUT',     // purchase return (future)
  QC_REJECT_OUT: 'QC_REJECT_OUT',  // QC rejection (future)
  DISPATCH_OUT:  'DISPATCH_OUT',   // finished-goods sales dispatch (FG IMS)
  CONSUME_OUT:   'CONSUME_OUT',    // production consumption (future)
  CONVERT_OUT:   'CONVERT_OUT',    // RM coil consumed in a coil→circle conversion
  CONVERT_IN:    'CONVERT_IN',     // circles produced from a coil→circle conversion
  PRODUCE_IN:    'PRODUCE_IN',     // finished goods produced (FG IMS — Daily Production Report)
  SALES_RETURN_IN: 'SALES_RETURN_IN', // finished goods returned by a customer (FG IMS)

  // ── Scrap (Scrap IMS) ───────────────────────────────────────────────────────
  // Scrap gets its own pair rather than borrowing one of the types above,
  // because each of those already means something a scrap figure is not:
  //   CONSUME_OUT  is what Average Daily Consumption is measured from
  //                (see ims.validation) — a scrap SALE is not consumption, and
  //                counting it as such would overstate every reorder figure.
  //   ADJUST_IN/OUT mean "a human corrected the number". The 482 historical
  //                ADJUST_OUT rows ARE the old coil scrap deductions, so
  //                reusing them makes a scrap sale indistinguishable from a
  //                correction in the ledger.
  //   DISPATCH_OUT is a finished-goods sale to a customer, read by FG reports.
  // Additive: no existing row carries either value, so nothing is backfilled.
  SCRAP_IN:      'SCRAP_IN',       // scrap entering stock — offcuts from an in-house cut, or a manual Scrap In
  SCRAP_OUT:     'SCRAP_OUT',      // scrap leaving stock — sale, disposal or transfer
};

const inventoryMovementSchema = new Schema({
  ...baseSchemaFields,

  movementNumber: { type: String, unique: true, trim: true, index: true }, // MOV-001/26-27
  movementDate:   { type: Date, default: Date.now, index: true },

  // ── Item ──
  skuId:   { type: Schema.Types.ObjectId, ref: 'SKU', required: true, index: true },
  skuCode: { type: String, trim: true, uppercase: true, default: '' },
  skuName: { type: String, trim: true, default: '' },
  unit:    { type: String, trim: true, default: 'PCS' },
  warehouse: { type: String, trim: true, default: 'MAIN', index: true },

  // ── Movement ──
  txnType:      { type: String, enum: Object.values(TXN_TYPE), required: true, index: true },
  movementType: { type: String, enum: Object.values(MOVEMENT_TYPE), required: true },
  quantity:     { type: Number, required: true, min: 0 }, // magnitude, in the SKU's own unit
  qtyDelta:     { type: Number, default: 0 },             // signed (+in / -out)
  balanceAfter: { type: Number, default: 0 },             // on-hand after this row

  // ── Secondary measure (Raw Material circles) ────────────────────────────────
  // The weight that came with this movement, when the source recorded one. A
  // coil moves in kilograms and `quantity` already IS its weight, so this stays
  // null for coils; a circle moves in pieces and this carries the kilograms the
  // conversion or the inward slip stated beside them.
  //
  // null means "the source did not say", NOT zero — a circle issued to
  // production gives a piece count and no weight, and recording that as 0 kg
  // would read as a weightless issue. Readers must treat null as unknown.
  quantityKg:     { type: Number, default: null },
  qtyKgDelta:     { type: Number, default: null },  // signed, null when unknown
  balanceKgAfter: { type: Number, default: null },  // recorded weight after this row
  unitCost:     { type: Number, default: 0, min: 0 },
  lineValue:    { type: Number, default: 0, min: 0 },     // quantity × unitCost
  batchNo:      { type: String, trim: true, default: '' },

  // ── Source document (traceability) ──
  sourceModule: { type: String, trim: true, default: '', index: true }, // e.g. PURCHASE_FMS
  refType:      { type: String, trim: true, default: '', index: true }, // e.g. GRN
  refId:        { type: Schema.Types.ObjectId, index: true },
  refNumber:    { type: String, trim: true, default: '' },

  // ── Procurement context (denormalized for the ledger view) ──
  vendorId:     { type: Schema.Types.ObjectId, ref: 'Party' },
  vendorName:   { type: String, trim: true, default: '' },
  poId:         { type: Schema.Types.ObjectId, ref: 'VendorPurchaseOrder' },
  poNumber:     { type: String, trim: true, default: '' },
  piId:         { type: Schema.Types.ObjectId, ref: 'ProformaInvoice' },
  piNumber:     { type: String, trim: true, default: '' },

  // Why a MANUAL stock entry was made, kept structured so History can explain it
  // later without parsing prose. `reason` holds the code (e.g. VENDOR_RECEIPT,
  // OTHER); `customReason` the operator's free text, and only when reason is
  // OTHER. Optional and defaulted, so every automated caller (GRN, transfers,
  // production, dispatch) is completely unaffected.
  reason:          { type: String, trim: true, default: '' },
  customReason:    { type: String, trim: true, default: '' },

  /**
   * The other side of a manual movement — who the goods came from, or went to.
   *
   * Written today only by Scrap In / Scrap Out, where "who bought the scrap" is
   * the question the register exists to answer. It is a real field rather than
   * another phrase folded into `remarks` precisely because of the limitation
   * recorded below: this is the `reason`/`customReason` precedent being applied
   * to the one piece of context that has to be queryable.
   *
   * A plain name, not a Party reference — scrap buyers are not in the Party
   * master and the client's source names them only as text. Optional and
   * defaulted, so every existing caller is completely unaffected.
   */
  partyName:       { type: String, trim: true, default: '' },

  /**
   * The Scrap Buyer a sale went to — a SNAPSHOT, taken from the Scrap Buyer
   * master at the moment of the sale.
   *
   * Written only by Scrap Out (required when the reason is SALE). `partyName`
   * above still carries the buyer's name on the same row, so the existing
   * Party column and ledger search keep working for old and new rows alike;
   * this adds the exact master link and the details that identify the buyer.
   * A snapshot, not just an id, so the ledger still says who bought the scrap
   * after the master entry is edited or removed.
   *
   * No default: every other caller, and every historical row, simply has none.
   */
  buyer: {
    type: new Schema({
      buyerId:       { type: Schema.Types.ObjectId, ref: 'ScrapBuyer' },
      code:          { type: String, trim: true, default: '' },
      name:          { type: String, trim: true, default: '' },
      contactPerson: { type: String, trim: true, default: '' },
      phone:         { type: String, trim: true, default: '' },
      gstNo:         { type: String, trim: true, default: '' },
    }, { _id: false }),
    default: undefined,
  },

  /**
   * What the operator actually typed, when it was not in the stock unit —
   * e.g. 2.5 QUINTAL for a 250 kg Scrap Out. `quantity` stays the ledger
   * figure in the SKU's own unit; these two exist only so the ledger can show
   * the slip's figure beside it. No default: absent on every other movement.
   */
  enteredQty:      { type: Number, default: undefined },
  enteredUom:      { type: String, trim: true, default: undefined },

  // KNOWN LIMITATION — traceability.
  //
  // The entry screens fold their business context into this one free-text line:
  // FG Production In writes "Shift: A · Line: M-01 · Supervisor: …", FG Dispatch
  // Out writes "Customer: … · Order: … · Vehicle: …", and Consumables Stock Out
  // writes "Purpose: … · Issued to: … · Dept: …". None of it is queryable, so
  // History cannot filter by customer, shift or department, and a report cannot
  // group by them without parsing prose.
  //
  // Promoting them to real fields is a schema change with a backfill for every
  // existing row, so it is deliberately NOT done here — it is recorded as a
  // limitation rather than half-solved. `reason`/`customReason` above are the
  // precedent for how one of these should look when it is done.
  remarks:         { type: String, trim: true, default: '' },
  performedBy:     { type: Schema.Types.ObjectId, ref: 'User' },
  performedByName: { type: String, trim: true, default: '' },

  // The submission this row belongs to, as the entry screen minted it. Set only
  // by the IMS/FG entry forms; every automated caller leaves it blank. It is the
  // audit trail behind the idempotency guard (see inventoryRequestKey.model) —
  // the uniqueness itself lives there, this is the back-reference.
  clientRequestId: { type: String, trim: true, default: '', index: true },
}, baseSchemaOptions);

// Ledger lookups.
inventoryMovementSchema.index({ skuId: 1, movementDate: -1 });
inventoryMovementSchema.index({ refType: 1, refId: 1 });
inventoryMovementSchema.index({ sourceModule: 1, createdAt: -1 });
// A batch number identifies one physical unit (for Raw Material, one coil), so
// "everything that happened to this batch" is a real query: it is how Cut Coils
// works out how much of a received coil is still uncut. Without this index that
// scan grew with the whole ledger. Index only — no field and no data changes.
inventoryMovementSchema.index({ batchNo: 1, skuId: 1 });

const InventoryMovement = model('InventoryMovement', inventoryMovementSchema);
export default InventoryMovement;
