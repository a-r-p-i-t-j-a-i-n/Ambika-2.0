import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import User from './auth.model.js';
import env from '../../config/env.js';
import { AppError } from '../../utils/apiResponse.js';
import { logger } from '../../utils/logger.js';

// Delegation Suite role key → this app's `role` value (both systems use the
// same company roles). Only 'MD' carries extra rights here — restrictTo('MD')
// and the root access-control role — so every other value is equivalent.
const SUITE_ROLE_TO_ERP_ROLE = {
  md: 'MD',
  admin: 'MD',
  chief_of_staff: 'Chief of Staff',
  ea: 'EA',
  factory_manager: 'Factory Incharge (Palghar)',
  production_head: 'Production Head',
  quality_check: 'QC Head',
  store_manager: 'Store Manager',
  deo: 'Data Entry Operator (Store & Prodn)',
  process_coordinator: 'Process Coordinator',
  process_coordinator_accounts: 'Process Coordinator & Accounts',
  accountant: 'Accountant',
};
// Suite roles with no matching job title here (e.g. manager, member).
const FALLBACK_ERP_ROLE = 'Process Coordinator';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A DB hiccup (Atlas reconnecting / SRV blip / buffering timeout) must NOT look
// like a wrong password. Detect those transient errors so we can retry, then fail
// with a clear, retryable 503 instead of a generic 500 or a false 401.
const isTransientDbError = (err) => {
  const name = err?.name || '';
  const msg = err?.message || '';
  return (
    ['MongooseError', 'MongoNetworkError', 'MongoServerSelectionError', 'MongoNotConnectedError', 'MongoTimeoutError', 'PoolClearedError']
      .includes(name)
    || /buffering timed out|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|getaddrinfo|server selection|topology|pool|not connected|connection.*clos/i.test(msg)
  );
};

// Run a DB read, transparently retrying a few times across a transient blip so a
// reconnect window resolves without the user ever seeing an error.
const withDbRetry = async (op, { tries = 3, baseDelay = 400 } = {}) => {
  let lastErr;
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    try {
      return await op();
    } catch (err) {
      lastErr = err;
      if (!isTransientDbError(err) || attempt === tries) break;
      await sleep(baseDelay * attempt);
    }
  }
  if (isTransientDbError(lastErr)) {
    throw new AppError('The server is reconnecting to the database. Please try again in a moment.', 503);
  }
  throw lastErr;
};

const signToken = (id) => {
  return jwt.sign({ id }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  });
};

const createSendToken = (user, statusCode, res) => {
  const token = signToken(user._id);
  user.password = undefined;

  res.status(statusCode).json({
    success: true,
    token,
    data: { user },
  });
};

export const authService = {
  async register(data) {
    const existingUser = await User.findOne({ email: data.email });
    if (existingUser) throw new AppError('Email already in use', 400);
    return User.create(data);
  },

  async login(email, password) {
    // Retry the lookup across a transient DB blip (so a reconnect doesn't read as
    // "wrong password"); a genuine DB outage throws a clear 503 from withDbRetry.
    const user = await withDbRetry(() => User.findOne({ email }).select('+password'));
    if (!user || !(await user.comparePassword(password))) {
      throw new AppError('Incorrect email or password', 401);
    }
    return user;
  },

  // Lookup for Delegation Suite single sign-on (authController.sso).
  async findByEmail(email) {
    return withDbRetry(() => User.findOne({ email }));
  },

  // Delegation is the one place employees are added. When a Delegation employee
  // opens the ERP for the first time and has no account here yet, create it
  // from the Delegation details carried by the signed ticket. Only ever INSERTS
  // one new user — never changes or removes an existing one.
  //   • role: same job title as in Delegation (MD/Admin → MD).
  //   • access: MD → root; everyone else → VIEWER (read-only), the same default
  //     this app gives every new user; the MD grants more in Access Control.
  //   • password: random and never used — these people come in via the Suite.
  async createFromSuite({ email, name, mobile, suiteRole }) {
    const role = SUITE_ROLE_TO_ERP_ROLE[String(suiteRole || '').toLowerCase()] || FALLBACK_ERP_ROLE;
    try {
      const user = await User.create({
        name,
        email,
        mobile: String(mobile || ''),
        role,
        roles: [role === 'MD' ? 'MD' : 'VIEWER'],
        password: crypto.randomBytes(24).toString('hex'),
      });
      logger.info(`[sso] Created ERP account for Delegation employee ${email} (${role})`);
      return user;
    } catch (err) {
      // Two first-time sign-ins at the same moment: the other one created it.
      if (err?.code === 11000) return User.findOne({ email });
      throw err;
    }
  },

  async getAllEmployees() {
    return User.find().select('-password');
  },
};
