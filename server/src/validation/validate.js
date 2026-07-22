import { ZodError } from 'zod';
import { ApiError } from '../utils/ApiError.js';

/**
 * Flatten a ZodError into a stable, client-friendly shape. The path is what the
 * caller needs to fix their request; the message is what a human reads.
 */
export function formatZodIssues(error) {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
    code: issue.code,
  }));
}

/**
 * Validation middleware factory.
 *
 * Parsed output is written to `req.validated[source]` rather than back onto
 * `req.query` / `req.body`. Two reasons: `req.query` is a read-only getter in
 * Express 5, and keeping the raw input intact makes debugging a rejected
 * request far easier than silently mutating it.
 */
export const validate = (schema, source = 'body') =>
  function validateMiddleware(req, _res, next) {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      return next(toApiError(result.error, source));
    }

    req.validated = { ...req.validated, [source]: result.data };
    return next();
  };

function toApiError(error, source) {
  const issues = formatZodIssues(error);
  // A schema can flag an oversized-but-well-formed payload; that is a 413, not
  // a 400. See `bulkUploadBodySchema`.
  const tooLarge = error instanceof ZodError && error.issues.some((i) => i.params?.tooLarge);

  if (tooLarge) {
    return ApiError.payloadTooLarge(issues[0].message, issues);
  }

  return ApiError.validation(`Invalid request ${source}`, issues);
}
