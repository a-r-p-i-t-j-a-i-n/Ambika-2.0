import mongoose from 'mongoose';
import { DC_STATUS } from '../../config/constants.js';

const dcItemSchema = new mongoose.Schema({
  srNo:        { type: Number, required: true },
  skuId:       { type: mongoose.Schema.Types.ObjectId, ref: 'SKU' },
  skuName:     { type: String, required: true },
  quantityPcs: { type: Number, required: true, min: 0 },
  noOfBoxes:   { type: Number, default: 0, min: 0 },
  pcsPerBox:   { type: Number, default: 100, min: 1 },
  weightKg:    { type: Number, default: 0, min: 0 },
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
  deliveryAddress:   { type: String },

  pdfUrl:  { type: String, default: null },
  week:    { type: String },
  remark:  { type: String },

  status: {
    type: String,
    enum: Object.values(DC_STATUS),
    default: DC_STATUS.CREATED,
    index: true,
  },
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

const DeliveryChallan = mongoose.model('DeliveryChallan', deliveryChallanSchema);
export default DeliveryChallan;
