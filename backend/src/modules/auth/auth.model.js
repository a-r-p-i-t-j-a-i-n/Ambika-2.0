import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
  },
  mobile: {
    type: String,
    required: [true, 'Mobile number is required'],
    trim: true,
    // Accepts a 10-digit Indian mobile (6-9 leading), optionally with +91 / 0 prefix.
    // Stored in normalised 10-digit form via the pre-validate hook below.
    validate: {
      validator: (v) => /^[6-9]\d{9}$/.test(v),
      message: 'Mobile must be a valid 10-digit Indian number',
    },
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: 6,
    select: false,
  },
  role: {
    type: String,
    enum: [
      'MD',
      'Chief of Staff',
      'EA',
      'Factory Incharge (Palghar)',
      'Production Head',
      'QC Head',
      'Store Manager',
      'Data Entry Operator (Store & Prodn)',
      'Process Coordinator',
      'Process Coordinator & Accounts',
      'Accountant'
    ],
    required: true,
  },

  // ── Access-control (v2) ───────────────────────────────────────────
  // `roles[]` holds Role.key values (e.g. 'MD', 'SALES_EXEC'). The legacy
  // `role` field above remains for back-compat with `restrictTo(...)` calls.
  // The migration in `role.seed.js` populates `roles[]` for existing users.
  roles:            { type: [String], default: [] },
  permissionGrants: { type: [String], default: [] }, // permission slugs added on top of roles
  permissionDenies: { type: [String], default: [] }, // permission slugs revoked even if granted by a role

  // ── Lifecycle ─────────────────────────────────────────────────────
  isActive:  { type: Boolean, default: true },
  invitedAt: { type: Date },
  lastLoginAt: { type: Date },
}, {
  timestamps: true,
});

// Normalise mobile to a clean 10-digit number before validation runs.
// Strips spaces/dashes/parentheses, drops +91 country code and a leading 0.
userSchema.pre('validate', function(next) {
  if (this.mobile) {
    const digits = String(this.mobile).replace(/[\s\-()]/g, '');
    let m = digits;
    if (m.startsWith('+91')) m = m.slice(3);
    else if (m.startsWith('91') && m.length === 12) m = m.slice(2);
    else if (m.startsWith('0') && m.length === 11) m = m.slice(1);
    this.mobile = m;
  }
  next();
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Compare password
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

const User = mongoose.model('User', userSchema);
export default User;
