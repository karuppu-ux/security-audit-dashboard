import { beforeAll, afterAll, afterEach } from '@jest/globals';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

/**
 * Tests run against a real MongoDB instance, not a mock. Index selection,
 * `$text` search, `ordered: false` partial writes and collation are exactly the
 * behaviours this project depends on — a stubbed model would verify nothing
 * about any of them.
 *
 * One server for the whole run (starting mongod per file is slow); the
 * collection is emptied between tests so each one owns its own data.
 */
let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create({ instance: { dbName: 'audit_logs_test' } });
  await mongoose.connect(mongoServer.getUri(), { dbName: 'audit_logs_test' });

  const { AuditLog } = await import('../src/models/AuditLog.js');
  await AuditLog.syncIndexes();
});

afterEach(async () => {
  // deleteMany rather than dropping the collection: dropping would take the
  // indexes with it, and several tests assert on index-backed behaviour.
  const { AuditLog } = await import('../src/models/AuditLog.js');
  await AuditLog.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer?.stop();
});
