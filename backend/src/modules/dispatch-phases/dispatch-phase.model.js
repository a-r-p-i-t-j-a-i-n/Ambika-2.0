import mongoose from 'mongoose';
import { baseSchemaFields, baseSchemaOptions } from '../../database/BaseSchema.js';

const { Schema, model } = mongoose;

const DispatchPhaseSchema = new Schema({
  ...baseSchemaFields,
  dispatchScheduleId: { type: Schema.Types.ObjectId, ref: 'DispatchSchedule', required: true },
  
  phaseNo:       { type: String, required: true }, // e.g., 'P1', 'P2'
  plannedDate:   { type: Date, required: true },
  plannedQty:    { type: Number, required: true, min: 0 },
  actualTotalQty:{ type: Number, default: 0, min: 0 }, // Sum of related DispatchActuals
  
  phaseStatus:   { 
    type: String, 
    enum: ['PLANNED', 'PARTIAL', 'DISPATCHED', 'DELAYED'],
    default: 'PLANNED'
  }
}, baseSchemaOptions);

// Indexes for fast lookups and constraints
DispatchPhaseSchema.index({ dispatchScheduleId: 1, phaseNo: 1 }, { unique: true }); // A schedule can only have one P1, P2 etc.
DispatchPhaseSchema.index({ plannedDate: 1 });
DispatchPhaseSchema.index({ phaseStatus: 1 });
DispatchPhaseSchema.index({ companyId: 1 });

const DispatchPhase = model('DispatchPhase', DispatchPhaseSchema);

export default DispatchPhase;
