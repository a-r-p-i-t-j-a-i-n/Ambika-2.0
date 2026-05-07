/**
 * Wraps async route handlers to catch rejected promises
 * and forward them to the Express error handler.
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export default asyncHandler;
