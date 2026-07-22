#!/usr/bin/env node
/**
 * Seed script — generates realistic audit logs and uploads them through the
 * real HTTP API, so bulk ingest and server-side query performance are actually
 * exercised end to end rather than asserted in a README.
 *
 * Usage:
 *   node scripts/seed.js                        # 10,000 records → http://localhost:4000
 *   node scripts/seed.js --count 50000
 *   node scripts/seed.js --api https://api.example.com
 *   node scripts/seed.js --chunk 10000          # records per HTTP request
 *   node scripts/seed.js --clear                # drop existing logs first
 *
 * The default sends all 10,000 records in a single request, which is the
 * requirement being demonstrated. `--chunk` exists to show the endpoint behaves
 * sanely when a client does split the work.
 *
 * `--clear` talks to MongoDB directly rather than through the API: the API
 * deliberately exposes no destructive endpoint, because an internal audit store
 * should not offer "delete everything" over HTTP.
 */
import { generateRecords } from './generate.js';

function parseArgs(argv) {
  const args = { count: 10_000, api: 'http://localhost:4000', chunk: null, clear: false };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--clear') args.clear = true;
    else if (flag === '--count') args.count = Number(argv[(i += 1)]);
    else if (flag === '--chunk') args.chunk = Number(argv[(i += 1)]);
    else if (flag === '--api') args.api = String(argv[(i += 1)]).replace(/\/$/, '');
    else if (flag === '--help' || flag === '-h') {
      console.log('Usage: node scripts/seed.js [--count N] [--chunk N] [--api URL] [--clear]');
      process.exit(0);
    } else throw new Error(`Unknown argument: ${flag}`);
  }

  if (!Number.isInteger(args.count) || args.count < 1) {
    throw new Error('--count must be a positive integer');
  }
  if (args.chunk !== null && (!Number.isInteger(args.chunk) || args.chunk < 1)) {
    throw new Error('--chunk must be a positive integer');
  }
  args.chunk ??= args.count;
  return args;
}

async function upload(apiBase, records) {
  const response = await fetch(`${apiBase}/api/v1/logs/bulk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ records }),
  });

  const payload = await response.json().catch(() => ({}));

  // 207 is a documented success-with-rejections outcome, not a failure.
  if (!response.ok && response.status !== 207) {
    throw new Error(
      `Upload failed (${response.status}): ${payload?.error?.message ?? 'unknown error'}`
    );
  }
  return { status: response.status, ...payload.data };
}

async function clearExisting() {
  const [{ connectDatabase, disconnectDatabase }, { AuditLog }] = await Promise.all([
    import('../src/config/db.js'),
    import('../src/models/AuditLog.js'),
  ]);
  await connectDatabase();
  const { deletedCount } = await AuditLog.deleteMany({});
  await disconnectDatabase();
  console.log(`Cleared ${deletedCount.toLocaleString()} existing records`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.clear) {
    if (!process.env.MONGODB_URI) {
      // An in-memory database has nothing to clear, and connecting would start
      // a *second*, unrelated instance — misleading rather than harmful.
      console.warn('MONGODB_URI is not set; skipping --clear (in-memory DB starts empty).');
    } else {
      await clearExisting();
    }
  }

  console.log(`Generating ${args.count.toLocaleString()} audit log records...`);
  const generateStart = Date.now();
  const records = generateRecords(args.count);
  console.log(`Generated in ${Date.now() - generateStart}ms`);

  const totals = { inserted: 0, failed: 0, invalid: 0 };
  const uploadStart = Date.now();

  for (let offset = 0; offset < records.length; offset += args.chunk) {
    const chunk = records.slice(offset, offset + args.chunk);
    const bytes = Buffer.byteLength(JSON.stringify({ records: chunk }));
    const requestStart = Date.now();

    const result = await upload(args.api, chunk);
    const elapsed = Date.now() - requestStart;

    totals.inserted += result.inserted ?? 0;
    totals.failed += result.failed ?? 0;
    totals.invalid += result.invalid ?? 0;

    console.log(
      `  POST /api/v1/logs/bulk → ${result.status} | ${chunk.length.toLocaleString()} records | ` +
        `${(bytes / 1024 / 1024).toFixed(2)}MB | ${elapsed}ms | inserted ${result.inserted}`
    );
  }

  const totalMs = Date.now() - uploadStart;
  console.log('\nSeed complete');
  console.log(`  inserted : ${totals.inserted.toLocaleString()}`);
  console.log(`  invalid  : ${totals.invalid.toLocaleString()}`);
  console.log(`  failed   : ${totals.failed.toLocaleString()}`);
  console.log(
    `  duration : ${totalMs}ms (${Math.round(totals.inserted / (totalMs / 1000)).toLocaleString()} records/sec)`
  );

  if (totals.inserted !== args.count) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`\nSeed failed: ${error.message}`);
  console.error('Is the API running? Start it with `npm run dev` in another terminal.');
  process.exit(1);
});
