import { Request } from 'express';
import { insertAuditLog } from '../db/audit.js';
import { getRequestId } from './requestId.js';
import { logger } from '../logger.js';

/** Best-effort audit trail for sensitive host/API mutations (GDPR, profile, event types). */
export async function auditSensitiveOperation(
  req: Request,
  userId: string,
  intent: string,
  outcome: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    await insertAuditLog({
      userId,
      intent,
      outcome,
      requestId: getRequestId(req),
      metadata: metadata ?? {},
    });
  } catch (err) {
    logger.error('Audit log write failed', {
      intent,
      userId,
      error: err instanceof Error ? err.message : String(err),
      requestId: getRequestId(req),
    });
  }
}
