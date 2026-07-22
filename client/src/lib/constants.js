/** Multi-select filters, backed by server-supplied enum vocabularies. */
export const ENUM_FILTERS = ['severity', 'status', 'role', 'action', 'resourceType', 'region'];

/** Free-text filters. The API matches these as anchored prefixes. */
export const TEXT_FILTERS = ['actor', 'resource', 'ipAddress'];

export const DEFAULT_LIMIT = 25;

/** Columns rendered by the table, in order. Every one is sortable server-side. */
export const COLUMNS = [
  { key: 'timestamp', label: 'Timestamp', width: 'w-44' },
  { key: 'severity', label: 'Severity', width: 'w-24' },
  { key: 'status', label: 'Status', width: 'w-32' },
  { key: 'actor', label: 'Actor', width: 'w-56' },
  { key: 'role', label: 'Role', width: 'w-24' },
  { key: 'action', label: 'Action', width: 'w-36' },
  { key: 'resourceType', label: 'Type', width: 'w-24' },
  { key: 'resource', label: 'Resource', width: 'w-64' },
  { key: 'ipAddress', label: 'IP Address', width: 'w-32' },
  { key: 'region', label: 'Region', width: 'w-32' },
];

/**
 * Severity and status are the only saturated colour in the interface, so the
 * eye lands on risk first when scanning a dense table. Ordered by escalation.
 */
export const SEVERITY_STYLES = {
  LOW: 'bg-slate-800 text-slate-300 ring-slate-700',
  MEDIUM: 'bg-amber-950 text-amber-300 ring-amber-800/60',
  HIGH: 'bg-orange-950 text-orange-300 ring-orange-800/60',
  CRITICAL: 'bg-red-950 text-red-300 ring-red-700/70',
};

export const STATUS_STYLES = {
  Unresolved: 'bg-red-950/60 text-red-300 ring-red-800/50',
  Investigating: 'bg-sky-950 text-sky-300 ring-sky-800/60',
  Resolved: 'bg-emerald-950 text-emerald-300 ring-emerald-800/60',
  'False Positive': 'bg-slate-800 text-slate-400 ring-slate-700',
};

/** Left border on a row, so severity is legible even at a glance from a distance. */
export const SEVERITY_ROW_ACCENT = {
  LOW: 'border-l-transparent',
  MEDIUM: 'border-l-amber-600/70',
  HIGH: 'border-l-orange-500/80',
  CRITICAL: 'border-l-red-500',
};
