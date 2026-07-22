/**
 * Fake audit log generation, shared by `seed.js` (uploads over HTTP) and
 * `perf-check.js` (writes directly, to measure index behaviour).
 *
 * Realistic data matters for a search/filter demo. Uniform random values make
 * every filter return ~1/N of the collection, which hides both good and bad
 * index behaviour. So: a fixed cast of actors (real logs are dominated by a few
 * busy accounts), actions correlated with resource types and resource paths,
 * severity correlated with action, and status correlated with severity.
 */
import { faker } from '@faker-js/faker';
import { ACTIONS, SEVERITIES } from '../src/utils/constants.js';

// Deterministic output — the same seed produces the same data set, so a
// performance number from one run is comparable with the next.
faker.seed(20250614);

const ACTORS = Array.from({ length: 200 }, () => {
  const name = `${faker.person.firstName()}.${faker.person.lastName()}`
    .toLowerCase()
    .replace(/[^a-z.]/g, '');
  return `${name}@company.com`;
});

// A handful of service accounts generate a disproportionate share of traffic.
const SERVICE_ACCOUNTS = [
  'svc.backup@company.com',
  'svc.sync@company.com',
  'svc.scanner@company.com',
];

/** action → the resource types it can plausibly touch, and its baseline risk. */
const ACTION_PROFILE = {
  LOGIN: { types: ['SESSION'], risk: 'LOW' },
  LOGOUT: { types: ['SESSION'], risk: 'LOW' },
  LOGIN_FAILED: { types: ['SESSION'], risk: 'MEDIUM' },
  READ_RECORD: { types: ['DATABASE', 'FILE'], risk: 'LOW' },
  UPDATE_RECORD: { types: ['DATABASE'], risk: 'MEDIUM' },
  DELETE_RECORD: { types: ['DATABASE'], risk: 'HIGH' },
  CREATE_USER: { types: ['USER'], risk: 'MEDIUM' },
  UPDATE_USER: { types: ['USER'], risk: 'MEDIUM' },
  DELETE_USER: { types: ['USER'], risk: 'HIGH' },
  GRANT_ROLE: { types: ['ROLE'], risk: 'HIGH' },
  REVOKE_ROLE: { types: ['ROLE'], risk: 'MEDIUM' },
  EXPORT_DATA: { types: ['DATABASE', 'FILE'], risk: 'HIGH' },
  DOWNLOAD_FILE: { types: ['FILE'], risk: 'LOW' },
  UPLOAD_FILE: { types: ['FILE'], risk: 'MEDIUM' },
  ROTATE_KEY: { types: ['API_KEY'], risk: 'MEDIUM' },
  CREATE_API_KEY: { types: ['API_KEY'], risk: 'HIGH' },
  REVOKE_API_KEY: { types: ['API_KEY'], risk: 'MEDIUM' },
  UPDATE_CONFIG: { types: ['CONFIG'], risk: 'HIGH' },
  DISABLE_MFA: { types: ['USER', 'CONFIG'], risk: 'CRITICAL' },
  PASSWORD_RESET: { types: ['USER'], risk: 'MEDIUM' },
};

const RESOURCE_PATH = {
  USER: () => `/api/users/${faker.number.int({ min: 100, max: 9999 })}`,
  ROLE: () => `/api/roles/${faker.helpers.arrayElement(['admin', 'editor', 'viewer', 'billing'])}`,
  FILE: () => `/files/${faker.system.fileName()}`,
  DATABASE: () =>
    `/db/${faker.helpers.arrayElement(['customers', 'payments', 'employees', 'audit'])}`,
  API_KEY: () => `/api/keys/${faker.string.alphanumeric(12)}`,
  CONFIG: () =>
    `/config/${faker.helpers.arrayElement(['auth', 'network', 'retention', 'sso', 'mfa'])}`,
  SESSION: () => `/auth/session/${faker.string.uuid()}`,
};

/** Nudge severity around the action's baseline so distributions aren't flat. */
function pickSeverity(baseline) {
  const index = SEVERITIES.indexOf(baseline);
  const shift = faker.helpers.weightedArrayElement([
    { value: -1, weight: 25 },
    { value: 0, weight: 60 },
    { value: 1, weight: 15 },
  ]);
  return SEVERITIES[Math.min(SEVERITIES.length - 1, Math.max(0, index + shift))];
}

/** Serious findings stay open far more often than routine ones. */
const STATUS_WEIGHTS = {
  LOW: [
    { value: 'Resolved', weight: 70 },
    { value: 'Unresolved', weight: 15 },
    { value: 'False Positive', weight: 15 },
  ],
  MEDIUM: [
    { value: 'Resolved', weight: 50 },
    { value: 'Unresolved', weight: 25 },
    { value: 'Investigating', weight: 15 },
    { value: 'False Positive', weight: 10 },
  ],
  HIGH: [
    { value: 'Unresolved', weight: 40 },
    { value: 'Investigating', weight: 30 },
    { value: 'Resolved', weight: 25 },
    { value: 'False Positive', weight: 5 },
  ],
  CRITICAL: [
    { value: 'Unresolved', weight: 50 },
    { value: 'Investigating', weight: 35 },
    { value: 'Resolved', weight: 13 },
    { value: 'False Positive', weight: 2 },
  ],
};

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const WINDOW_START = new Date('2025-06-01T00:00:00Z').getTime();

export function generateRecord() {
  const action = faker.helpers.arrayElement(ACTIONS);
  const profile = ACTION_PROFILE[action];
  const resourceType = faker.helpers.arrayElement(profile.types);
  const severity = pickSeverity(profile.risk);

  // Service accounts are automation, and they are noisy.
  const isService = faker.number.int({ min: 1, max: 100 }) <= 12;
  const role = isService
    ? 'service'
    : faker.helpers.weightedArrayElement([
        { value: 'user', weight: 55 },
        { value: 'admin', weight: 20 },
        { value: 'auditor', weight: 15 },
        { value: 'contractor', weight: 10 },
      ]);

  return {
    actor: isService
      ? faker.helpers.arrayElement(SERVICE_ACCOUNTS)
      : faker.helpers.arrayElement(ACTORS),
    role,
    action,
    resource: RESOURCE_PATH[resourceType](),
    resourceType,
    // Internal corporate ranges dominate; a minority arrive from the public
    // internet, which is exactly the population an investigator filters for.
    ipAddress: faker.helpers.weightedArrayElement([
      {
        value: `192.168.${faker.number.int({ min: 0, max: 8 })}.${faker.number.int({ min: 1, max: 254 })}`,
        weight: 55,
      },
      {
        value: `10.0.${faker.number.int({ min: 0, max: 20 })}.${faker.number.int({ min: 1, max: 254 })}`,
        weight: 30,
      },
      { value: faker.internet.ipv4(), weight: 15 },
    ]),
    region: faker.helpers.weightedArrayElement([
      { value: 'ap-south-1', weight: 30 },
      { value: 'us-east-1', weight: 25 },
      { value: 'eu-west-1', weight: 15 },
      { value: 'ap-southeast-1', weight: 10 },
      { value: 'eu-central-1', weight: 10 },
      { value: 'us-west-2', weight: 7 },
      { value: 'sa-east-1', weight: 3 },
    ]),
    severity,
    status: faker.helpers.weightedArrayElement(STATUS_WEIGHTS[severity] ?? STATUS_WEIGHTS.LOW),
    timestamp: new Date(
      WINDOW_START + faker.number.int({ min: 0, max: NINETY_DAYS_MS })
    ).toISOString(),
  };
}

export function generateRecords(count) {
  return Array.from({ length: count }, generateRecord);
}
