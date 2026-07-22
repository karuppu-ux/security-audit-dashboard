import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';

import { env } from './config/env.js';
import { apiRouter } from './routes/index.js';
import { healthRouter } from './routes/health.routes.js';
import { notFound } from './middleware/notFound.js';
import { errorHandler } from './middleware/errorHandler.js';

/**
 * App factory rather than a module-level singleton: tests import this, mount it
 * on Supertest, and never bind a port. `index.js` owns the listening.
 */
export function createApp() {
  const app = express();

  // Behind Render/Railway/nginx, so client IPs and protocol come from headers.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(
    cors({
      origin: env.corsOrigins,
      methods: ['GET', 'POST'],
    })
  );
  // Log payloads are highly repetitive JSON — gzip cuts a 100-row page by ~85%.
  app.use(compression());

  // Raised to fit a 10,000-record bulk upload in a single request (~2.5MB of
  // JSON). Express's 100kb default would reject it outright.
  app.use(express.json({ limit: env.JSON_BODY_LIMIT }));

  if (!env.isTest) {
    app.use(morgan(env.isProduction ? 'combined' : 'dev'));
  }

  app.use('/health', healthRouter);
  app.use('/api/v1', apiRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
