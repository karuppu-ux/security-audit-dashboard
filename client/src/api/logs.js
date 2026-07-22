import { apiFetch, buildQueryString } from './client.js';

/**
 * Every parameter is sent to the API. There is deliberately no client-side
 * filtering, sorting or slicing anywhere in this app: the server owns the
 * query, and the client only ever holds the page it is currently showing.
 */
export function fetchLogs(params, { signal } = {}) {
  return apiFetch(`/api/v1/logs?${buildQueryString(params)}`, { signal });
}

export function fetchLogById(id, { signal } = {}) {
  return apiFetch(`/api/v1/logs/${id}`, { signal });
}

export function fetchFilterMetadata({ signal } = {}) {
  return apiFetch('/api/v1/logs/meta/enums', { signal });
}
