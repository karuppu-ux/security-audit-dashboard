# Security Audit Log Dashboard

An internal tool for security engineers to upload, browse and investigate system audit logs.
Filtering, search, sorting and pagination all run **server-side** against MongoDB — the client
never holds more than the page it is showing.

**Stack:** React 18 · Vite · TanStack Query · Tailwind · Node 22 · Express · MongoDB (Mongoose) · Zod · Jest

---

## Table of contents

- [Quick start](#quick-start)
- [Running with Docker](#running-with-docker)
- [Seeding 10,000 records](#seeding-10000-records)
- [API reference](#api-reference)
- [Technical decisions](#technical-decisions)
  - [Schema and index design](#1-schema-and-index-design)
  - [Pagination strategy](#2-pagination-strategy)
  - [Bulk insert](#3-bulk-insert)
  - [Validation](#4-validation)
  - [Frontend state management](#5-frontend-state-management)
  - [Error handling](#6-error-handling)
- [Measured performance](#measured-performance)
- [Assumptions](#assumptions)
- [What I would do next](#what-i-would-do-next)

---

## Quick start

Requires **Node 20+**. No MongoDB installation is needed for local development — see below.

```bash
npm --prefix server install && npm --prefix client install
```

Start the API (terminal 1):

```bash
npm --prefix server run dev
```

Start the dashboard (terminal 2):

```bash
npm --prefix client run dev
```

Open <http://localhost:5173>. Vite proxies `/api` to `http://localhost:4000`, so the browser sees
a same-origin API and CORS never comes into play locally.

### About the database

`MONGODB_URI` is **optional in development**. Left empty, the API starts an in-process MongoDB via
`mongodb-memory-server` (it downloads a real `mongod` binary on first run, ~600MB, cached
afterwards). This means the project clones and runs on a clean machine with nothing installed —
which is exactly what you want when handing a repo to someone else.

Data in that mode is **not persisted** across restarts. For a persistent database, copy
`server/.env.example` to `server/.env` and set:

```bash
MONGODB_URI=mongodb://127.0.0.1:27017/audit_logs        # local install
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net # Atlas
```

`MONGODB_URI` is **required** when `NODE_ENV=production`; the server refuses to boot without it
rather than silently starting an in-memory database that loses every audit record on restart.

---

## Running with Docker

```bash
docker compose up --build
```

| Service | URL                     |
| ------- | ----------------------- |
| web     | <http://localhost:8080> |
| api     | <http://localhost:4000> |
| mongo   | `localhost:27017`       |

nginx serves the built React app and proxies `/api` to the API on the same origin. The API waits
on Mongo's healthcheck, so it never starts against a database that is listening but not yet ready.

---

## Seeding 10,000 records

With the API running:

```bash
npm --prefix server run seed
```

This generates 10,000 realistic records and **uploads them in a single HTTP request**, then prints
the timing:

```
Generating 10,000 audit log records...
Generated in 142ms
  POST /api/v1/logs/bulk → 201 | 10,000 records | 2.53MB | 3224ms | inserted 10000

Seed complete
  inserted : 10,000
  duration : 3237ms (3,089 records/sec)
```

Options: `--count N`, `--chunk N` (records per request; defaults to all in one), `--api URL`,
`--clear`.

The data is **correlated, not uniform random**: actions match their resource types and paths,
severity is weighted by action risk, status correlates with severity, ~200 recurring actors with a
few noisy service accounts, IPs skewed towards internal ranges. Uniform random data makes every
filter return ~1/N of the collection, which hides both good and bad index behaviour. `faker` is
seeded with a fixed value, so runs are reproducible and comparable.

### Proving the queries are index-backed

```bash
npm --prefix server run perf
```

Runs every dashboard query through `explain('executionStats')` and reports the index chosen, the
documents and index keys examined, and whether the sort was satisfied by the index or done in
memory. It **exits non-zero** if anything falls back to a collection scan — so it works as a
regression check, not just a report. Output is in [Measured performance](#measured-performance).

---

## Tests

```bash
npm --prefix server test
```

70 tests across bulk upload, the query engine and the detail endpoint. They run against a real
MongoDB (`mongodb-memory-server`), not mocks: index selection, `$text` search and `ordered: false`
partial writes are precisely the behaviours this project depends on, and a stubbed model would
verify none of them.

---

## API reference

Base URL `/api/v1`. All responses are JSON.

**Success:** `{ "data": ..., "meta": ... }` &nbsp;•&nbsp; **Error:** `{ "error": { "code", "message", "details" } }`

### `GET /health`

Liveness and readiness. Returns `503` when the database is not connected, so an orchestrator stops
routing traffic to an instance that cannot serve a query.

### `POST /api/v1/logs/bulk`

Ingest up to 20,000 records in one request. Body is either a bare array or `{ "records": [...] }`.

```jsonc
// 201 Created — everything stored
{
  "data": {
    "received": 10000, "valid": 10000, "inserted": 10000,
    "invalid": 0, "failed": 0, "errors": [],
    "durationMs": 2609, "truncatedErrors": false
  }
}
```

| Status | Meaning                                                       |
| ------ | ------------------------------------------------------------- |
| `201`  | every record stored                                            |
| `207`  | partial success — `errors[]` names the offending indexes       |
| `400`  | nothing could be stored, or the body is malformed              |
| `413`  | more than `MAX_BULK_RECORDS`, or the body exceeds the size cap |

A `207` rather than a `200` on partial success, because "some of your audit records were rejected"
must not be missable by a client that only checks `response.ok`.

### `GET /api/v1/logs`

| Param                                                       | Type                | Notes                                                  |
| ----------------------------------------------------------- | ------------------- | ------------------------------------------------------ |
| `severity` `status` `role` `action` `resourceType` `region` | enum, repeatable    | `?severity=HIGH&severity=CRITICAL` or `?severity=HIGH,CRITICAL` → `$in` |
| `actor` `resource` `ipAddress`                              | string              | **anchored prefix** match (see below)                  |
| `q`                                                         | string              | full-text across actor, action, resource, resourceType |
| `from` `to`                                                 | ISO-8601            | inclusive range on `timestamp`                         |
| `sort`                                                      | enum                | any table column; default `timestamp`                  |
| `order`                                                     | `asc` \| `desc`     | default `desc`                                         |
| `page` `limit`                                              | int                 | default `1` / `25`; `limit` max `100`                  |
| `cursor`                                                    | opaque              | keyset pagination; mutually exclusive with `page`       |

```jsonc
{
  "data": [ { "id": "...", "actor": "priya.nair@company.com", "severity": "HIGH", ... } ],
  "meta": {
    "page": 1, "limit": 25, "total": 10000, "totalPages": 400,
    "hasPreviousPage": false, "hasNextPage": true,
    "sort": "timestamp", "order": "desc", "mode": "offset",
    "nextCursor": "eyJ0IjoiMjAyNS0wOC0yOVQyMzoxMjowMFoiLCJpIjoiNjZ..."
  }
}
```

**Unknown or invalid parameters are rejected with `400`, never ignored.** A filter that silently
does nothing is a security-tool bug: the operator believes they narrowed the result set when they
did not, and draws a conclusion from data they never actually saw.

### `GET /api/v1/logs/:id`

Full record for the detail view. `404` if not found, `400` for a malformed ObjectId.

### `GET /api/v1/logs/meta/enums`

Enum vocabularies, sortable fields, page-size options, record count and timestamp range. The UI
builds its filter panel from this, so the client cannot drift out of sync with what the API
accepts.

---

## Technical decisions

### 1. Schema and index design

The record is stored close to the spec's shape, with two additions:

- **`severityRank` (1–4), derived on write.** Sorting the `severity` *label* alphabetically gives
  `CRITICAL < HIGH < LOW < MEDIUM`, which is meaningless to an investigator. The rank is what the
  sort and the severity filter actually use; the label stays the API contract and is stripped from
  responses.
- **`ingestedAt`, separate from `timestamp`.** A log can arrive hours after the event it describes,
  and an investigator needs to be able to tell those apart — a gap between them is itself a signal.

`actor` is **lowercased on write**. This is what makes case-insensitive actor lookup index-backed:
a `/value/i` regex over a mixed-case field cannot use a b-tree index, so normalising at write time
buys correctness *and* performance.

Enums are closed (`role`, `action`, `resourceType`, `region`, `severity`, `status`). An audit store
where `severity` can be any string is one you cannot reliably query or alert on.

#### Two rules produce the index set

**ESR — Equality, Sort, Range.** Equality-filtered fields first, then the sort key. Every compound
index ends in `timestamp`, so one index serves both the filter and the default "newest first"
ordering with no in-memory SORT stage.

**Uniform key direction.** MongoDB can walk an index forwards or exactly backwards, but nothing in
between. A sort of `{actor: -1, timestamp: -1}` against an index of `{actor: 1, timestamp: -1}` is
neither — and degrades to a full collection scan *silently*. So every compound index is fully
ascending and `buildSort` emits every component in the same direction, which lets one index serve a
column sorted both ways as well as the filter-plus-timestamp query. I found this by reading
`explain()` output, not by reasoning about it: the first version of this schema collection-scanned
on four of the twenty sortable-column queries.

Every index ends in **`_id`**. Without a total order, two pages of a `skip`/`limit` query over
duplicate timestamps can repeat a document or drop one — and audit timestamps duplicate constantly.

| # | Index | Serves |
|---|-------|--------|
| 1 | `{timestamp: -1, _id: -1}` | default view, date-range queries |
| 2 | `{severityRank, status, timestamp, _id}` | the canonical triage query: unresolved CRITICAL, newest first |
| 3 | `{severityRank, timestamp, _id}` | severity filter and the severity-sorted view |
| 4 | `{status, timestamp, _id}` | "everything still open" |
| 5 | `{actor, timestamp, _id}` | "everything this account did" — the first investigation pivot |
| 6 | `{action, timestamp, _id}` | "every DELETE_USER this month" |
| 7 | `{role, timestamp, _id}` | privileged-account review |
| 8 | `{resourceType, timestamp, _id}` | blast radius |
| 9 | `{region, timestamp, _id}` | data-residency and compliance review |
| 10 | `{ipAddress, timestamp, _id}` | "everything from this IP" — the second pivot |
| 11 | `{resource, timestamp, _id}` | path-prefix filtering |
| 12 | text index on `actor, action, resource, resourceType` | `?q=` search |

**Index 3 looks redundant against index 2 but is not.** In index 2 the `status` key sits *between*
`severityRank` and `timestamp`, so the sort keys `{severityRank, timestamp, _id}` are not a
contiguous prefix of it and MongoDB cannot use it to order a severity-sorted view. Removing index 3
turns that query into a collection scan — `npm run perf` catches it.

**The cost.** 12 indexes on a write-heavy collection is a lot, and it is deliberate. Measured on
10,000 inserts: **989ms with all indexes vs 124ms with only `_id`** — roughly 8× slower on writes.
That trade is right here because audit logs are written once, in bulk, off the critical path, and
then read and re-queried for the lifetime of an investigation. Query latency is the product; write
throughput is the budget. On a collection an order of magnitude larger I would revisit indexes
5–11 against real query telemetry and drop the ones nobody uses.

#### Search semantics

`?q=` uses the **text index** — the only index-backed full-text option in stock MongoDB. It is
word-level, so `priya.nair@company.com` is findable by `priya`, `nair` or `company.com`, but not by
the substring `ya.na`.

The per-field filters (`actor`, `resource`, `ipAddress`) are **anchored prefix** matches (`/^value/`).
This is the deliberate part: an unanchored `/value/i` cannot use an index and would collection-scan
on every keystroke of a debounced search box. Anchoring keeps them index-backed and makes
`ipAddress=192.168.1.` a subnet sweep, which is how people actually use it. User input is escaped
before it reaches the `RegExp`, so `.` and `*` stay literal.

For substring and fuzzy matching I would move to **Atlas Search** (Lucene-backed) rather than
loosening these regexes — that is the right tool, and a `$regex` scan over millions of audit
records is not.

### 2. Pagination strategy

**Both modes are implemented.**

*Offset* (`page` + `limit`) is the default because the UI shows page numbers and a total. Its cost
is real and measurable: page 300 walks **7,500 index keys to return 25 documents**, because `skip`
reads and discards every key it steps over. That is linear in page depth, so at page 4,000 it walks
100,000.

*Keyset* (`cursor`) seeks directly into `idx_timestamp_id` with a compound
`(timestamp, _id) < cursor` predicate, so it walks ~25 keys **at any depth**. Every offset response
includes a `nextCursor`, so a client on a deep page can switch modes. Keyset mode is offered only
for the default `timestamp` sort — the only sort whose index carries the tiebreaker that makes it
correct — and returns no `total`, because counting the whole result set would defeat the point.

Counting is also handled deliberately: `estimatedDocumentCount()` (O(1), reads collection metadata)
when there are no filters, a real `countDocuments()` bounded by `maxTimeMS` when there are. The
count and the page run concurrently, not serially.

### 3. Bulk insert

Two properties drive the implementation:

**One bad record must not fail the batch.** Records are validated individually and written with
`insertMany(..., { ordered: false })`, so MongoDB continues past a failing document instead of
aborting at the first. The response reports `received / valid / inserted / invalid / failed` plus
per-record errors with their index in the original payload.

**Memory must not spike.** Rather than validating all 10,000 records into a second full-size array
and then writing, the service validates and writes in slices of `BULK_BATCH_SIZE` (1,000). Peak
additional memory is one batch, not a second copy of the payload.

Supporting details: Express's JSON limit is raised to `25mb` (10k records ≈ 2.5MB; the 100kb
default would reject it outright); a `MAX_BULK_RECORDS` cap returns `413` before any parsing work;
echoed errors are capped at 100 with `truncatedErrors: true`, so a fully-invalid 10k upload cannot
produce a 10MB response.

For a 100k+ ingest I would switch to **NDJSON streaming** rather than raise the limits again — a
single JSON body has to be fully buffered and parsed before the first record can be written.

### 4. Validation

**Zod, at every boundary, including the environment.** `server/src/config/env.js` validates
`process.env` with the same tool used for requests, so a missing or malformed variable crashes the
process at boot with a readable message instead of surfacing as a confusing runtime error on the
first request that happens to touch it.

Request schemas are `.strict()` — **unknown keys are rejected, not dropped**. A caller sending
`severty: "HIGH"` gets a loud error rather than a silently misclassified security event.

The schemas also normalise: `actor` lowercased, `action`/`severity`/`resourceType` uppercased,
timestamps coerced from ISO strings or epoch millis and rejected if `Date` cannot parse them.
Storing an `Invalid Date` would poison every time-ranged query downstream.

Validated output goes to `req.validated[source]` rather than back onto `req.query` (which is a
read-only getter in Express 5) — keeping the raw input intact also makes a rejected request far
easier to debug.

Mongoose's schema validation is kept on as a second line of defence. It should never fire; if it
does, that is schema drift between the Zod schema and the model, and I would rather find out via a
400 than via corrupt data.

### 5. Frontend state management

**No Redux, no Zustand. TanStack Query for server state + the URL for everything else.**

Once the server owns querying, there is no meaningful client-side application state left to
centralise — only *server cache* and *the current query*. TanStack Query handles the first
(caching, deduplication, request cancellation, `placeholderData` so the table doesn't collapse to a
spinner on every sort).

The second lives entirely in the **URL query string**. Every filter, the search term, the sort and
the page are in the address bar, which means an investigator can bookmark a view, paste a teammate
a link that reproduces exactly what they are looking at, and use the browser's back button to step
back through their own investigation. Holding that in `useState` would throw all of it away *and*
add a second source of truth to keep in sync with the URL.

`queryKey: ['logs', query]` is the query object verbatim, so any change to a filter, the sort or
the page is a new cache entry and a new server request. **There is no client-side array being
filtered, sorted or sliced anywhere in the app** — DevTools' network tab shows a request per
interaction, which is the check the brief asks for.

UI decisions worth calling out: search and text filters are debounced 300ms with in-flight requests
aborted; severity and status are the only saturated colour in the interface, so risk is what the
eye lands on when scanning; rows are keyboard-activatable and the table carries `aria-sort`; the
detail drawer offers one-click pivots to "everything from this actor / this IP", which is the
motion an investigation actually takes; timestamps are rendered in **UTC and labelled as such**,
because silently converting to the viewer's local timezone is how two people end up arguing about
events that happened at the same instant.

### 6. Error handling

One `errorHandler` middleware is the only place an error becomes a response, so the envelope is
identical across the API and no handler can invent its own shape or leak a stack trace in
production. It maps `ZodError` → 400 with field paths, Mongoose `ValidationError`/`CastError` → 400,
body-parser failures → 400/413, `MaxTimeMSExpired` → 503 with an actionable message, and anything
unanticipated → a generic 500 with the real error going to the logs, not the wire. 5xx is logged
loudly (it is a bug in this service); 4xx is not (it is a caller mistake, and would only add noise).

`asyncHandler` wraps every async route — Express 4 does not catch rejected promises, and an
unhandled rejection there hangs the request until the client times out.

On the client, every failure path has a screen: skeleton rows while loading, an explicit empty
state that distinguishes "no data at all" from "no data matching *these filters*" and offers the
action that fixes it, and an error state that surfaces the server's field-level `details` so a bad
query is diagnosable rather than just "400". A non-JSON error response is reported as "the API is
not responding" rather than a bare 500, because that is what it actually means.

---

## Measured performance

10,000 seeded records, `npm --prefix server run perf`. **Docs/Keys** are documents and index keys
examined to return the page — close to `Returned` means the index is doing the work.

```
Scenario                                      Index                        Scan     Returned  Docs  Keys  Sort       ms
-----------------------------------------------------------------------------------------------------------------------
Default view (newest first, no filters)       idx_timestamp_id             IXSCAN   25        25    25    index      0
Triage: unresolved CRITICAL, newest first     idx_severityrank_status_ts   IXSCAN   25        25    25    index      1
Multi-value enum filter (HIGH + CRITICAL)     idx_severityrank_ts          IXSCAN   25        25    26    index      1
Pivot: single actor prefix                    idx_timestamp_id             IXSCAN   25        232   232   index      2
Pivot: single IP prefix                       idx_timestamp_id             IXSCAN   25        367   367   index      4
Blast radius: resourceType + severity         idx_resourcetype_ts          IXSCAN   25        84    84    index      1
Date range (30-day window)                    idx_timestamp_id             IXSCAN   25        25    25    index      0
Full-text search (q=DELETE_USER)              idx_text_search              IXSCAN   25        518   518   in-memory  4
Deep page — offset/skip (page 300)            idx_timestamp_id             IXSCAN   25        25    7500  index      7
Sort by <every column> (asc and desc)         idx_<column>_ts              IXSCAN   25        25    25    index      0
```

Reading the interesting rows:

- **Every sortable column, in both directions, is served by an index** with `Docs == Returned`.
  That is the uniform-key-direction rule paying off.
- **Full-text search is the one accepted in-memory sort.** `$text` and a `timestamp` sort cannot
  share an index — MongoDB has one text index per collection and it is not ordered by time. 518
  examined for 25 returned is fine at this scale; Atlas Search is the answer beyond it.
- **The prefix pivots examine more than they return** (232 and 367). The planner chose to walk the
  timestamp index and filter, rather than use `idx_actor_ts`, because at 10k documents with a
  low-selectivity prefix that is genuinely cheaper. It is the planner making a correct cost
  decision, not a missing index — the index is there and gets used when the prefix is selective.
- **Deep offset pages walk keys they throw away** — 7,500 to return 25. This is the number that
  justifies shipping keyset pagination alongside.

Bulk ingest: **10,000 records in one 2.53MB request in ~2.6–3.2s** (~3,100 records/sec), on
in-memory MongoDB on a laptop.

---

## Assumptions

The spec gives one sample record and leaves the rest open. Every assumption is listed here.

1. **Enum vocabularies are invented.** `role`, `action`, `resourceType`, `region`, `severity` and
   `status` are closed sets defined in `server/src/utils/constants.js`, extrapolated from the sample
   record. `status` uses mixed case (`Unresolved`) to match the sample exactly.
2. **No authentication.** The brief describes an internal tool and specifies no auth model, so there
   is none. This is a real gap, not an oversight: in production this sits behind SSO with
   role-scoped read access, and *access to the audit log would itself be audited*. I would rather
   name it than quietly ship an unauthenticated security tool.
3. **No ingest idempotency.** Re-posting the same batch stores it twice. Records carry no natural
   unique key; a real deployment would add a source-supplied `eventId` with a unique index and use
   `bulkWrite` upserts.
4. **Logs are immutable.** No update or delete endpoint exists. Amending an audit record should be
   an out-of-band, separately-audited operation, not a REST verb. (`status` is arguably workflow
   state and could justify a `PATCH`; I left it out as out of scope.)
5. **Timestamps are stored and displayed in UTC.** Input accepts ISO-8601 or epoch millis.
6. **Prefix, not substring, matching** on `actor`/`resource`/`ipAddress`, for the index reasons
   above. `resource` and `ipAddress` are case-sensitive; `actor` is not, because it is normalised.
7. **Search does not rank by relevance.** The user's chosen column sort always wins — a table whose
   ordering silently changes when you type in a search box is worse than one that does not.
8. **Caps are policy, not physics:** 20,000 records per bulk request, 25MB body, 100 rows per page.
   All are `.env`-configurable.
9. **`ingestedAt` is not sortable.** It is detail-view metadata rather than a column, and indexing
   it would cost write throughput for a sort nobody performs.
10. **In-memory MongoDB is a development convenience only** and is refused in production.

---

## What I would do next

In rough priority order, if this were going further than a take-home:

1. **Authentication and authorisation** — SSO, role-scoped reads, and audit-the-auditors.
2. **NDJSON streaming ingest** for batches beyond ~50k, plus an idempotency key.
3. **Atlas Search** to replace the text index, unlocking substring and fuzzy matching.
4. **Rate limiting** on the ingest endpoint, and structured logging (pino) shipped to the log pipeline.
5. **Time-series or sharded collections** with a retention policy — audit data is append-only and
   grows without bound; at that scale the index set above needs re-costing against real telemetry.
6. **Saved views and alerting** — an investigator who runs the same triage query every morning
   should be able to save it, and be told when it returns something new.
7. **Frontend tests** (Vitest + Testing Library). Backend tests were the higher-value place to spend
   the time here, since the query engine is where the correctness risk lives.

---

## Project layout

```
server/
  src/
    config/       env (zod-validated) and database connection
    models/       AuditLog schema + the 12 indexes, each documented
    routes/       route tables only
    controllers/  HTTP in/out — no query building, no database access
    services/     query construction, bulk insert — no req/res
    validation/   zod schemas + the validate() middleware factory
    middleware/   centralized error handler, 404
    utils/        ApiError, asyncHandler, logger, constants
  scripts/        seed.js (uploads over HTTP) · perf-check.js (explain harness) · generate.js
  tests/          bulkUpload · query · detail
client/
  src/
    api/          fetch wrapper + endpoint functions
    hooks/        useLogQuery — the URL-as-state hook
    components/   FilterPanel · LogTable · Pagination · LogDetailDrawer · states
    lib/          columns, colour maps, formatters
```

Dependencies point one way: `routes → controllers → services → models`. Services never see
`req`/`res`; controllers never build Mongo queries.
