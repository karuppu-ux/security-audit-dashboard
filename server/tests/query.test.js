import { describe, it, expect, beforeEach } from '@jest/globals';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { makeRecord, seedDirect } from './helpers.js';

const app = createApp();
const ENDPOINT = '/api/v1/logs';

/**
 * A small, hand-built fixture rather than random data: every assertion below
 * can be checked by eye against this table, which is what makes a failure
 * diagnosable instead of just red.
 */
const FIXTURE = [
  makeRecord({
    actor: 'alice@company.com', role: 'admin', action: 'DELETE_USER',
    resource: '/api/users/1', resourceType: 'USER', ipAddress: '192.168.1.10',
    region: 'ap-south-1', severity: 'CRITICAL', status: 'Unresolved',
    timestamp: '2025-06-01T00:00:00Z',
  }),
  makeRecord({
    actor: 'bob@company.com', role: 'user', action: 'LOGIN',
    resource: '/auth/session/abc', resourceType: 'SESSION', ipAddress: '192.168.1.11',
    region: 'us-east-1', severity: 'LOW', status: 'Resolved',
    timestamp: '2025-06-02T00:00:00Z',
  }),
  makeRecord({
    actor: 'carol@company.com', role: 'auditor', action: 'EXPORT_DATA',
    resource: '/db/payments', resourceType: 'DATABASE', ipAddress: '10.0.0.5',
    region: 'eu-west-1', severity: 'HIGH', status: 'Investigating',
    timestamp: '2025-06-03T00:00:00Z',
  }),
  makeRecord({
    actor: 'alice@company.com', role: 'admin', action: 'GRANT_ROLE',
    resource: '/api/roles/admin', resourceType: 'ROLE', ipAddress: '192.168.1.10',
    region: 'ap-south-1', severity: 'MEDIUM', status: 'Unresolved',
    timestamp: '2025-06-04T00:00:00Z',
  }),
  makeRecord({
    actor: 'dave@company.com', role: 'service', action: 'DOWNLOAD_FILE',
    resource: '/files/report.pdf', resourceType: 'FILE', ipAddress: '10.0.0.6',
    region: 'us-east-1', severity: 'LOW', status: 'False Positive',
    timestamp: '2025-06-05T00:00:00Z',
  }),
];

const actorsOf = (body) => body.data.map((log) => log.actor);

beforeEach(async () => {
  await seedDirect(AuditLog, FIXTURE);
});

describe('GET /api/v1/logs — response shape', () => {
  it('returns items plus pagination metadata, newest first by default', async () => {
    const { body } = await request(app).get(ENDPOINT).expect(200);

    expect(body.data).toHaveLength(5);
    expect(body.meta).toMatchObject({
      page: 1, limit: 25, total: 5, totalPages: 1,
      hasPreviousPage: false, hasNextPage: false,
      sort: 'timestamp', order: 'desc', mode: 'offset',
    });
    expect(actorsOf(body)).toEqual([
      'dave@company.com', 'alice@company.com', 'carol@company.com',
      'bob@company.com', 'alice@company.com',
    ]);
  });

  it('exposes `id` and hides internal fields', async () => {
    const { body } = await request(app).get(ENDPOINT).expect(200);

    expect(body.data[0].id).toMatch(/^[a-f\d]{24}$/);
    expect(body.data[0]).not.toHaveProperty('_id');
    // severityRank is an internal sort key, not part of the API contract.
    expect(body.data[0]).not.toHaveProperty('severityRank');
    expect(body.data[0].severity).toBeDefined();
  });

  it('returns an empty array — not an error — when nothing matches', async () => {
    const { body } = await request(app).get(`${ENDPOINT}?actor=nobody`).expect(200);

    expect(body.data).toEqual([]);
    expect(body.meta).toMatchObject({ total: 0, totalPages: 1, hasNextPage: false });
  });
});

describe('GET /api/v1/logs — filtering', () => {
  it.each([
    ['role', 'role=admin', 2],
    ['action', 'action=LOGIN', 1],
    ['resourceType', 'resourceType=DATABASE', 1],
    ['region', 'region=us-east-1', 2],
    ['severity', 'severity=LOW', 2],
    ['status', 'status=Unresolved', 2],
  ])('filters by %s', async (_field, queryString, expected) => {
    const { body } = await request(app).get(`${ENDPOINT}?${queryString}`).expect(200);
    expect(body.data).toHaveLength(expected);
    expect(body.meta.total).toBe(expected);
  });

  it('accepts repeated params for a multi-value enum filter', async () => {
    const { body } = await request(app)
      .get(`${ENDPOINT}?severity=HIGH&severity=CRITICAL`)
      .expect(200);

    expect(body.meta.total).toBe(2);
  });

  it('accepts a comma-separated list for the same filter', async () => {
    const { body } = await request(app).get(`${ENDPOINT}?severity=HIGH,CRITICAL`).expect(200);
    expect(body.meta.total).toBe(2);
  });

  it('combines filters with AND, not OR', async () => {
    const { body } = await request(app)
      .get(`${ENDPOINT}?role=admin&status=Unresolved&region=ap-south-1`)
      .expect(200);

    expect(body.meta.total).toBe(2);
    expect(actorsOf(body).every((actor) => actor === 'alice@company.com')).toBe(true);
  });

  it('matches actor as a case-insensitive prefix', async () => {
    const { body } = await request(app).get(`${ENDPOINT}?actor=ALI`).expect(200);
    expect(body.meta.total).toBe(2);
  });

  it('matches ipAddress as a prefix, so a subnet can be swept', async () => {
    const { body } = await request(app).get(`${ENDPOINT}?ipAddress=192.168.1.`).expect(200);
    expect(body.meta.total).toBe(3);
  });

  it('matches resource as a path prefix', async () => {
    const { body } = await request(app).get(`${ENDPOINT}?resource=/api/`).expect(200);
    expect(body.meta.total).toBe(2);
  });

  it('treats regex metacharacters in a filter as literal text', async () => {
    // Without escaping, '.' would match any character and this would return 3.
    const { body } = await request(app).get(`${ENDPOINT}?ipAddress=192.168.1.1.`).expect(200);
    expect(body.meta.total).toBe(0);
  });

  it('anchors prefix filters rather than matching anywhere', async () => {
    // 'company.com' is a suffix of every actor; an unanchored match would
    // return all five and would also be a collection scan.
    const { body } = await request(app).get(`${ENDPOINT}?actor=company.com`).expect(200);
    expect(body.meta.total).toBe(0);
  });

  it('filters by an inclusive timestamp range', async () => {
    const { body } = await request(app)
      .get(`${ENDPOINT}?from=2025-06-02T00:00:00Z&to=2025-06-04T00:00:00Z`)
      .expect(200);

    expect(body.meta.total).toBe(3);
  });

  it('supports an open-ended range', async () => {
    const { body } = await request(app).get(`${ENDPOINT}?from=2025-06-04T00:00:00Z`).expect(200);
    expect(body.meta.total).toBe(2);
  });
});

describe('GET /api/v1/logs — search', () => {
  it('finds records by action term', async () => {
    const { body } = await request(app).get(`${ENDPOINT}?q=EXPORT_DATA`).expect(200);
    expect(actorsOf(body)).toEqual(['carol@company.com']);
  });

  it('finds records by a token inside the actor address', async () => {
    const { body } = await request(app).get(`${ENDPOINT}?q=carol`).expect(200);
    expect(body.meta.total).toBe(1);
  });

  it('finds records by a token inside the resource path', async () => {
    const { body } = await request(app).get(`${ENDPOINT}?q=payments`).expect(200);
    expect(body.meta.total).toBe(1);
  });

  it('combines search with filters', async () => {
    const { body } = await request(app).get(`${ENDPOINT}?q=alice&severity=CRITICAL`).expect(200);
    expect(body.meta.total).toBe(1);
  });

  it('returns an empty result for a term that matches nothing', async () => {
    const { body } = await request(app).get(`${ENDPOINT}?q=zzzznomatch`).expect(200);
    expect(body.data).toEqual([]);
  });
});

describe('GET /api/v1/logs — sorting', () => {
  it('sorts by a text column ascending and descending', async () => {
    const asc = await request(app).get(`${ENDPOINT}?sort=actor&order=asc`).expect(200);
    expect(actorsOf(asc.body)[0]).toBe('alice@company.com');

    const desc = await request(app).get(`${ENDPOINT}?sort=actor&order=desc`).expect(200);
    expect(actorsOf(desc.body)[0]).toBe('dave@company.com');
  });

  it('sorts severity by risk, not alphabetically', async () => {
    const { body } = await request(app).get(`${ENDPOINT}?sort=severity&order=desc`).expect(200);

    // Alphabetical order would put CRITICAL first only by accident and would
    // then give HIGH, LOW, MEDIUM. Risk order is CRITICAL, HIGH, MEDIUM, LOW.
    expect(body.data.map((log) => log.severity)).toEqual([
      'CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'LOW',
    ]);
  });

  it('sorts severity ascending by risk too', async () => {
    const { body } = await request(app).get(`${ENDPOINT}?sort=severity&order=asc`).expect(200);
    expect(body.data.map((log) => log.severity).slice(-1)).toEqual(['CRITICAL']);
  });

  it('rejects an unknown sort field instead of silently ignoring it', async () => {
    const { body } = await request(app).get(`${ENDPOINT}?sort=password`).expect(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an unknown sort direction', async () => {
    await request(app).get(`${ENDPOINT}?sort=actor&order=sideways`).expect(400);
  });
});

describe('GET /api/v1/logs — pagination', () => {
  it('returns the requested page and reports the totals', async () => {
    const { body } = await request(app).get(`${ENDPOINT}?limit=2&page=2`).expect(200);

    expect(body.data).toHaveLength(2);
    expect(body.meta).toMatchObject({
      page: 2, limit: 2, total: 5, totalPages: 3,
      hasPreviousPage: true, hasNextPage: true,
    });
  });

  it('returns the remainder on the final page', async () => {
    const { body } = await request(app).get(`${ENDPOINT}?limit=2&page=3`).expect(200);

    expect(body.data).toHaveLength(1);
    expect(body.meta.hasNextPage).toBe(false);
  });

  it('returns an empty page past the end rather than an error', async () => {
    const { body } = await request(app).get(`${ENDPOINT}?limit=2&page=99`).expect(200);

    expect(body.data).toEqual([]);
    expect(body.meta.total).toBe(5);
  });

  it('paginates without repeating or dropping records', async () => {
    const pageOne = await request(app).get(`${ENDPOINT}?limit=3&page=1`).expect(200);
    const pageTwo = await request(app).get(`${ENDPOINT}?limit=3&page=2`).expect(200);

    const ids = [...pageOne.body.data, ...pageTwo.body.data].map((log) => log.id);
    expect(new Set(ids).size).toBe(5);
  });

  it('paginates deterministically when every record shares a timestamp', async () => {
    // The tiebreaker's whole purpose. Without `_id` in the sort, these pages
    // can overlap.
    await AuditLog.deleteMany({});
    await seedDirect(
      AuditLog,
      Array.from({ length: 10 }, (_, index) =>
        makeRecord({ actor: `dup${index}@company.com`, timestamp: '2025-06-10T00:00:00Z' })
      )
    );

    const pageOne = await request(app).get(`${ENDPOINT}?limit=5&page=1`).expect(200);
    const pageTwo = await request(app).get(`${ENDPOINT}?limit=5&page=2`).expect(200);
    const ids = [...pageOne.body.data, ...pageTwo.body.data].map((log) => log.id);

    expect(new Set(ids).size).toBe(10);
  });

  it('rejects a page size above the server maximum', async () => {
    await request(app).get(`${ENDPOINT}?limit=5000`).expect(400);
  });

  it('rejects a non-positive page number', async () => {
    await request(app).get(`${ENDPOINT}?page=0`).expect(400);
  });
});

describe('GET /api/v1/logs — keyset pagination', () => {
  it('walks the whole collection via cursors without repeats', async () => {
    const seen = [];
    let cursor = null;

    for (let page = 0; page < 5; page += 1) {
      const url = cursor ? `${ENDPOINT}?limit=2&cursor=${cursor}` : `${ENDPOINT}?limit=2`;
      const { body } = await request(app).get(url).expect(200);
      seen.push(...body.data.map((log) => log.id));
      cursor = body.meta.nextCursor;
      if (!cursor) break;
    }

    expect(new Set(seen).size).toBe(5);
  });

  it('omits a total count, because counting defeats the point', async () => {
    const first = await request(app).get(`${ENDPOINT}?limit=2`).expect(200);
    const { body } = await request(app)
      .get(`${ENDPOINT}?limit=2&cursor=${first.body.meta.nextCursor}`)
      .expect(200);

    expect(body.meta.mode).toBe('cursor');
    expect(body.meta.total).toBeNull();
  });

  it('applies filters alongside the cursor', async () => {
    const first = await request(app).get(`${ENDPOINT}?limit=1&role=admin`).expect(200);
    const { body } = await request(app)
      .get(`${ENDPOINT}?limit=5&role=admin&cursor=${first.body.meta.nextCursor}`)
      .expect(200);

    expect(body.data).toHaveLength(1);
    expect(body.data[0].role).toBe('admin');
  });

  it('rejects a malformed cursor', async () => {
    const { body } = await request(app).get(`${ENDPOINT}?cursor=notbase64`).expect(400);
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  it('rejects a cursor combined with a page number', async () => {
    await request(app).get(`${ENDPOINT}?cursor=abc&page=2`).expect(400);
  });

  it('rejects a cursor on a sort it cannot correctly serve', async () => {
    const first = await request(app).get(`${ENDPOINT}?limit=1`).expect(200);
    await request(app)
      .get(`${ENDPOINT}?sort=actor&cursor=${first.body.meta.nextCursor}`)
      .expect(400);
  });
});

describe('GET /api/v1/logs — input rejection', () => {
  it('rejects an unknown query parameter rather than ignoring it', async () => {
    // A filter that silently does nothing is a security-tool bug: the operator
    // believes they narrowed the result set when they did not.
    const { body } = await request(app).get(`${ENDPOINT}?sevrity=HIGH`).expect(400);
    expect(body.error.details[0].message).toMatch(/unknown query parameter/i);
  });

  it('rejects an invalid enum value', async () => {
    await request(app).get(`${ENDPOINT}?severity=SPICY`).expect(400);
  });

  it('rejects an unparseable date', async () => {
    await request(app).get(`${ENDPOINT}?from=yesterday`).expect(400);
  });

  it('rejects a reversed date range', async () => {
    await request(app)
      .get(`${ENDPOINT}?from=2025-06-10T00:00:00Z&to=2025-06-01T00:00:00Z`)
      .expect(400);
  });
});
