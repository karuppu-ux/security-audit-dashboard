import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { ApiError } from '../utils/ApiError.js';
import { formatZodIssues } from '../validation/validate.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * The single place any error becomes an HTTP response. Every route delegates
 * here, so the error envelope is identical across the API and no handler can
 * accidentally invent its own error shape — or leak a stack trace.
 */
// eslint-disable-next-line no-unused-vars -- Express identifies error middleware by arity.
export function errorHandler(error, req, res, _next) {
  const { statusCode, code, message, details } = normalize(error);

  // 5xx is a bug in this service and must be loud; 4xx is a caller mistake and
  // would only add noise to the logs.
  if (statusCode >= 500) {
    logger.error(`${req.method} ${req.originalUrl} → ${statusCode}`, error);
  }

  res.status(statusCode).json({
    error: {
      code,
      message,
      ...(details ? { details } : {}),
      ...(env.isProduction ? {} : { stack: error.stack }),
    },
  });
}

function normalize(error) {
  if (error instanceof ApiError) {
    return error;
  }

  if (error instanceof ZodError) {
    return ApiError.validation('Validation failed', formatZodIssues(error));
  }

  // Mongoose rejected a document that got past Zod — a schema drift bug, but
  // still the caller's data, so report it as a 400 with the offending paths.
  if (error instanceof mongoose.Error.ValidationError) {
    return ApiError.validation(
      'Document validation failed',
      Object.values(error.errors).map((fieldError) => ({
        path: fieldError.path,
        message: fieldError.message,
      }))
    );
  }

  if (error instanceof mongoose.Error.CastError) {
    return ApiError.badRequest(`Invalid value for "${error.path}"`);
  }

  // Raised by express.json() for unparseable or oversized bodies.
  if (error.type === 'entity.parse.failed') {
    return ApiError.badRequest('Request body is not valid JSON');
  }
  if (error.type === 'entity.too.large') {
    return ApiError.payloadTooLarge(
      `Request body exceeds the ${env.JSON_BODY_LIMIT} limit. Split the upload into smaller batches.`
    );
  }

  // Query exceeded maxTimeMS — the client asked for something too expensive.
  if (error.codeName === 'MaxTimeMSExpired' || error.code === 50) {
    return new ApiError(
      503,
      'QUERY_TIMEOUT',
      'The query took too long to complete. Narrow the filters or reduce the page size.'
    );
  }

  if (error.name === 'MongoNetworkError' || error.name === 'MongooseServerSelectionError') {
    return ApiError.serviceUnavailable('Database is unavailable');
  }

  // Anything reaching here is unanticipated. Return a generic message; the real
  // one is in the logs, not on the wire.
  return new ApiError(500, 'INTERNAL_SERVER_ERROR', 'An unexpected error occurred');
}
