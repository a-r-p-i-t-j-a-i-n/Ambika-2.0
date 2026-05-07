/**
 * Standardised API Response builder.
 * Every response from this API follows the same envelope.
 */
export class ApiResponse {
  /**
   * @param {boolean}   success
   * @param {string}    message
   * @param {any}       data
   * @param {object}    meta   — pagination info, counts, etc.
   */
  constructor(success, message, data = null, meta = null) {
    this.success = success;
    this.message = message;
    if (data !== null)  this.data = data;
    if (meta !== null)  this.meta = meta;
  }

  static ok(message = 'Success', data = null, meta = null) {
    return new ApiResponse(true, message, data, meta);
  }

  static created(message = 'Created successfully', data = null) {
    return new ApiResponse(true, message, data);
  }

  static fail(message = 'Something went wrong', data = null) {
    return new ApiResponse(false, message, data);
  }
}

/**
 * Custom operational error class.
 * Throw this from services/controllers for expected errors.
 */
export class AppError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}
