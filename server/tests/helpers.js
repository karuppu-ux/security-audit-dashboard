import { SEVERITY_RANK } from '../src/utils/constants.js';

/** A single valid record; override any field to make it interesting or invalid. */
export function makeRecord(overrides = {}) {
  return {
    actor: 'priya.nair@company.com',
    role: 'admin',
    action: 'DELETE_USER',
    resource: '/api/users/334',
    resourceType: 'USER',
    ipAddress: '192.168.1.45',
    region: 'ap-south-1',
    severity: 'HIGH',
    status: 'Unresolved',
    timestamp: '2025-06-14T08:32:11Z',
    ...overrides,
  };
}

export function makeRecords(count, factory = () => ({})) {
  return Array.from({ length: count }, (_, index) => makeRecord(factory(index)));
}

/**
 * Insert straight through the model, bypassing the HTTP layer. Query tests care
 * about what the query engine does with data that is already there, not about
 * how it arrived.
 */
export async function seedDirect(AuditLog, records) {
  return AuditLog.insertMany(
    records.map((record) => ({
      ...record,
      timestamp: new Date(record.timestamp),
      severityRank: SEVERITY_RANK[record.severity],
    })),
    { ordered: false }
  );
}
