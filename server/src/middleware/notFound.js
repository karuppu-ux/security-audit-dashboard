import { ApiError } from '../utils/ApiError.js';

/**
 * Unmatched routes go through the same error envelope as everything else,
 * rather than Express's default HTML 404 page.
 */
export function notFound(req, _res, next) {
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} does not exist`));
}
