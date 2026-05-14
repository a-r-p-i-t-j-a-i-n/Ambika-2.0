import mongoose from 'mongoose';
import { baseSchemaFields, baseSchemaOptions } from '../../database/BaseSchema.js';

const { Schema, model } = mongoose;

const PoLineSchema = new Schema({
  skuId: { type: Schema.Types.ObjectId, ref: 'SKU', required: true },
  orderedQty: { type: Number, required: true, min: 1 },
  expectedDispatchDate: { type: Date },
  priority: { type: String, enum: ['LOW', 'NORMAL', 'HIGH', 'URGENT'], default: 'NORMAL' },
  remarks: { type: String }
}, { _id: true });

const PurchaseOrderSchema = new Schema({
  ...baseSchemaFields,
  
  clientId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
  
  poNumber: { type: String, required: true, trim: true },
  poDate:   { type: Date, required: true },
  
  location: { type: String }, // e.g., 'Mumbai Plant'
  leadTimeDays: { type: Number },
  
  orderLines: [PoLineSchema],
  
  poStatus: {
    type: String,
    enum: ['DRAFT', 'SUBMITTED', 'SO_GENERATED', 'CANCELLED'],
    default: 'DRAFT'
  },
  
  salesOrderId: { type: Schema.Types.ObjectId, ref: 'SalesOrder' } // Linked when SO is auto-generated
  
}, baseSchemaOptions);

// Indexes
// Duplicate PO validation: Prevent same client from sending identical PO number
PurchaseOrderSchema.index({ clientId: 1, poNumber: 1 }, { unique: true });
PurchaseOrderSchema.index({ poDate: 1 });
PurchaseOrderSchema.index({ companyId: 1 });

export default model('PurchaseOrder', PurchaseOrderSchema);
