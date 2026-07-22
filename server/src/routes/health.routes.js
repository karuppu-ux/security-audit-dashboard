import { Router } from 'express';
import { databaseState } from '../config/db.js';

export const healthRouter = Router();

/**
 * Liveness + readiness in one endpoint. It reports 503 when the database is not
 * connected so that a container orchestrator (or Render's health check) stops
 * routing traffic to an instance that cannot serve a single query.
 */
healthRouter.get('/', (_req, res) => {
  const database = databaseState();
  const healthy = database === 'connected';

  res.status(healthy ? 200 : 503).json({
    data: {
      status: healthy ? 'ok' : 'degraded',
      database,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    },
  });
});
