/**
 * Audit timestamps are rendered in UTC, always, and labelled as such.
 * Investigators correlate these against logs from other systems, and silently
 * converting to the viewer's local timezone is how two people end up arguing
 * about events that happened at the same instant.
 */
const UTC_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export function formatTimestamp(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return UTC_FORMAT.format(date).replace(',', '');
}

export function formatNumber(value) {
  return typeof value === 'number' ? value.toLocaleString() : '—';
}

/** "3 days ago" — useful context in the detail view, never a substitute for the exact time. */
export function formatRelative(value) {
  if (!value) return '';
  const diffMs = new Date(value).getTime() - Date.now();
  const units = [
    ['year', 365 * 24 * 60 * 60 * 1000],
    ['month', 30 * 24 * 60 * 60 * 1000],
    ['day', 24 * 60 * 60 * 1000],
    ['hour', 60 * 60 * 1000],
    ['minute', 60 * 1000],
  ];
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

  for (const [unit, ms] of units) {
    if (Math.abs(diffMs) >= ms) return formatter.format(Math.round(diffMs / ms), unit);
  }
  return 'just now';
}
