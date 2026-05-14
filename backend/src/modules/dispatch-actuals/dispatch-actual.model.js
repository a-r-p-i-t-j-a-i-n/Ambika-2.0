import mongoose from 'mongoose';
import { baseSchemaFields, baseSchemaOptions } from '../../database/BaseSchema.js';

const { Schema, model } = mongoose;

const DispatchActualSchema = new Schema({
  ...baseSchemaFields,
  dispatchPhaseId: { type: Schema.Types.ObjectId, ref: 'DispatchPhase', required: true },
  
  actualDate: { type: Date, required: true },
  actualQty:  { type: Number, required: true, min: 1 }, 
  
  dcId:       { type: Schema.Types.ObjectId, ref: 'DeliveryChallan' }, // Linked when DC is generated
  invoiceId:  { type: Schema.Types.ObjectId, ref: 'Invoice' }, // Linked when Invoice is generated
  transporterId: { type: Schema.Types.ObjectId, ref: 'Transporter' },
  vehicleNo:  { type: String },
  lrNumber:   { type: String },
  
  actualStatus: {
    type: String,
    enum: ['LOGGED', 'IN_TRANSIT', 'DELIVERED', 'RETURNED'],
    default: 'LOGGED'
  }
}, baseSchemaOptions);

// Indexes for fast lookups
DispatchActualSchema.index({ dispatchPhaseId: 1 });
DispatchActualSchema.index({ actualDate: 1 });
DispatchActualSchema.index({ dcId: 1 });
DispatchActualSchema.index({ invoiceId: 1 });
DispatchActualSchema.index({ companyId: 1 });

const DispatchActual = model('DispatchActual', DispatchActualSchema);

export default DispatchActual;
