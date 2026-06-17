import { Router, Request, Response } from 'express';
import { mapVoiceUtteranceToIntent } from '../core/voice-intent-pipeline.js';
import { orchestrate } from '../core/orchestrator.js';
import { validateUserId, validateUtterance } from '../core/safety.js';
import { WARM_REDIRECT_MESSAGE } from '../core/adts.js';
import { requireSession } from '../middleware/session.js';
import { getRequestId } from '../middleware/requestId.js';
import { getPolicy, getUserById, ensureDefaultPolicy, recordSetupFieldAnswer } from '../db/users.js';
import { config } from '../config.js';
import { voiceHttpRateLimiter } from '../core/rate-limiter.js';
import { classifyVoiceRateLimitBucket } from '../core/voice-rate-limit-bucket.js';
import { getOAuthClientForUser } from '../services/auth_service.js';
import { approvePendingConfirmation, rejectPendingConfirmation } from '../core/confirmation-actions.js';
import {
  getConversationContext,
  getPendingEmailConfirmation,
  getPendingSetupIntent,
  savePendingSetupIntent,
  clearPendingSetupIntent,
} from '../db/conversation-context.js';
import { applyConversationContext } from '../core/conversation-context.js';
import { handleEmailConfirmationGate } from '../core/email-confirmation.js';
import { resolveSystemMode } from '../core/system-mode.js';
import { logger } from '../logger.js';
import {
  checkContextualSetup,
  parseSetupAnswer,
  type SetupFieldId,
} from '../core/contextual-setup.js';
import {
  insertCommandLog,
  updateCommandLogParsed,
} from '../db/command_logs.js';
import type { ParsedIntent } from '../core/adts.js';

export const voiceRouter = Router();

async function tryResolvePendingSetup(
  userId: string,
  utterance: string,
): Promise<ParsedIntent | null> {
  const pending = await getPendingSetupIntent(userId);
  if (!pending) return null;

  const parsedAnswer = parseSetupAnswer(pending.setupField, utterance);
  if (!parsedAnswer) return null;

  await recordSetupFieldAnswer(userId, pending.setupField, parsedAnswer);
  await clearPendingSetupIntent(userId);
  return pending.deferredParsed;
}

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

  const bucket = classifyVoiceRateLimitBucket(utterance);
  const rateKey = `${session.userId}:${bucket}`;
  const httpRate = await voiceHttpRateLimiter.check(rateKey);
  if (!httpRate.allowed) {
    res.status(429).json({
      error: 'Rate limit exceeded',
      retryAfterMs: httpRate.retryAfterMs,
    });
    return;
  }

  const inputMode = req.body.source === 'text' ? 'text' : 'voice';
  let commandLogId: string | undefined;
  try {
    commandLogId = await insertCommandLog({
      userId,
      rawInput: utterance,
      inputMode,
    });
  } catch (e) {
    logger.warn('Command log insert failed', { userId, error: String(e) });
  }

  try {
    const [policy, conversationContext, pendingEmail, oauthClient, systemMode] = await Promise.all([
      getPolicy(userId),
      getConversationContext(userId),
      getPendingEmailConfirmation(userId),
      getOAuthClientForUser(userId),
      resolveSystemMode(),
    ]);

    if (systemMode === 'SAFE_MODE') {
      res.status(503).setHeader('Retry-After', '30').setHeader('x-request-id', requestId).json({
        error: 'Caladdin is in safe mode. Try again shortly.',
      });
      return;
    }

    if (!policy && !(await getUserById(userId))) {
      res.status(404).json({ error: 'No policy found for user' });
      return;
    }

    const tz = policy?.timezone ?? 'America/Chicago';
    let parsed: ParsedIntent | null = await tryResolvePendingSetup(userId, utterance);

    if (!parsed) {
      const { intent: pipelineIntent } = await mapVoiceUtteranceToIntent(utterance, { userId, timezone: tz });
      parsed = pipelineIntent;

      if (parsed.intent === 'WARM_REDIRECT') {
        if (pendingEmail) {
          parsed = { ...parsed, intent: 'RESOLVE_MANUAL' as const, params: {} };
        } else {
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
      }

      parsed = applyConversationContext(parsed, conversationContext);

      const emailGate = await handleEmailConfirmationGate(
        parsed,
        userId,
        conversationContext,
        inputMode,
      );
      if (!emailGate.proceed) {
        res.setHeader('x-request-id', requestId);
        res.json(emailGate.result);
        return;
      }
      parsed = emailGate.parsed;
    }

    if (commandLogId) {
      try {
        await updateCommandLogParsed(commandLogId, {
          intent: parsed.intent,
          params: parsed.params ?? {},
        });
      } catch (e) {
        logger.warn('Command log parse update failed', { commandLogId, error: String(e) });
      }
    }

    const effectivePolicy = policy ?? (await ensureDefaultPolicy(userId));
    const setupGap = checkContextualSetup(effectivePolicy, parsed.intent, parsed);
    if (setupGap) {
      await savePendingSetupIntent(userId, {
        setupField: setupGap.field as SetupFieldId,
        deferredParsed: parsed,
        originalUtterance: utterance,
      });
      res.setHeader('x-request-id', requestId);
      res.json({
        outcome: 'needs_setup',
        intent: parsed.intent,
        success: false,
        requiresConfirmation: false,
        setupField: setupGap.field,
        formType: setupGap.formType,
        showFormFallback: true,
        pendingUtterance: utterance,
        messageToUser: setupGap.question,
        schemaVersion: 1,
      });
      return;
    }

    const result = await orchestrate(parsed, {
      userId,
      requestId,
      timezone: effectivePolicy.timezone,
      oauthClient: oauthClient ?? undefined,
      conversationContext,
      commandLogId,
    });
    res.setHeader('x-request-id', requestId);
    res.json(result);
  } catch (err) {
    logger.error('Voice pipeline failed', { requestId, userId, error: String(err) });
    res.status(503).setHeader('Retry-After', '30').setHeader('x-request-id', requestId).json({
      error: 'Caladdin is temporarily unavailable. Try again in 30 seconds.',
    });
  }
});

voiceRouter.post('/confirm/:token/approve', requireSession, async (req: Request, res: Response) => {
  const session = (req as Request & { session: { userId: string } }).session;
  const { status, body } = await approvePendingConfirmation(String(req.params.token), session.userId);
  res.status(status).json(body);
});

voiceRouter.post('/confirm/:token/reject', requireSession, async (req: Request, res: Response) => {
  const session = (req as Request & { session: { userId: string } }).session;
  const { status, body } = await rejectPendingConfirmation(String(req.params.token), session.userId);
  res.status(status).json(body);
});
