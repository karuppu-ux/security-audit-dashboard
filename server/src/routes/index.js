import { Router } from 'express';
import { auditLogRouter } from './auditLog.routes.js';

export const apiRouter = Router();

apiRouter.use('/logs', auditLogRouter);
