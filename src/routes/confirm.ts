import { Router, Request, Response } from 'express';
import { requireApiKey } from '../middleware/session.js';
import {
  getPendingConfirmation,
  updateConfirmationStatus,
  expireStaleConfirmations,
} from '../db/confirmations.js';
import { hashPayload } from '../db/audit.js';
import { reExecuteFromConfirmation } from '../core/orchestrator.js';
import { insertAuditLog } from '../db/audit.js';
import { config } from '../config.js';

export const confirmRouter = Router();

confirmRouter.use(requireApiKey);

confirmRouter.post('/:token/approve', async (req: Request, res: Response) => {
  await expireStaleConfirmations();
  const { token } = req.params;
  const row = await getPendingConfirmation(token);

  if (!row) {
    res.status(404).json({ error: 'Token not found' });
    return;
  }
  if (row.status === 'approved') {
    res.status(409).json({ error: 'Token already consumed' });
    return;
  }
  if (row.status !== 'pending' || new Date(row.expires_at) < new Date()) {
    await updateConfirmationStatus(token, 'expired');
    await insertAuditLog({ userId: row.user_id, intent: row.intent, outcome: 'blocked' });
    res.status(410).json({ error: 'Token expired' });
    return;
  }

  const currentHash = hashPayload(row.payload);
  if (row.payload_hash && row.payload_hash !== currentHash) {
    res.status(409).json({ error: 'Stale confirmation payload' });
    return;
  }

  await updateConfirmationStatus(token, 'approved');

  try {
    const payload = row.payload as { parsed: import('../core/adts.js').ParsedIntent; requestId: string };
    const result = await reExecuteFromConfirmation(payload, row.user_id);
    res.json({
      status: 'approved',
      executionStatus: result.success ? 'success' : 'failed',
      reason: result.success ? undefined : result.messageToUser,
      result,
    });
  } catch (e) {
    res.json({
      status: 'approved',
      executionStatus: 'failed',
      reason: String(e),
    });
  }
});

confirmRouter.post('/:token/reject', async (req: Request, res: Response) => {
  const { token } = req.params;
  const row = await getPendingConfirmation(token);
  if (!row) {
    res.status(404).json({ error: 'Token not found' });
    return;
  }
  if (row.status === 'approved') {
    res.status(409).json({ error: 'Token already consumed' });
    return;
  }
  await updateConfirmationStatus(token, 'rejected');
  await insertAuditLog({ userId: row.user_id, intent: row.intent, outcome: 'rejected' });
  res.json({ status: 'rejected' });
});
