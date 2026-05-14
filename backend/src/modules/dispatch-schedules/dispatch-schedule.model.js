import mongoose from 'mongoose';
import { baseSchemaFields, baseSchemaOptions } from '../../database/BaseSchema.js';

const { Schema, model } = mongoose;

const DispatchScheduleSchema = new Schema({
  ...baseSchemaFields,
  salesOrderId: { type: Schema.Types.ObjectId, ref: 'SalesOrder', required: true },
  clientId:     { type: Schema.Types.ObjectId, ref: 'Client', required: true },
  poId:         { type: Schema.Types.ObjectId, ref: 'PurchaseOrder' },
  skuId:        { type: Schema.Types.ObjectId, ref: 'SKU', required: true },
  
  totalOrderedQty: { type: Number, required: true, min: 0 },
  totalPlannedQty: { type: Number, default: 0, min: 0 },
  totalActualQty:  { type: Number, default: 0, min: 0 },
  balanceQty:      { type: Number, required: true, min: 0 }, 
  
  scheduleStatus:  { 
    type: String, 
    enum: ['PENDING', 'PARTIALLY_DISPATCHED', 'COMPLETED', 'CANCELLED'],
    default: 'PENDING'
  }
}, baseSchemaOptions);

// Indexes for fast lookups
DispatchScheduleSchema.index({ salesOrderId: 1 });
DispatchScheduleSchema.index({ clientId: 1, scheduleStatus: 1 });
DispatchScheduleSchema.index({ skuId: 1 });
DispatchScheduleSchema.index({ companyId: 1 });

const DispatchSchedule = model('DispatchSchedule', DispatchScheduleSchema);

export default DispatchSchedule;
