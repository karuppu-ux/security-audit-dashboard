import { z } from 'zod';
import {
  ACTIONS,
  DEFAULT_PAGE_SIZE,
  REGIONS,
  RESOURCE_TYPES,
  ROLES,
  SEVERITIES,
  SEVERITY_RANK,
  SORTABLE_FIELDS,
  STATUSES,
} from '../utils/constants.js';
import { env } from '../config/env.js';

/* -------------------------------------------------------------------------- */
/* Shared primitives                                                          */
/* -------------------------------------------------------------------------- */

const IPV4 =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
// Deliberately permissive on IPv6 shorthand — full RFC 4291 matching in a regex
// costs more in false rejections of legitimate logs than it buys in strictness.
const IPV6 = /^[0-9a-fA-F:]{2,45}$/;

const ipAddress = z
  .string()
  .trim()
  .refine((value) => IPV4.test(value) || (value.includes(':') && IPV6.test(value)), {
    message: 'Must be a valid IPv4 or IPv6 address',
  });

const actor = z.string().trim().toLowerCase().min(3).max(320);

/**
 * Accepts ISO-8601 strings and epoch milliseconds. Rejects anything Date
 * cannot parse — silently storing `Invalid Date` would poison every
 * time-ranged query downstream.
 */
const timestamp = z
  .union([z.string(), z.number(), z.date()])
  .transform((value, ctx) => {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid date' });
      return z.NEVER;
    }
    return date;
  });

/* -------------------------------------------------------------------------- */
/* Ingest                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * One audit record. `.strict()` rejects unknown keys rather than dropping them:
 * a caller sending `severty: "HIGH"` should get a loud error, not a silently
 * mis-classified security event.
 */
export const auditLogRecordSchema = z
  .object({
    actor,
    role: z.enum(ROLES),
    action: z.string().trim().toUpperCase().pipe(z.enum(ACTIONS)),
    resource: z.string().trim().min(1).max(512),
    resourceType: z.string().trim().toUpperCase().pipe(z.enum(RESOURCE_TYPES)),
    ipAddress,
    region: z.enum(REGIONS),
    severity: z.string().trim().toUpperCase().pipe(z.enum(SEVERITIES)),
    status: z.enum(STATUSES),
    timestamp,
  })
  .strict()
  // severityRank is derived, never client-supplied.
  .transform((record) => ({ ...record, severityRank: SEVERITY_RANK[record.severity] }));

/**
 * The body wrapper. Both a bare array and `{ records: [...] }` are accepted
 * because both are what callers actually send; normalising here keeps the
 * service signature single-shaped.
 */
export const bulkUploadBodySchema = z
  .union([
    z.array(z.unknown()),
    z.object({ records: z.array(z.unknown()) }).transform((body) => body.records),
  ])
  .refine((records) => records.length > 0, { message: 'At least one record is required' })
  .refine((records) => records.length <= env.MAX_BULK_RECORDS, {
    message: `A single request may contain at most ${env.MAX_BULK_RECORDS} records`,
    // Surfaced as 413 by the controller rather than 400 — the request is
    // well-formed, just too big.
    params: { tooLarge: true },
  });

/* -------------------------------------------------------------------------- */
/* Query                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Express parses `?severity=HIGH&severity=LOW` into an array but
 * `?severity=HIGH` into a string. Every enum filter therefore accepts both and
 * normalises to an array, which the service turns into `$in`.
 */
const enumList = (values) =>
  z
    .union([z.string(), z.array(z.string())])
    .transform((value) => (Array.isArray(value) ? value : value.split(',')))
    .transform((list) => list.map((item) => item.trim()).filter(Boolean))
    .pipe(z.array(z.enum(values)).min(1))
    .optional();

export const listLogsQuerySchema = z
  .object({
    // Enum filters — closed vocabularies, matched exactly.
    role: enumList(ROLES),
    action: enumList(ACTIONS),
    resourceType: enumList(RESOURCE_TYPES),
    region: enumList(REGIONS),
    severity: enumList(SEVERITIES),
    status: enumList(STATUSES),

    // Free-text filters — anchored prefix match, see the service.
    actor: z.string().trim().toLowerCase().min(1).max(320).optional(),
    resource: z.string().trim().min(1).max(512).optional(),
    ipAddress: z.string().trim().min(1).max(45).optional(),

    // Full-text search across actor/action/resource/resourceType.
    q: z.string().trim().min(1).max(200).optional(),

    // Inclusive date range on the event timestamp.
    from: timestamp.optional(),
    to: timestamp.optional(),

    sort: z.enum(SORTABLE_FIELDS).default('timestamp'),
    order: z.enum(['asc', 'desc']).default('desc'),

    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(env.MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),

    // Opaque keyset cursor. Mutually exclusive with `page`; see the service.
    cursor: z.string().trim().min(1).optional(),
  })
  .strict({ message: 'Unknown query parameter' })
  .refine((query) => !(query.from && query.to) || query.from <= query.to, {
    message: '`from` must be earlier than or equal to `to`',
    path: ['from'],
  })
  .refine((query) => !(query.cursor && query.page > 1), {
    message: 'Use either `page` or `cursor`, not both',
    path: ['cursor'],
  });

export const logIdParamSchema = z.object({
  id: z
    .string()
    .regex(/^[a-f\d]{24}$/i, 'Must be a 24-character hex MongoDB ObjectId'),
});
