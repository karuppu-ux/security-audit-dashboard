/**
 * Every error the API returns on purpose is an ApiError. Anything else that
 * reaches the error middleware is, by definition, a bug — and is reported as a
 * generic 500 without leaking internals.
 */
export class ApiError extends Error {
  constructor(statusCode, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace?.(this, ApiError);
  }

  static badRequest(message, details) {
    return new ApiError(400, 'BAD_REQUEST', message, details);
  }

  static validation(message, details) {
    return new ApiError(400, 'VALIDATION_ERROR', message, details);
  }

  static notFound(message = 'Resource not found', details) {
    return new ApiError(404, 'NOT_FOUND', message, details);
  }

  static payloadTooLarge(message, details) {
    return new ApiError(413, 'PAYLOAD_TOO_LARGE', message, details);
  }

  static serviceUnavailable(message, details) {
    return new ApiError(503, 'SERVICE_UNAVAILABLE', message, details);
  }
}
