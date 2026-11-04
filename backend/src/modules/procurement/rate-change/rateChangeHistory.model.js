import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * Rate Change History — the append-only audit of every PO rate change request
 * and decision (Purchase FMS — Rate Change Approvals). One row per event; rows
 * are only ever inserted. The model refuses updates and deletes, so a later
 * rate change can never rewrite what happened before.
 *
 *   REQUESTED         a PO line's rate differs from the vendor rate
 *   APPROVED          vendor rate + PO line updated (vendor source before/after)
 *   REJECTED          vendor rate untouched (rejection reason)
 *   WITHDRAWN         the PO line / PO changed before a decision
 *   APPROVAL_CONFLICT an approval was refused and nothing was changed
 *                     (vendor rate changed since the request, PO no longer a draft)
 */
export const RATE_CHANGE_EVENT = {
  REQUESTED:         'REQUESTED',
  APPROVED:          'APPROVED',
  REJECTED:          'REJECTED',
  WITHDRAWN:         'WITHDRAWN',
  APPROVAL_CONFLICT: 'APPROVAL_CONFLICT',
};

const sourceSnapshot = new Schema({
  vendorProductId: { type: Schema.Types.ObjectId, default: null },
  rate:            { type: Number, default: null },
  unit:            { type: String, trim: true, default: '' },
  lastUpdatedAt:   { type: Date, default: null },
}, { _id: false });

const rateChangeHistorySchema = new Schema({
  requestId:     { type: Schema.Types.ObjectId, ref: 'RateChangeRequest', required: true, index: true },
  requestNumber: { type: String, trim: true, default: '' },
  event:  { type: String, enum: Object.values(RATE_CHANGE_EVENT), required: true, index: true },
  status: { type: String, trim: true, default: '' }, // the request's status after this event
  outcome: { type: String, enum: ['OK', 'CONFLICT', 'FAILED'], default: 'OK' },

  vendorId:   { type: Schema.Types.ObjectId, ref: 'Vendor', index: true },
  vendorName: { type: String, trim: true, default: '' },
  skuId:    { type: Schema.Types.ObjectId, ref: 'SKU', default: null },
  skuCode:  { type: String, trim: true, uppercase: true, default: '' },
  itemName: { type: String, trim: true, default: '' },
  unit:     { type: String, trim: true, default: '' },
  currency: { type: String, trim: true, default: 'INR' },

  previousRate:  { type: Number, default: null }, // vendor rate before (REQUESTED: when raised)
  newRate:       { type: Number, default: null }, // the requested / applied rate
  requestedRate: { type: Number, default: null },
  originalPoRate:{ type: Number, default: null },

  poId:   { type: Schema.Types.ObjectId, ref: 'VendorPurchaseOrder', default: null },
  poRef:  { type: String, trim: true, default: '' },
  indentId:     { type: Schema.Types.ObjectId, default: null },
  indentNumber: { type: String, trim: true, default: '' },
  indentItemDisplayNumber: { type: String, trim: true, default: '' },
  quotationPath: { type: String, trim: true, default: '' },

  requestedBy:     { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  requestedByName: { type: String, trim: true, default: '' },
  actorId:   { type: Schema.Types.ObjectId, ref: 'User', default: null },
  actorName: { type: String, trim: true, default: '' }, // requester / approver / rejecter
  at:        { type: Date, default: Date.now, index: true },

  reason:          { type: String, trim: true, default: '' }, // the request's reason
  rejectionReason: { type: String, trim: true, default: '' },
  message:         { type: String, trim: true, default: '' }, // withdrawal / conflict detail

  vendorSourceBefore: { type: sourceSnapshot, default: null },
  vendorSourceAfter:  { type: sourceSnapshot, default: null },
}, { timestamps: { createdAt: true, updatedAt: false } });

rateChangeHistorySchema.index({ vendorId: 1, skuCode: 1, at: 1 });

// Append-only: inserts only.
const refuse = function refuseRewrite(next) {
  next(new Error('Rate Change History is append-only — records cannot be changed or deleted'));
};
rateChangeHistorySchema.pre('save', function onlyInsert(next) {
  if (!this.isNew) return refuse(next);
  return next();
});
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace',
  'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  rateChangeHistorySchema.pre(op, refuse);
}

const RateChangeHistory = model('RateChangeHistory', rateChangeHistorySchema);
export default RateChangeHistory;
