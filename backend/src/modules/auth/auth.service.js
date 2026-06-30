import jwt from 'jsonwebtoken';
import User from './auth.model.js';
import env from '../../config/env.js';
import { AppError } from '../../utils/apiResponse.js';

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

  async getAllEmployees() {
    return User.find().select('-password');
  },
};
