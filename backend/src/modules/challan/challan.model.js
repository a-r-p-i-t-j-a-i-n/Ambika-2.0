import mongoose from 'mongoose';
import { DC_STATUS } from '../../config/constants.js';

const dcItemSchema = new mongoose.Schema({
  srNo:        { type: Number, required: true },
  skuId:       { type: mongoose.Schema.Types.ObjectId, ref: 'SKU' },
  skuName:     { type: String, required: true },
  skuCode:     { type: String, trim: true },
  quantityPcs: { type: Number, required: true, min: 0 },
  noOfBoxes:   { type: Number, default: 0, min: 0 },
  pcsPerBox:   { type: Number, default: 100, min: 1 },
  weightKg:    { type: Number, default: 0, min: 0 },
  // Reference back to the order line item — survives SKU renames
  orderItemId: { type: mongoose.Schema.Types.ObjectId },
}, { _id: true });

const deliveryChallanSchema = new mongoose.Schema({
  dcNumber: {
    type: String, required: true, unique: true, trim: true,
  },
  soNumber:  { type: String, index: true },
  poNumber:  { type: String },
  orderId:   { type: mongoose.Schema.Types.ObjectId, ref: 'SalesOrder', index: true },
  partyId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Party', index: true },
  partyName: { type: String },
  dcDate:    { type: Date, required: true },

  items: [dcItemSchema],

  totalQuantityPcs: { type: Number, default: 0 },
  totalBoxes:       { type: Number, default: 0 },
  totalWeightKg:    { type: Number, default: 0 },

  dispatchedThrough: { type: String, default: 'Freight Paid' },
  vehicleNo:         { type: String },
  transportMode:     { type: String, default: 'Road' },
  transporterName:   { type: String },
  clientEmail:       { type: String },
  invoiceNo:         { type: String },
  lrNo:              { type: String }, // Lorry Receipt / docket no from the transporter
  deliveryAddress:   { type: String },

  pdfUrl:  { type: String, default: null },
  sendEmail: { type: Boolean, default: false },
  emailStatus: { type: String, default: null },
  week:    { type: String },
  remark:  { type: String },

  status: {
    type: String,
    enum: Object.values(DC_STATUS),
    default: DC_STATUS.CREATED,
    index: true,
  },

  // ── Delivery tracking (O2D Step 2.9) ───────────────────────
  deliveryStatus: { type: String, default: null }, // Delivered / Not Delivered / Cancelled
  deliveryDate:   { type: Date, default: null },
  // Step 2.09, "Not Delivered": the date the doer will chase it again. Was being
  // set by the service but never declared here, so strict mode silently dropped
  // it and the re-track date could never be stored or shown.
  newTrackDate:   { type: Date, default: null },
  newTrackDate:   { type: Date, default: null },    // re-track date when not yet delivered

  // ── Plan-vs-Actual linkage (the core design choice) ────────
  // Every DC explicitly references the plan phase it fulfils.
  // If the operator chooses "Unplanned" we flag it for the risk panel.
  phaseRef: {
    scheduleId: { type: mongoose.Schema.Types.ObjectId, ref: 'DispatchSchedule' },
    itemId:     { type: mongoose.Schema.Types.ObjectId }, // scheduleItem._id
    phaseId:    { type: mongoose.Schema.Types.ObjectId }, // phase._id
    phaseNo:    { type: String },                          // denormalized label
  },
  // A single DC can fulfil SEVERAL plan phases at once (the qty is allocated
  // across them, earliest-first). `phaseRef` mirrors the first for back-compat.
  phaseRefs: [{
    scheduleId: { type: mongoose.Schema.Types.ObjectId, ref: 'DispatchSchedule' },
    itemId:     { type: mongoose.Schema.Types.ObjectId },
    phaseId:    { type: mongoose.Schema.Types.ObjectId },
    phaseNo:    { type: String },
  }],
  isUnplanned: { type: Boolean, default: false },

  // Who recorded this dispatch (shown on the Challan 360 page).
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

// Auto-calc totals before save
deliveryChallanSchema.pre('save', function (next) {
  if (this.items && this.items.length > 0) {
    this.totalQuantityPcs = this.items.reduce((s, i) => s + (i.quantityPcs || 0), 0);
    this.totalBoxes       = this.items.reduce((s, i) => s + (i.noOfBoxes || 0), 0);
    this.totalWeightKg    = this.items.reduce((s, i) => s + (i.weightKg || 0), 0);
  }
  next();
});

deliveryChallanSchema.index({ dcDate: -1 });
deliveryChallanSchema.index({ dcNumber: 'text', soNumber: 'text', partyName: 'text' });
deliveryChallanSchema.index({ 'phaseRef.phaseId': 1 });
deliveryChallanSchema.index({ 'phaseRef.scheduleId': 1, dcDate: -1 });

const DeliveryChallan = mongoose.model('DeliveryChallan', deliveryChallanSchema);
export default DeliveryChallan;
