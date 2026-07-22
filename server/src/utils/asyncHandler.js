/**
 * Express 4 does not catch rejected promises from async handlers — an
 * unhandled rejection there means the request hangs until the client times
 * out. Wrapping every async handler forwards rejections to the centralized
 * error middleware instead.
 */
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
