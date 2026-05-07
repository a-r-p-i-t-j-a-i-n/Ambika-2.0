import { logger } from '../utils/logger.js';
import { ApiResponse } from '../utils/apiResponse.js';
import env from '../config/env.js';

/**
 * Global error handling middleware.
 * Catches all errors forwarded via next(err).
 */
const errorHandler = (err, req, res, _next) => {
  let statusCode = err.statusCode || 500;
  let message    = err.message    || 'Internal Server Error';

  if (statusCode === 422) {
    console.error('DEBUG [422 ERROR]:', {
      url: req.originalUrl,
      method: req.method,
      message,
      stack: err.stack,
      body: req.body,
      query: req.query,
      params: req.params
    });
  }

  // ── Mongoose Bad ObjectId ──────────────────────────────
  if (err.name === 'CastError') {
    statusCode = 400;
    message = `Invalid ${err.path}: ${err.value}`;
  }

  // ── Mongoose Duplicate Key ─────────────────────────────
  if (err.code === 11000) {
    statusCode = 409;
    const field = Object.keys(err.keyValue).join(', ');
    message = `Duplicate value for field(s): ${field}. Please use a unique value.`;
  }

  // ── Mongoose Validation Error ──────────────────────────
  if (err.name === 'ValidationError') {
    statusCode = 422;
    const errors = Object.values(err.errors).map((e) => e.message);
    message = `Validation failed: ${errors.join('; ')}`;
  }

  // ── Joi Validation Error ───────────────────────────────
  if (err.isJoi) {
    statusCode = 422;
    const errors = err.details.map((d) => d.message);
    message = `Validation failed: ${errors.join('; ')}`;
  }

  // ── JWT Errors ─────────────────────────────────────────
  if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid authentication token';
  }
  if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Authentication token has expired';
  }

  // ── Log the error ──────────────────────────────────────
  if (statusCode >= 500) {
    logger.error(`${statusCode} - ${message} - ${req.originalUrl} - ${req.method}`, {
      stack: err.stack,
    });
  } else {
    logger.warn(`${statusCode} - ${message} - ${req.originalUrl}`);
  }

  // ── Send response ─────────────────────────────────────
  const response = ApiResponse.fail(message);
  if (env.NODE_ENV === 'development' && statusCode >= 500) {
    response.stack = err.stack;
  }

  res.status(statusCode).json(response);
};

export default errorHandler;
