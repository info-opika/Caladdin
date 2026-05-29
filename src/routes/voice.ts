import { Router, Request, Response } from 'express';
import { parseIntent } from '../core/parser.js';
import { orchestrate } from '../core/orchestrator.js';
import { validateUserId, validateUtterance } from '../core/safety.js';
import { WARM_REDIRECT_MESSAGE } from '../core/parser.js';
import { requireSession } from '../middleware/session.js';
import { getRequestId } from '../middleware/requestId.js';
import { getPolicy, getUserById } from '../db/users.js';
import { config } from '../config.js';
import { getOAuthClientForUser } from '../services/auth_service.js';
import { approvePendingConfirmation, rejectPendingConfirmation } from '../core/confirmation-actions.js';

export const voiceRouter = Router();

voiceRouter.post('/', requireSession, async (req: Request, res: Response) => {
  const requestId = getRequestId(req);
  const session = (req as Request & { session: { userId: string; email: string } }).session;
  const userId = (req.body.userId as string) ?? session.userId;

  if (req.body.userId && req.body.userId !== session.userId) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  const uidCheck = validateUserId(userId);
  if (!uidCheck.valid) {
    res.status(400).json({ error: uidCheck.error });
    return;
  }

  const utterance = req.body.utterance as string;
  const uttCheck = validateUtterance(utterance, config.utteranceMaxLength);
  if (!uttCheck.valid) {
    res.status(400).json({ error: uttCheck.error });
    return;
  }

  try {
    const policy = await getPolicy(userId);
    if (!policy && !(await getUserById(userId))) {
      res.status(404).json({ error: 'No policy found for user' });
      return;
    }

    const parsed = await parseIntent(utterance, userId, requestId);

    if (parsed._warmRedirect) {
      res.setHeader('x-request-id', requestId);
      res.json({
        intent: 'RESOLVE_MANUAL',
        success: true,
        requiresConfirmation: false,
        messageToUser: WARM_REDIRECT_MESSAGE,
        schemaVersion: 1,
      });
      return;
    }

    const oauthClient = await getOAuthClientForUser(userId);
    const result = await orchestrate(parsed, { userId, requestId, oauthClient: oauthClient ?? undefined });
    res.setHeader('x-request-id', requestId);
    res.json(result);
  } catch {
    res.status(503).setHeader('Retry-After', '30').json({
      error: 'Caladdin is temporarily unavailable. Try again in 30 seconds.',
    });
  }
});

voiceRouter.post('/confirm/:token/approve', requireSession, async (req: Request, res: Response) => {
  const session = (req as Request & { session: { userId: string } }).session;
  const { status, body } = await approvePendingConfirmation(req.params.token, session.userId);
  res.status(status).json(body);
});

voiceRouter.post('/confirm/:token/reject', requireSession, async (req: Request, res: Response) => {
  const session = (req as Request & { session: { userId: string } }).session;
  const { status, body } = await rejectPendingConfirmation(req.params.token, session.userId);
  res.status(status).json(body);
});
