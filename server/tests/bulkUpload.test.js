import { describe, it, expect } from '@jest/globals';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { makeRecord, makeRecords } from './helpers.js';

const app = createApp();
const ENDPOINT = '/api/v1/logs/bulk';

describe('POST /api/v1/logs/bulk', () => {
  describe('happy path', () => {
    it('accepts and persists a large batch in a single request', async () => {
      const records = makeRecords(1000, (index) => ({
        actor: `user${index}@company.com`,
        resource: `/api/users/${index}`,
      }));

      const response = await request(app).post(ENDPOINT).send({ records });

      expect(response.status).toBe(201);
      expect(response.body.data).toMatchObject({
        received: 1000,
        valid: 1000,
        inserted: 1000,
        invalid: 0,
        failed: 0,
      });
      await expect(AuditLog.countDocuments()).resolves.toBe(1000);
    });

    it('accepts a bare array as well as a { records } envelope', async () => {
      const response = await request(app).post(ENDPOINT).send(makeRecords(3));

      expect(response.status).toBe(201);
      expect(response.body.data.inserted).toBe(3);
    });

    it('derives severityRank from severity rather than trusting the client', async () => {
      await request(app)
        .post(ENDPOINT)
        .send([makeRecord({ severity: 'CRITICAL' })])
        .expect(201);

      const stored = await AuditLog.findOne().lean();
      expect(stored.severityRank).toBe(4);
    });

    it('normalises actor casing so lookups are case-insensitive', async () => {
      await request(app)
        .post(ENDPOINT)
        .send([makeRecord({ actor: 'Priya.Nair@Company.com' })])
        .expect(201);

      const stored = await AuditLog.findOne().lean();
      expect(stored.actor).toBe('priya.nair@company.com');
    });

    it('records ingest time separately from event time', async () => {
      await request(app).post(ENDPOINT).send([makeRecord()]).expect(201);

      const stored = await AuditLog.findOne().lean();
      expect(stored.timestamp.toISOString()).toBe('2025-06-14T08:32:11.000Z');
      expect(stored.ingestedAt.getTime()).toBeGreaterThan(stored.timestamp.getTime());
    });
  });

  describe('partial failure', () => {
    it('stores the valid records and reports the rejected ones (207)', async () => {
      const records = [
        makeRecord(),
        makeRecord({ severity: 'CATASTROPHIC' }), // not in the enum
        makeRecord(),
        makeRecord({ ipAddress: '999.999.999.999' }), // not a valid IP
        makeRecord({ timestamp: 'not-a-date' }),
      ];

      const response = await request(app).post(ENDPOINT).send({ records });

      expect(response.status).toBe(207);
      expect(response.body.data).toMatchObject({
        received: 5,
        valid: 2,
        inserted: 2,
        invalid: 3,
      });
      // The whole point: one bad record must not cost us the good ones.
      await expect(AuditLog.countDocuments()).resolves.toBe(2);
    });

    it('reports the index and reason for each rejected record', async () => {
      const records = [makeRecord(), makeRecord({ role: 'wizard' })];

      const { body } = await request(app).post(ENDPOINT).send({ records }).expect(207);

      expect(body.data.errors).toHaveLength(1);
      expect(body.data.errors[0]).toMatchObject({ index: 1, reason: 'VALIDATION_ERROR' });
      expect(body.data.errors[0].issues[0].path).toBe('role');
    });

    it('reports errors by their index in the original payload, across batches', async () => {
      // BULK_BATCH_SIZE is 1000, so a bad record at 1500 exercises the offset
      // arithmetic in the second batch.
      const records = makeRecords(1600);
      records[1500] = makeRecord({ region: 'mars-north-1' });

      const { body } = await request(app).post(ENDPOINT).send({ records }).expect(207);

      expect(body.data.errors[0].index).toBe(1500);
      expect(body.data.inserted).toBe(1599);
    });

    it('caps the number of echoed errors and says so', async () => {
      const records = makeRecords(200, () => ({ severity: 'NOPE' }));
      records[0] = makeRecord(); // one valid record, so this is a 207 not a 400

      const { body } = await request(app).post(ENDPOINT).send({ records }).expect(207);

      expect(body.data.errors).toHaveLength(100);
      expect(body.data.truncatedErrors).toBe(true);
      expect(body.data.invalid).toBe(199);
    });

    it('rejects unknown fields instead of silently dropping them', async () => {
      const records = [makeRecord({ severty: 'HIGH' })];

      const { body } = await request(app).post(ENDPOINT).send({ records }).expect(400);

      expect(body.error.code).toBe('BAD_REQUEST');
    });
  });

  describe('malformed input', () => {
    it('returns 400 when no record is valid', async () => {
      const response = await request(app)
        .post(ENDPOINT)
        .send([{ nonsense: true }, { alsoNonsense: true }]);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('BAD_REQUEST');
      await expect(AuditLog.countDocuments()).resolves.toBe(0);
    });

    it('returns 400 for an empty array', async () => {
      const { body } = await request(app).post(ENDPOINT).send([]).expect(400);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 for a body that is neither an array nor { records }', async () => {
      await request(app).post(ENDPOINT).send({ logs: [makeRecord()] }).expect(400);
    });

    it('returns 400 for unparseable JSON rather than crashing', async () => {
      const { body } = await request(app)
        .post(ENDPOINT)
        .set('Content-Type', 'application/json')
        .send('{"records": [')
        .expect(400);

      expect(body.error.message).toMatch(/not valid JSON/i);
    });

    it('returns 413 when the batch exceeds MAX_BULK_RECORDS', async () => {
      // Built as raw JSON to avoid materialising 20k full objects in the test.
      const oversized = `[${Array.from({ length: 20_001 }, () => '{}').join(',')}]`;

      const { body } = await request(app)
        .post(ENDPOINT)
        .set('Content-Type', 'application/json')
        .send(oversized)
        .expect(413);

      expect(body.error.code).toBe('PAYLOAD_TOO_LARGE');
      await expect(AuditLog.countDocuments()).resolves.toBe(0);
    });
  });

  describe('scale', () => {
    // The headline requirement: 10,000 records, one HTTP request, no splitting.
    it('accepts 10,000 records in one request', async () => {
      const records = makeRecords(10_000, (index) => ({
        actor: `user${index % 200}@company.com`,
        resource: `/api/users/${index}`,
      }));

      const response = await request(app).post(ENDPOINT).send({ records });

      expect(response.status).toBe(201);
      expect(response.body.data.inserted).toBe(10_000);
      expect(response.body.data.durationMs).toEqual(expect.any(Number));
      await expect(AuditLog.countDocuments()).resolves.toBe(10_000);
    });
  });
});
