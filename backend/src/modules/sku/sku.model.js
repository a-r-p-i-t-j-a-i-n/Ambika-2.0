import mongoose from 'mongoose';

const skuSchema = new mongoose.Schema({
  code: {
    type: String,
    required: [true, 'SKU code is required'],
    unique: true,
    trim: true,
    uppercase: true,
  },
  name: {
    type: String,
    required: [true, 'SKU name is required'],
    trim: true,
    index: true,
  },
  category: {
    type: String,
    trim: true,
    default: 'General',
  },
  pcsPerBox: {
    type: Number,
    default: 100,
    min: 1,
  },
  weightPerPc: {
    type: Number,
    default: 0,
    min: 0,
  },
  // ── Inventory fields ────────────────────────────────────
  fgStock:      { type: Number, default: 0, min: 0 },
  wipStock:     { type: Number, default: 0, min: 0 },
  bufferFG:     { type: Number, default: 0, min: 0 },
  bufferWIP:    { type: Number, default: 0, min: 0 },

  isActive: { type: Boolean, default: true, index: true },
}, {
  timestamps: true,
  toJSON:  { virtuals: true },
  toObject: { virtuals: true },
});

skuSchema.index({ name: 'text', code: 'text', category: 'text' });
skuSchema.index({ isActive: 1, name: 1 });

const SKU = mongoose.model('SKU', skuSchema);
export default SKU;
