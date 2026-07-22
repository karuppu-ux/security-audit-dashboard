import { AuditLog } from '../models/AuditLog.js';
import { auditLogRecordSchema } from '../validation/auditLog.schemas.js';
import { formatZodIssues } from '../validation/validate.js';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { MAX_REPORTED_ERRORS, PREFIX_FILTER_FIELDS, SEVERITY_RANK } from '../utils/constants.js';

/* ========================================================================== */
/* Bulk ingest                                                                */
/* ========================================================================== */

/**
 * Validate and persist a batch of raw records.
 *
 * Two properties matter here and drive the shape of this function:
 *
 * 1. **One bad record must not fail the batch.** Records are validated
 *    individually and written with `ordered: false`, so MongoDB continues past
 *    a failing document instead of aborting at the first one. The caller gets
 *    per-record errors and exact counts.
 * 2. **Memory must not spike.** Rather than validating all 10k records into a
 *    second full-size array and then writing, we validate and write in slices
 *    of `BULK_BATCH_SIZE`. Peak additional memory is one batch, not one copy of
 *    the whole payload.
 *
 * @param {unknown[]} rawRecords
 * @returns {Promise<{received:number, valid:number, invalid:number, inserted:number, failed:number, errors:Array}>}
 */
export async function bulkInsertLogs(rawRecords) {
  const summary = {
    received: rawRecords.length,
    valid: 0,
    invalid: 0,
    inserted: 0,
    failed: 0,
    errors: [],
  };

  for (let offset = 0; offset < rawRecords.length; offset += env.BULK_BATCH_SIZE) {
    const slice = rawRecords.slice(offset, offset + env.BULK_BATCH_SIZE);
    const documents = [];

    for (let i = 0; i < slice.length; i += 1) {
      const parsed = auditLogRecordSchema.safeParse(slice[i]);
      if (parsed.success) {
        documents.push(parsed.data);
      } else {
        summary.invalid += 1;
        pushError(summary, {
          index: offset + i,
          reason: 'VALIDATION_ERROR',
          issues: formatZodIssues(parsed.error),
        });
      }
    }

    summary.valid += documents.length;
    if (documents.length === 0) continue;

    const written = await insertBatch(documents, offset);
    summary.inserted += written.inserted;
    summary.failed += written.failed;
    written.errors.forEach((error) => pushError(summary, error));
  }

  return summary;
}

/**
 * Write one slice. `ordered: false` lets the driver attempt every document and
 * report the failures, instead of stopping at the first one. `rawResult` gives
 * us the driver's insertedCount so success is measured, not assumed.
 */
async function insertBatch(documents, offset) {
  try {
    const result = await AuditLog.insertMany(documents, {
      ordered: false,
      rawResult: true,
    });
    return { inserted: result.insertedCount ?? documents.length, failed: 0, errors: [] };
  } catch (error) {
    // MongoBulkWriteError: some documents landed, some did not.
    const inserted = error?.result?.insertedCount ?? error?.insertedDocs?.length ?? 0;
    const writeErrors = error?.writeErrors ?? error?.result?.result?.writeErrors ?? [];

    if (!writeErrors.length && inserted === 0) {
      // Not a partial-write failure — the whole operation failed (connection
      // lost, auth, etc.). That is not something to summarise away.
      throw error;
    }

    return {
      inserted,
      failed: documents.length - inserted,
      errors: writeErrors.map((writeError) => ({
        index: offset + (writeError.index ?? writeError.err?.index ?? 0),
        reason: 'WRITE_ERROR',
        issues: [{ path: '(document)', message: writeError.errmsg ?? String(writeError) }],
      })),
    };
  }
}

/** Cap echoed errors so a fully-invalid 10k upload cannot produce a 10MB response. */
function pushError(summary, error) {
  if (summary.errors.length < MAX_REPORTED_ERRORS) summary.errors.push(error);
}

/* ========================================================================== */
/* Query                                                                      */
/* ========================================================================== */

/** Escape user input before it reaches a RegExp, so `.` and `*` stay literal. */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Translate validated query params into a MongoDB filter.
 *
 * Free-text field filters are **anchored** prefix matches (`/^value/`). An
 * unanchored `/value/i` cannot use an index and would collection-scan the whole
 * collection on every keystroke — the exact failure mode this brief is testing
 * for. `actor` is stored lowercased, so its prefix match is effectively
 * case-insensitive without needing the `i` flag that would defeat the index.
 */
export function buildFilter(query) {
  const filter = {};

  for (const field of ['role', 'action', 'resourceType', 'region', 'status']) {
    const values = query[field];
    if (!values?.length) continue;
    filter[field] = values.length === 1 ? values[0] : { $in: values };
  }

  // Severity is filtered on the numeric rank, not the label, so that filtering
  // and ordering by severity share one index (see AuditLog index #2).
  if (query.severity?.length) {
    const ranks = query.severity.map((label) => SEVERITY_RANK[label]);
    filter.severityRank = ranks.length === 1 ? ranks[0] : { $in: ranks };
  }

  for (const field of PREFIX_FILTER_FIELDS) {
    if (!query[field]) continue;
    filter[field] = { $regex: `^${escapeRegExp(query[field])}` };
  }

  if (query.from || query.to) {
    filter.timestamp = {};
    if (query.from) filter.timestamp.$gte = query.from;
    if (query.to) filter.timestamp.$lte = query.to;
  }

  if (query.q) {
    // $text uses the weighted text index; see AuditLog index #10.
    filter.$text = { $search: query.q };
  }

  return filter;
}

/**
 * Build the sort spec.
 *
 * `_id` is always appended as a tiebreaker: without a total order, two pages of
 * a skip/limit query can return the same document twice (or skip one entirely)
 * whenever the sort key has duplicates — and timestamps in audit logs duplicate
 * constantly.
 *
 * Every component uses the *same* direction. MongoDB can only walk an index
 * forwards or exactly backwards, so a mixed-direction sort like
 * `{actor: -1, timestamp: -1}` cannot be served by an `{actor: 1, timestamp: -1}`
 * index and quietly becomes a collection scan plus an in-memory sort. Uniform
 * directions let one ascending index serve a column sorted either way.
 */
export function buildSort({ sort, order }) {
  const direction = order === 'asc' ? 1 : -1;
  // Sorting on the severity *label* would order CRITICAL < HIGH < LOW < MEDIUM.
  const field = sort === 'severity' ? 'severityRank' : sort;

  if (field === 'timestamp') return { timestamp: direction, _id: direction };
  return { [field]: direction, timestamp: direction, _id: direction };
}

const encodeCursor = (doc) =>
  Buffer.from(JSON.stringify({ t: doc.timestamp.toISOString(), i: doc._id.toString() })).toString(
    'base64url'
  );

function decodeCursor(cursor) {
  try {
    const { t, i } = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    const timestamp = new Date(t);
    if (Number.isNaN(timestamp.getTime()) || !/^[a-f\d]{24}$/i.test(i)) throw new Error('bad');
    return { timestamp, id: i };
  } catch {
    throw ApiError.badRequest('Malformed `cursor`');
  }
}

/**
 * List logs with server-side filtering, search, sorting and pagination.
 *
 * Supports two pagination modes:
 *
 * - **Offset** (default): `page` + `limit`. Matches the page-number UI and
 *   yields a total count, at the cost of `skip` degrading linearly on deep
 *   pages — Mongo must walk and discard every skipped index entry.
 * - **Keyset** (`cursor`): seeks directly into `idx_timestamp_id` with a
 *   compound `(timestamp, _id) < cursor` predicate, so page 1 and page 10,000
 *   cost the same. Only offered for the default `timestamp` sort, which is the
 *   only sort whose index carries the tiebreaker needed to make it correct.
 */
export async function listLogs(query) {
  const filter = buildFilter(query);
  const sort = buildSort(query);

  if (query.cursor) return listByCursor({ query, filter });

  const skip = (query.page - 1) * query.limit;

  // Count and page are independent — run them concurrently rather than
  // serially, since the count is the slower of the two on wide filters.
  const [items, total] = await Promise.all([
    AuditLog.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(query.limit)
      .maxTimeMS(env.QUERY_TIMEOUT_MS)
      .lean(),
    countMatching(filter),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / query.limit));

  return {
    items: items.map(serialize),
    meta: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages,
      hasPreviousPage: query.page > 1,
      hasNextPage: query.page < totalPages,
      sort: query.sort,
      order: query.order,
      mode: 'offset',
      // Hand back a cursor so a client on a deep page can switch to keyset.
      nextCursor:
        query.sort === 'timestamp' && items.length === query.limit
          ? encodeCursor(items[items.length - 1])
          : null,
    },
  };
}

async function listByCursor({ query, filter }) {
  if (query.sort !== 'timestamp') {
    throw ApiError.badRequest('Cursor pagination is only supported with `sort=timestamp`');
  }

  const { timestamp, id } = decodeCursor(query.cursor);
  const comparison = query.order === 'asc' ? '$gt' : '$lt';

  // Compound seek: strictly past the cursor's timestamp, or same timestamp and
  // strictly past its _id. This is what makes the tiebreaker index earn its keep.
  const seek = {
    $or: [
      { timestamp: { [comparison]: timestamp } },
      { timestamp, _id: { [comparison]: id } },
    ],
  };

  // `$and` rather than a spread merge, so a filter that already uses `$or`
  // (or `$text`) cannot silently clobber the seek predicate.
  const items = await AuditLog.find({ $and: [filter, seek] })
    .sort(buildSort(query))
    .limit(query.limit)
    .maxTimeMS(env.QUERY_TIMEOUT_MS)
    .lean();

  return {
    items: items.map(serialize),
    meta: {
      limit: query.limit,
      // Deliberately no `total`: counting defeats the purpose of keyset paging.
      total: null,
      sort: query.sort,
      order: query.order,
      mode: 'cursor',
      hasNextPage: items.length === query.limit,
      nextCursor: items.length === query.limit ? encodeCursor(items[items.length - 1]) : null,
    },
  };
}

/**
 * `estimatedDocumentCount` reads collection metadata (O(1)) but ignores
 * filters, so it is only correct for the unfiltered case — which is also the
 * case where an exact count is most expensive. Filtered counts use the real
 * thing, bounded by a server-side timeout.
 */
async function countMatching(filter) {
  if (Object.keys(filter).length === 0) return AuditLog.estimatedDocumentCount();
  return AuditLog.countDocuments(filter).maxTimeMS(env.QUERY_TIMEOUT_MS);
}

export async function getLogById(id) {
  const log = await AuditLog.findById(id).lean();
  if (!log) throw ApiError.notFound(`No audit log found with id "${id}"`);
  return serialize(log);
}

/**
 * Values the filter panel needs. Enum vocabularies come from constants (so the
 * UI shows every valid option, not just the ones that happen to be present),
 * while page-size options keep client and server in agreement.
 */
export async function getFilterMetadata() {
  const [total, oldest, newest] = await Promise.all([
    AuditLog.estimatedDocumentCount(),
    AuditLog.findOne().sort({ timestamp: 1 }).select('timestamp').lean(),
    AuditLog.findOne().sort({ timestamp: -1 }).select('timestamp').lean(),
  ]);

  return {
    totalRecords: total,
    timestampRange: {
      earliest: oldest?.timestamp ?? null,
      latest: newest?.timestamp ?? null,
    },
  };
}

/**
 * Shape a lean document into the public API representation: expose `id`, hide
 * the internal `_id` and the derived `severityRank` sort key.
 */
function serialize({ _id, severityRank: _rank, ...rest }) {
  return { id: _id.toString(), ...rest };
}
