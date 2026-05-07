import mongoose from 'mongoose';
import { STEP_STATUS, TRANSPORT_TYPE } from '../../config/constants.js';

const shipmentSchema = new mongoose.Schema({
  dcId:       { type: mongoose.Schema.Types.ObjectId, ref: 'DeliveryChallan', index: true },
  dcNumber:   { type: String, index: true },
  invoiceId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice' },

  transportType:   { type: String, enum: Object.values(TRANSPORT_TYPE), default: TRANSPORT_TYPE.FREIGHT_PAID },
  transporterName: { type: String },
  lrNumber:        { type: String },
  vehicleNo:       { type: String },
  remarks:         { type: String },

  // Step 2.09 - Delivery tracking
  tracking: {
    approxDays:     { type: Number, default: 5 },
    planned:        { type: Date },
    actual:         { type: Date },
    status:         { type: String, enum: Object.values(STEP_STATUS), default: STEP_STATUS.PENDING },
    newDateToTrack: { type: Date },
    deliveryDate:   { type: Date },
    proofLink:      { type: String },
    timeDelay:      { type: String },
  },
}, { timestamps: true });

shipmentSchema.index({ dcNumber: 1 });

const Shipment = mongoose.model('Shipment', shipmentSchema);
export default Shipment;
