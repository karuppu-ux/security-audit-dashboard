#!/usr/bin/env node
/**
 * Index verification harness.
 *
 * Runs the queries the dashboard actually issues through `explain('executionStats')`
 * and reports, for each: which index was chosen, how many documents MongoDB had
 * to examine to return the page, and how long it took.
 *
 * The number that matters is **docsExamined vs nReturned**. If they are close,
 * the index is doing the work. If docsExamined is the size of the collection,
 * the query is a collection scan wearing a filter — which is exactly the
 * failure this project is meant to avoid.
 *
 * Usage:
 *   node scripts/perf-check.js                     # against MONGODB_URI (or a fresh in-memory DB)
 *   node scripts/perf-check.js --seed 10000        # seed first, then measure
 */
import { connectDatabase, disconnectDatabase } from '../src/config/db.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { buildFilter, buildSort } from '../src/services/auditLog.service.js';
import { DEFAULT_PAGE_SIZE, SORTABLE_FIELDS } from '../src/utils/constants.js';

/** The queries below mirror real dashboard interactions, not synthetic benchmarks. */
const SCENARIOS = [
  {
    name: 'Default view (newest first, no filters)',
    query: { sort: 'timestamp', order: 'desc', page: 1, limit: DEFAULT_PAGE_SIZE },
  },
  {
    name: 'Triage: unresolved CRITICAL, newest first',
    query: {
      severity: ['CRITICAL'],
      status: ['Unresolved'],
      sort: 'timestamp',
      order: 'desc',
      page: 1,
      limit: DEFAULT_PAGE_SIZE,
    },
  },
  {
    name: 'Multi-value enum filter (HIGH + CRITICAL)',
    query: {
      severity: ['HIGH', 'CRITICAL'],
      sort: 'timestamp',
      order: 'desc',
      page: 1,
      limit: DEFAULT_PAGE_SIZE,
    },
  },
  {
    name: 'Pivot: single actor prefix',
    query: { actor: 'svc.', sort: 'timestamp', order: 'desc', page: 1, limit: DEFAULT_PAGE_SIZE },
  },
  {
    name: 'Pivot: single IP prefix',
    query: {
      ipAddress: '192.168.1.',
      sort: 'timestamp',
      order: 'desc',
      page: 1,
      limit: DEFAULT_PAGE_SIZE,
    },
  },
  {
    name: 'Blast radius: resourceType + severity',
    query: {
      resourceType: ['USER'],
      severity: ['HIGH'],
      sort: 'timestamp',
      order: 'desc',
      page: 1,
      limit: DEFAULT_PAGE_SIZE,
    },
  },
  {
    name: 'Date range (30-day window)',
    query: {
      from: new Date('2025-07-01T00:00:00Z'),
      to: new Date('2025-07-31T23:59:59Z'),
      sort: 'timestamp',
      order: 'desc',
      page: 1,
      limit: DEFAULT_PAGE_SIZE,
    },
  },
  {
    name: 'Full-text search (q=DELETE_USER)',
    query: { q: 'DELETE_USER', sort: 'timestamp', order: 'desc', page: 1, limit: DEFAULT_PAGE_SIZE },
  },
  {
    name: 'Deep page — offset/skip (page 300)',
    query: { sort: 'timestamp', order: 'desc', page: 300, limit: DEFAULT_PAGE_SIZE },
  },
  // Every sortable column, both directions. The spec requires "sorting by any
  // column", so every one of them has to be index-backed — including the
  // descending direction, which is where a mixed-direction index silently fails.
  ...SORTABLE_FIELDS.flatMap((field) =>
    ['asc', 'desc'].map((order) => ({
      name: `Sort by ${field} (${order})`,
      query: { sort: field, order, page: 1, limit: DEFAULT_PAGE_SIZE },
    }))
  ),
];

/** Walk the winning plan tree and report the stages that matter. */
function summarizePlan(stage, acc = { stages: [], indexName: null }) {
  if (!stage) return acc;
  acc.stages.push(stage.stage);
  if (stage.indexName) acc.indexName = stage.indexName;
  if (stage.inputStage) summarizePlan(stage.inputStage, acc);
  (stage.inputStages ?? []).forEach((child) => summarizePlan(child, acc));
  return acc;
}

async function explain(scenario) {
  const filter = buildFilter(scenario.query);
  const sort = buildSort(scenario.query);
  const skip = ((scenario.query.page ?? 1) - 1) * scenario.query.limit;

  const result = await AuditLog.find(filter)
    .sort(sort)
    .skip(skip)
    .limit(scenario.query.limit)
    .explain('executionStats');

  const stats = result.executionStats;
  const plan = summarizePlan(stats.executionStages);

  return {
    name: scenario.name,
    index: plan.indexName ?? '(none)',
    scan: plan.stages.includes('COLLSCAN') ? 'COLLSCAN' : 'IXSCAN',
    inMemorySort: plan.stages.includes('SORT'),
    nReturned: stats.nReturned,
    docsExamined: stats.totalDocsExamined,
    keysExamined: stats.totalKeysExamined,
    millis: stats.executionTimeMillis,
  };
}

async function main() {
  const seedIndex = process.argv.indexOf('--seed');
  await connectDatabase();

  if (seedIndex !== -1) {
    const count = Number(process.argv[seedIndex + 1] ?? 10_000);
    console.log(`Seeding ${count.toLocaleString()} records directly into MongoDB...`);
    const { generateRecords } = await import('./generate.js');
    await AuditLog.deleteMany({});
    const records = generateRecords(count);
    for (let i = 0; i < records.length; i += 1000) {
      await AuditLog.insertMany(records.slice(i, i + 1000), { ordered: false });
    }
  }

  const total = await AuditLog.estimatedDocumentCount();
  console.log(`\nCollection size: ${total.toLocaleString()} documents\n`);

  if (total === 0) {
    console.warn('No documents found. Run `npm run seed` first (with the API running).');
    await disconnectDatabase();
    process.exitCode = 1;
    return;
  }

  const rows = [];
  for (const scenario of SCENARIOS) {
    rows.push(await explain(scenario));
  }

  const pad = (value, width) => String(value).padEnd(width);
  const header =
    pad('Scenario', 46) +
    pad('Index', 32) +
    pad('Scan', 10) +
    pad('Returned', 10) +
    pad('Docs', 8) +
    pad('Keys', 8) +
    pad('Sort', 11) +
    'ms';
  console.log(header);
  console.log('-'.repeat(header.length));

  for (const row of rows) {
    console.log(
      pad(row.name, 46) +
        pad(row.index, 32) +
        pad(row.scan, 10) +
        pad(row.nReturned, 10) +
        pad(row.docsExamined, 8) +
        pad(row.keysExamined, 8) +
        pad(row.inMemorySort ? 'in-memory' : 'index', 11) +
        row.millis
    );
  }

  // Keyset vs offset on a deep page — the tradeoff called out in the README.
  // The cost of `skip` shows up in *index keys* walked and discarded, not in
  // documents fetched, which is why the Keys column matters more than Docs here.
  const deep = rows.find((row) => row.name.startsWith('Deep page'));
  if (deep) {
    console.log(
      `\nDeep-page note: page 300 walked ${deep.keysExamined.toLocaleString()} index keys to return ` +
        `${deep.nReturned} documents — every skipped key is read and discarded, so the cost grows ` +
        `linearly with page depth. Keyset pagination (?cursor=) walks ~${deep.nReturned} keys at any depth.`
    );
  }

  // A collection scan is a hard failure. An in-memory SORT is a soft one — it
  // means an index is serving the filter but not the ordering, which is fine at
  // 10k rows and a latent problem at 10M. Text search is the one accepted
  // exception: `$text` and a timestamp sort cannot share an index.
  const scans = rows.filter((row) => row.scan === 'COLLSCAN');
  const sorts = rows.filter((row) => row.inMemorySort && !row.name.startsWith('Full-text'));

  if (scans.length) {
    console.warn(`\nFAIL — ${scans.length} scenario(s) fell back to a collection scan:`);
    scans.forEach((row) => console.warn(`  - ${row.name}`));
  }
  if (sorts.length) {
    console.warn(`\nWARN — ${sorts.length} scenario(s) sorted in memory:`);
    sorts.forEach((row) => console.warn(`  - ${row.name}`));
  }
  if (!scans.length && !sorts.length) {
    console.log('\nAll scenarios served by an index, with the ordering satisfied by the index.');
  }
  if (scans.length || sorts.length) process.exitCode = 1;

  await disconnectDatabase();
}

main().catch(async (error) => {
  console.error('perf-check failed:', error);
  await disconnectDatabase().catch(() => {});
  process.exit(1);
});
