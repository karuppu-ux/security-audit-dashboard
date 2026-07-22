const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

/**
 * An error that carries the server's structured payload, so the UI can show
 * what actually went wrong ("Invalid enum value for severity") rather than a
 * generic "something failed".
 */
export class ApiError extends Error {
  constructor(message, { status, code, details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * Thin fetch wrapper. `signal` is threaded through so TanStack Query can abort
 * an in-flight request when the user types the next character or changes a
 * filter — without it, a slow response can land after a newer one and overwrite
 * the correct results.
 */
export async function apiFetch(path, { signal } = {}) {
  let response;

  try {
    response = await fetch(`${BASE_URL}${path}`, {
      signal,
      headers: { Accept: 'application/json' },
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    // fetch only rejects on network-level failure, so this is genuinely
    // "the API is unreachable" rather than "the API said no".
    throw new ApiError('Cannot reach the API. Is the server running?', { status: 0 });
  }

  // A non-JSON body means the response did not come from the API itself —
  // typically a dev-proxy or load-balancer error page when the API is down.
  // Reporting that as a bare "500" sends people hunting for a server bug that
  // does not exist, so it is named for what it is.
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      payload?.error?.message ??
      (response.status >= 500
        ? 'The API is not responding. Check that the server is running.'
        : `Request failed (${response.status})`);

    throw new ApiError(message, {
      status: response.status,
      code: payload?.error?.code,
      details: payload?.error?.details,
    });
  }

  return payload;
}

/** Drop empty values so the URL stays readable and the server sees no blanks. */
export function buildQueryString(params) {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      value.forEach((item) => search.append(key, item));
    } else {
      search.set(key, String(value));
    }
  }

  return search.toString();
}
