import {
  expireStaleConfirmations,
  getPendingConfirmation,
  updateConfirmationStatus,
} from '../db/confirmations.js';
import { hashPayload, insertAuditLog } from '../db/audit.js';
import { reExecuteFromConfirmation } from './orchestrator.js';
import { logger } from '../logger.js';

export type ConfirmationActionStatus = 200 | 403 | 404 | 409 | 410 | 500;

export interface ConfirmationActionResult {
  status: ConfirmationActionStatus;
  body: Record<string, unknown>;
}

export async function approvePendingConfirmation(
  token: string,
  expectedUserId?: string,
): Promise<ConfirmationActionResult> {
  await expireStaleConfirmations();
  const row = await getPendingConfirmation(token);

  if (!row) {
    return { status: 404, body: { error: 'Token not found' } };
  }
  if (expectedUserId && row.user_id !== expectedUserId) {
    return { status: 403, body: { error: 'Forbidden' } };
  }
  if (row.status === 'approved') {
    return { status: 409, body: { error: 'This confirmation was already used. Send the request again.' } };
  }
  if (row.status !== 'pending' || new Date(row.expires_at) < new Date()) {
    await updateConfirmationStatus(token, 'expired');
    await insertAuditLog({ userId: row.user_id, intent: row.intent, outcome: 'blocked' });
    return { status: 410, body: { error: 'Token expired' } };
  }

  const currentHash = hashPayload(row.payload);
  if (row.payload_hash && row.payload_hash !== currentHash) {
    if (!expectedUserId) {
      return { status: 409, body: { error: 'Stale confirmation payload' } };
    }
    logger.warn('Confirmation payload hash mismatch on session approve; proceeding', { token });
  }

  await updateConfirmationStatus(token, 'approved');

  try {
    const payload = row.payload as { parsed: unknown; requestId: string };
    const result = await reExecuteFromConfirmation(payload, row.user_id);
    if (!result.success) {
      await updateConfirmationStatus(token, 'pending');
      logger.error('Confirmation re-exec failed', {
        token,
        intent: row.intent,
        error: result.messageToUser ?? 'execution failed',
      });
      return {
        status: 500,
        body: {
          success: false,
          status: 'pending',
          executionStatus: 'failed',
          messageToUser: result.messageToUser,
          reason: result.messageToUser,
        },
      };
    }
    return {
      status: 200,
      body: {
        status: 'approved',
        executionStatus: 'success',
        messageToUser: result.messageToUser,
        result,
      },
    };
  } catch (e) {
    await updateConfirmationStatus(token, 'pending');
    logger.error('Confirmation re-exec failed', { token, intent: row.intent, error: String(e) });
    return {
      status: 500,
      body: {
        success: false,
        status: 'pending',
        executionStatus: 'failed',
        messageToUser: 'Something went wrong processing that request. Please try again.',
        reason: String(e),
      },
    };
  }
}

export async function rejectPendingConfirmation(
  token: string,
  expectedUserId?: string,
): Promise<ConfirmationActionResult> {
  const row = await getPendingConfirmation(token);

  if (!row) {
    return { status: 404, body: { error: 'Token not found' } };
  }
  if (expectedUserId && row.user_id !== expectedUserId) {
    return { status: 403, body: { error: 'Forbidden' } };
  }
  if (row.status === 'approved') {
    return { status: 409, body: { error: 'Token already consumed' } };
  }

  await updateConfirmationStatus(token, 'rejected');
  await insertAuditLog({ userId: row.user_id, intent: row.intent, outcome: 'rejected' });
  return { status: 200, body: { status: 'rejected' } };
}
