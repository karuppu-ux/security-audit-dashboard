/**
 * The spec gives one sample record but never enumerates the allowed values, so
 * these vocabularies are an assumption (documented in the README). They are
 * closed enums on purpose: an audit store where `severity` can be any string is
 * an audit store you cannot reliably query or alert on.
 */

export const ROLES = ['admin', 'user', 'service', 'auditor', 'contractor'];

export const ACTIONS = [
  'LOGIN',
  'LOGOUT',
  'LOGIN_FAILED',
  'CREATE_USER',
  'UPDATE_USER',
  'DELETE_USER',
  'GRANT_ROLE',
  'REVOKE_ROLE',
  'READ_RECORD',
  'UPDATE_RECORD',
  'DELETE_RECORD',
  'EXPORT_DATA',
  'DOWNLOAD_FILE',
  'UPLOAD_FILE',
  'ROTATE_KEY',
  'CREATE_API_KEY',
  'REVOKE_API_KEY',
  'UPDATE_CONFIG',
  'DISABLE_MFA',
  'PASSWORD_RESET',
];

export const RESOURCE_TYPES = [
  'USER',
  'ROLE',
  'FILE',
  'DATABASE',
  'API_KEY',
  'CONFIG',
  'SESSION',
];

export const REGIONS = [
  'ap-south-1',
  'ap-southeast-1',
  'eu-west-1',
  'eu-central-1',
  'us-east-1',
  'us-west-2',
  'sa-east-1',
];

export const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

/**
 * Severity is stored as a label *and* as a rank. Sorting the label
 * alphabetically gives CRITICAL < HIGH < LOW < MEDIUM, which is meaningless to
 * an investigator; `severityRank` is what the sort actually orders by.
 */
export const SEVERITY_RANK = Object.freeze({
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
});

// Mixed case matches the sample record in the spec ("Unresolved").
export const STATUSES = ['Unresolved', 'Investigating', 'Resolved', 'False Positive'];

/**
 * Fields a client is allowed to sort by — every column the table renders, and
 * nothing else. Anything outside this list is a 400, not a silent fallback to
 * the default: a sort that quietly doesn't happen is worse than a rejected one.
 *
 * Each entry is backed by an index (see AuditLog). `ingestedAt` is deliberately
 * absent — it is detail-view metadata, not a column, and indexing it would cost
 * write throughput for a sort nobody performs.
 */
export const SORTABLE_FIELDS = [
  'timestamp',
  'actor',
  'role',
  'action',
  'resource',
  'resourceType',
  'ipAddress',
  'region',
  'severity',
  'status',
];

/** Free-text filters applied as anchored prefix matches (index-backed). */
export const PREFIX_FILTER_FIELDS = ['actor', 'resource', 'ipAddress'];

export const DEFAULT_PAGE_SIZE = 25;
export const PAGE_SIZE_OPTIONS = [25, 50, 100];

/** Cap on how many per-record validation errors a bulk response echoes back. */
export const MAX_REPORTED_ERRORS = 100;
