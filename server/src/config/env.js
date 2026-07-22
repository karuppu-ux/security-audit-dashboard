import 'dotenv/config';
import { z } from 'zod';

/**
 * Environment is validated once, at boot, with the same tool used for request
 * validation. A missing or malformed variable should crash the process
 * immediately with a readable message — never surface as a confusing runtime
 * error on the first request that happens to touch it.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  // Comma-separated origins, or '*' to allow any (dev/demo convenience).
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  // Empty string is meaningful: "start an in-process MongoDB for me".
  MONGODB_URI: z.string().trim().default(''),
  MONGODB_DB_NAME: z.string().trim().min(1).default('audit_logs'),

  MAX_BULK_RECORDS: z.coerce.number().int().positive().default(20_000),
  JSON_BODY_LIMIT: z.string().default('25mb'),
  BULK_BATCH_SIZE: z.coerce.number().int().positive().default(1000),

  MAX_PAGE_SIZE: z.coerce.number().int().positive().default(100),
  QUERY_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${details}`);
}

export const env = Object.freeze({
  ...parsed.data,
  isProduction: parsed.data.NODE_ENV === 'production',
  isTest: parsed.data.NODE_ENV === 'test',
  corsOrigins:
    parsed.data.CORS_ORIGIN === '*'
      ? '*'
      : parsed.data.CORS_ORIGIN.split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
});
