import * as auditLogService from '../services/auditLog.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import {
  ACTIONS,
  PAGE_SIZE_OPTIONS,
  REGIONS,
  RESOURCE_TYPES,
  ROLES,
  SEVERITIES,
  SORTABLE_FIELDS,
  STATUSES,
} from '../utils/constants.js';

/**
 * Controllers do HTTP and nothing else: read validated input, call a service,
 * choose a status code. No query building, no database access.
 */

/**
 * POST /api/v1/logs/bulk
 *
 * 201 — every record stored.
 * 207 — partial success; the body reports exactly what landed and what didn't.
 * 400 — nothing could be stored.
 *
 * A 207 rather than a 200 because "some of your records were rejected" is
 * information a client must not be able to miss by only checking `res.ok`.
 */
export const bulkUpload = asyncHandler(async (req, res) => {
  const records = req.validated.body;
  const startedAt = process.hrtime.bigint();

  const summary = await auditLogService.bulkInsertLogs(records);
  const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

  if (summary.inserted === 0) {
    throw ApiError.badRequest('No valid records could be stored', summary.errors);
  }

  const status = summary.inserted === summary.received ? 201 : 207;

  res.status(status).json({
    data: {
      ...summary,
      durationMs: Math.round(durationMs),
      truncatedErrors: summary.invalid + summary.failed > summary.errors.length,
    },
  });
});

/** GET /api/v1/logs — filtering, search, sorting and pagination, all server-side. */
export const listLogs = asyncHandler(async (req, res) => {
  const { items, meta } = await auditLogService.listLogs(req.validated.query);
  res.status(200).json({ data: items, meta });
});

/** GET /api/v1/logs/:id — full detail for the row-click investigation view. */
export const getLogById = asyncHandler(async (req, res) => {
  const log = await auditLogService.getLogById(req.validated.params.id);
  res.status(200).json({ data: log });
});

/**
 * GET /api/v1/logs/meta/enums
 *
 * Filter vocabularies come from the server so the UI cannot drift out of sync
 * with what the API will actually accept. Enum lists are static rather than
 * `distinct()` queries: a filter panel should offer every valid value, not only
 * the ones that happen to exist in the current data set.
 */
export const getFilterMetadata = asyncHandler(async (req, res) => {
  const stats = await auditLogService.getFilterMetadata();

  res.status(200).json({
    data: {
      enums: {
        role: ROLES,
        action: ACTIONS,
        resourceType: RESOURCE_TYPES,
        region: REGIONS,
        severity: SEVERITIES,
        status: STATUSES,
      },
      sortableFields: SORTABLE_FIELDS,
      pageSizeOptions: PAGE_SIZE_OPTIONS,
      ...stats,
    },
  });
});
