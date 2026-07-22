import { Router } from 'express';
import * as controller from '../controllers/auditLog.controller.js';
import { validate } from '../validation/validate.js';
import {
  bulkUploadBodySchema,
  listLogsQuerySchema,
  logIdParamSchema,
} from '../validation/auditLog.schemas.js';

export const auditLogRouter = Router();

auditLogRouter.post('/bulk', validate(bulkUploadBodySchema, 'body'), controller.bulkUpload);

// Registered before '/:id' so that "meta" is never mistaken for an id.
auditLogRouter.get('/meta/enums', controller.getFilterMetadata);

auditLogRouter.get('/', validate(listLogsQuerySchema, 'query'), controller.listLogs);

auditLogRouter.get('/:id', validate(logIdParamSchema, 'params'), controller.getLogById);
