import mongoose from 'mongoose';

const dailyPlanSchema = new mongoose.Schema({
  date:       { type: Date, required: true },
  dispPlan:   { type: Number, default: 0, min: 0 },
  dispActual: { type: Number, default: 0, min: 0 },
}, { _id: false });

const ppcEntrySchema = new mongoose.Schema({
  month:     { type: Number, required: true, min: 1, max: 12 },
  year:      { type: Number, required: true },
  soNumber:  { type: String, required: true, index: true },
  partyId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Party', index: true },
  partyName: { type: String },

  skuId:   { type: mongoose.Schema.Types.ObjectId, ref: 'SKU' },
  skuCode: { type: String },
  skuName: { type: String },

  orderQty:              { type: Number, default: 0, min: 0 },
  fgStock:               { type: Number, default: 0, min: 0 },
  wipStock:              { type: Number, default: 0, min: 0 },
  bufferFG:              { type: Number, default: 0, min: 0 },
  bufferWIP:             { type: Number, default: 0, min: 0 },
  totalQtyToProduce:     { type: Number, default: 0, min: 0 },
  producedQtyTillDate:   { type: Number, default: 0, min: 0 },
  balanceProductionQty:  { type: Number, default: 0, min: 0 },
  achievedProductionPct: { type: Number, default: 0, min: 0, max: 100 },
  dispatchedQty:         { type: Number, default: 0, min: 0 },
  dispatchPct:           { type: Number, default: 0, min: 0, max: 100 },
  pendingFromPrevMonth:  { type: Number, default: 0, min: 0 },
  planInNextMonth:       { type: Number, default: 0, min: 0 },

  dailyPlan: [dailyPlanSchema],
}, {
  timestamps: true,
});

ppcEntrySchema.index({ month: 1, year: 1, soNumber: 1, skuCode: 1 }, { unique: true });

const PPCEntry = mongoose.model('PPCEntry', ppcEntrySchema);
export default PPCEntry;
