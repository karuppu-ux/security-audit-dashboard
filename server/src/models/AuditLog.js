import mongoose from 'mongoose';
import {
  ACTIONS,
  REGIONS,
  RESOURCE_TYPES,
  ROLES,
  SEVERITIES,
  SEVERITY_RANK,
  STATUSES,
} from '../utils/constants.js';

const auditLogSchema = new mongoose.Schema(
  {
    actor: {
      type: String,
      required: true,
      trim: true,
      // Normalised on write so that equality lookups and anchored prefix
      // searches are both index-backed. A case-insensitive regex over a
      // mixed-case field cannot use a plain b-tree index.
      lowercase: true,
      maxlength: 320,
    },
    role: { type: String, required: true, enum: ROLES },
    action: { type: String, required: true, enum: ACTIONS, uppercase: true },
    resource: { type: String, required: true, trim: true, maxlength: 512 },
    resourceType: { type: String, required: true, enum: RESOURCE_TYPES, uppercase: true },
    ipAddress: { type: String, required: true, trim: true, maxlength: 45 },
    region: { type: String, required: true, enum: REGIONS },
    severity: { type: String, required: true, enum: SEVERITIES, uppercase: true },
    // Derived, never accepted from the client. See constants.js for why.
    severityRank: { type: Number, required: true, min: 1, max: 4 },
    status: { type: String, required: true, enum: STATUSES },
    // The time the event happened, as reported by the source system.
    timestamp: { type: Date, required: true },
  },
  {
    versionKey: false,
    // Ingest time is distinct from event time: a log can arrive hours after the
    // event, and an investigator needs to be able to tell those apart.
    timestamps: { createdAt: 'ingestedAt', updatedAt: false },
    toJSON: {
      virtuals: true,
      transform: (_doc, ret) => {
        ret.id = ret._id.toString();
        delete ret._id;
        // Internal sort key; the label is the API contract.
        delete ret.severityRank;
        return ret;
      },
    },
  }
);

/**
 * Index design.
 *
 * Two rules produce the shape below, and both were arrived at by reading
 * `explain()` output from `npm run perf`, not by guessing:
 *
 * **ESR** — equality-filtered fields first, then the sort key. The trailing
 * `timestamp` means one index serves both the filter and the "newest first"
 * ordering, so no in-memory SORT stage is needed on a filtered query.
 *
 * **Uniform key direction** — every compound index is fully ascending, and
 * `buildSort` emits every sort component in the same direction. MongoDB can
 * walk an index forwards or exactly backwards, but nothing in between: a sort
 * of `{actor: -1, timestamp: -1}` against an index of `{actor: 1, timestamp: -1}`
 * is neither, and silently degrades to a collection scan. Keeping directions
 * uniform means one index serves a column sorted both ways *and* the
 * filter-plus-timestamp query.
 *
 * Every index ends in `_id` so the ordering is total. Without a tiebreaker,
 * two pages of a skip/limit query over duplicate timestamps can repeat a
 * document or drop one — and audit timestamps duplicate constantly.
 *
 * The cost is 12 indexes on a write-heavy collection. That is a deliberate
 * trade: audit logs are written once in bulk batches and then read and
 * re-queried for the lifetime of an investigation, so read latency is the
 * product and write throughput is the budget. Measured impact is in the README.
 */

// 1. Default view: everything, newest first.
auditLogSchema.index({ timestamp: -1, _id: -1 }, { name: 'idx_timestamp_id' });

// 2. The canonical triage query: "unresolved CRITICAL alerts, newest first".
//    Keyed on `severityRank` rather than the `severity` label so that filtering
//    and ordering by risk share one representation; ordering by the label would
//    give CRITICAL < HIGH < LOW < MEDIUM.
auditLogSchema.index(
  { severityRank: 1, status: 1, timestamp: 1, _id: 1 },
  { name: 'idx_severityrank_status_ts' }
);

/*
 * 3–11: one index per filterable/sortable column, each shaped
 * `{column, timestamp, _id}`. Each serves three jobs: equality filter on the
 * column, the column's own sorted view, and the "filter by column, order by
 * time" query that dominates investigation.
 *
 * Index 3 looks redundant against index 2 but is not: in index 2 the `status`
 * key sits *between* `severityRank` and `timestamp`, so the sort keys
 * `{severityRank, timestamp, _id}` are not a contiguous prefix of it and
 * MongoDB cannot use it to order a severity-sorted view. Verified with
 * `npm run perf` — without index 3 that query is a full collection scan.
 */

// 3. Sorting and filtering by risk.
auditLogSchema.index({ severityRank: 1, timestamp: 1, _id: 1 }, { name: 'idx_severityrank_ts' });

// 4. "Everything still open", and the sortable status column.
auditLogSchema.index({ status: 1, timestamp: 1, _id: 1 }, { name: 'idx_status_ts' });

// 5. "Show me everything this account did" — the first pivot in any
//    investigation. Also backs the anchored prefix filter on actor.
auditLogSchema.index({ actor: 1, timestamp: 1, _id: 1 }, { name: 'idx_actor_ts' });

// 6. "Every DELETE_USER in the last 30 days".
auditLogSchema.index({ action: 1, timestamp: 1, _id: 1 }, { name: 'idx_action_ts' });

// 7. Role-scoped review, e.g. auditing privileged accounts only.
auditLogSchema.index({ role: 1, timestamp: 1, _id: 1 }, { name: 'idx_role_ts' });

// 8. Blast radius: which class of resource was touched.
auditLogSchema.index({ resourceType: 1, timestamp: 1, _id: 1 }, { name: 'idx_resourcetype_ts' });

// 9. Per-region compliance and data-residency reviews.
auditLogSchema.index({ region: 1, timestamp: 1, _id: 1 }, { name: 'idx_region_ts' });

// 10. "Everything from this IP" — the second pivot in any investigation.
auditLogSchema.index({ ipAddress: 1, timestamp: 1, _id: 1 }, { name: 'idx_ip_ts' });

// 11. Resource-path prefix filtering ("everything under /api/users/") and the
//     sortable resource column.
auditLogSchema.index({ resource: 1, timestamp: 1, _id: 1 }, { name: 'idx_resource_ts' });

// 12. Free-text search (`?q=`). MongoDB permits exactly one text index per
//     collection, so it spans the four fields worth searching. Weighted so a
//     hit on the actor outranks an incidental hit in a resource path.
auditLogSchema.index(
  { actor: 'text', action: 'text', resource: 'text', resourceType: 'text' },
  {
    name: 'idx_text_search',
    weights: { actor: 10, action: 5, resource: 3, resourceType: 1 },
  }
);

/**
 * Keep severityRank in lockstep with severity. The bulk path already derives it
 * in the Zod transform, but a derived field that can drift is a data-integrity
 * bug waiting to happen, so it is enforced at the schema level too — `validate`
 * middleware runs for insertMany as well as for individual saves.
 */
auditLogSchema.pre('validate', function setSeverityRank(next) {
  if (this.severity) this.severityRank = SEVERITY_RANK[this.severity.toUpperCase()];
  next();
});

export const AuditLog = mongoose.model('AuditLog', auditLogSchema);
