import { Request, Response, NextFunction } from 'express';
import { logger } from '../logger.js';

export function errorSanitizer(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  logger.error('Unhandled error', { error: String(err) });
  res.status(500).json({ error: 'Internal server error' });
}
