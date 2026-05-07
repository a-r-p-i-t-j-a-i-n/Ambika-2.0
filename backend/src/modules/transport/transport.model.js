import mongoose from 'mongoose';
import { STEP_STATUS } from '../../config/constants.js';

const transportBillSchema = new mongoose.Schema({
  shipmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shipment', index: true },
  dcId:       { type: mongoose.Schema.Types.ObjectId, ref: 'DeliveryChallan' },
  dcNumber:   { type: String },

  // Step 2.12 - Receive transportation bill
  receipt: {
    planned:    { type: Date },
    actual:     { type: Date },
    status:     { type: String, enum: Object.values(STEP_STATUS), default: STEP_STATUS.PENDING },
    attachment: { type: String },
    link:       { type: String },
    timeDelay:  { type: String },
  },

  // Step 2.13 - Payment status for transport bill
  payment: {
    planned:   { type: Date },
    actual:    { type: Date },
    status:    { type: String, enum: Object.values(STEP_STATUS), default: STEP_STATUS.PENDING },
    link:      { type: String },
    timeDelay: { type: String },
  },
}, { timestamps: true });

const TransportBill = mongoose.model('TransportBill', transportBillSchema);
export default TransportBill;
