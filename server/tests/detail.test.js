import { describe, it, expect } from '@jest/globals';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { makeRecord, seedDirect } from './helpers.js';

const app = createApp();

describe('GET /api/v1/logs/:id', () => {
  it('returns the full record for the detail view', async () => {
    const [inserted] = await seedDirect(AuditLog, [makeRecord()]);

    const { body } = await request(app).get(`/api/v1/logs/${inserted._id}`).expect(200);

    expect(body.data).toMatchObject({
      id: inserted._id.toString(),
      actor: 'priya.nair@company.com',
      action: 'DELETE_USER',
      resource: '/api/users/334',
      severity: 'HIGH',
      status: 'Unresolved',
    });
    expect(body.data.ingestedAt).toBeDefined();
  });

  it('returns 404 for a well-formed id that does not exist', async () => {
    const { body } = await request(app)
      .get('/api/v1/logs/64b7f3c2e1a2b3c4d5e6f7a8')
      .expect(404);

    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('returns 400 — not 500 — for a malformed id', async () => {
    const { body } = await request(app).get('/api/v1/logs/not-an-object-id').expect(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/v1/logs/meta/enums', () => {
  it('serves the filter vocabularies the UI needs', async () => {
    const { body } = await request(app).get('/api/v1/logs/meta/enums').expect(200);

    expect(body.data.enums.severity).toEqual(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
    expect(body.data.enums.status).toContain('Unresolved');
    expect(body.data.sortableFields).toContain('timestamp');
    expect(body.data.pageSizeOptions).toEqual([25, 50, 100]);
  });

  it('is not shadowed by the :id route', async () => {
    // '/meta/enums' must be matched before '/:id', or "meta" is parsed as an id.
    await request(app).get('/api/v1/logs/meta/enums').expect(200);
  });

  it('reports the collection size and time span', async () => {
    await seedDirect(AuditLog, [
      makeRecord({ timestamp: '2025-06-01T00:00:00Z' }),
      makeRecord({ timestamp: '2025-06-30T00:00:00Z' }),
    ]);

    const { body } = await request(app).get('/api/v1/logs/meta/enums').expect(200);

    expect(body.data.totalRecords).toBe(2);
    expect(body.data.timestampRange.earliest).toBe('2025-06-01T00:00:00.000Z');
    expect(body.data.timestampRange.latest).toBe('2025-06-30T00:00:00.000Z');
  });
});

describe('error handling', () => {
  it('returns a consistent error envelope for an unknown route', async () => {
    const { body } = await request(app).get('/api/v1/nope').expect(404);

    expect(body.error).toMatchObject({ code: 'NOT_FOUND' });
    expect(body.error.message).toMatch(/does not exist/);
  });

  it('reports health, including database state', async () => {
    const { body } = await request(app).get('/health').expect(200);
    expect(body.data).toMatchObject({ status: 'ok', database: 'connected' });
  });
});
