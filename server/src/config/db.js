import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

let memoryServer = null;

/**
 * Resolve the connection string. When MONGODB_URI is unset we boot an
 * in-process MongoDB via mongodb-memory-server so the project runs on a clean
 * machine with no database installed. mongodb-memory-server is a
 * devDependency, so this branch is only ever reachable outside production —
 * where MONGODB_URI is required.
 */
async function resolveUri() {
  if (env.MONGODB_URI) return env.MONGODB_URI;

  if (env.isProduction) {
    throw new Error('MONGODB_URI is required when NODE_ENV=production');
  }

  logger.warn('MONGODB_URI not set — starting an in-memory MongoDB (data is not persisted)');
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  memoryServer = await MongoMemoryServer.create({ instance: { dbName: env.MONGODB_DB_NAME } });
  return memoryServer.getUri();
}

export async function connectDatabase() {
  if (mongoose.connection.readyState === 1) return mongoose.connection;

  const uri = await resolveUri();

  mongoose.set('strictQuery', true);
  // Fail fast instead of buffering operations for 10s behind a dead connection.
  mongoose.set('bufferCommands', false);

  await mongoose.connect(uri, {
    dbName: env.MONGODB_DB_NAME,
    serverSelectionTimeoutMS: 10_000,
    // The API is read-heavy with bursty bulk writes; a small pool is plenty and
    // keeps us well inside Atlas free-tier connection limits.
    maxPoolSize: 20,
    minPoolSize: 2,
  });

  // Index builds are explicit rather than implicit-per-model so that a slow
  // build surfaces here at boot instead of stalling the first query.
  const { AuditLog } = await import('../models/AuditLog.js');
  await AuditLog.syncIndexes();

  logger.info(`MongoDB connected (db: ${mongoose.connection.name})`);
  return mongoose.connection;
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
  }
}

export function databaseState() {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  return states[mongoose.connection.readyState] ?? 'unknown';
}
