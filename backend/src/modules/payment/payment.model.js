import mongoose from 'mongoose';
import { STEP_STATUS, PAYMENT_TYPE } from '../../config/constants.js';

const paymentSchema = new mongoose.Schema({
  invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', index: true },
  dcId:      { type: mongoose.Schema.Types.ObjectId, ref: 'DeliveryChallan' },
  dcNumber:  { type: String },
  partyId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Party', index: true },
  partyName: { type: String },

  type: {
    type: String,
    enum: Object.values(PAYMENT_TYPE),
    default: PAYMENT_TYPE.CLIENT_PAYMENT,
    index: true,
  },

  // Step 2.10 - Follow up for payment
  followUp: {
    planned:   { type: Date },
    actual:    { type: Date },
    status:    { type: String, enum: Object.values(STEP_STATUS), default: STEP_STATUS.PENDING },
    link:      { type: String },
    timeDelay: { type: String },
  },

  // Step 2.11 - Payment confirmation
  confirmation: {
    creditPeriodDays: { type: Number, default: 30 },
    planned:          { type: Date },
    actual:           { type: Date },
    receivedDate:     { type: Date },
    receivedAmount:   { type: Number, default: 0 },
    status:           { type: String, enum: Object.values(STEP_STATUS), default: STEP_STATUS.PENDING },
    link:             { type: String },
    timeDelay:        { type: String },
  },
}, { timestamps: true });

paymentSchema.index({ type: 1, 'confirmation.status': 1 });

const Payment = mongoose.model('Payment', paymentSchema);
export default Payment;
