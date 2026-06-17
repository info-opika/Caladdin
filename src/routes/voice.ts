import { Router, Request, Response } from 'express';
import { mapVoiceUtteranceToIntent } from '../core/voice-intent-pipeline.js';
import { orchestrate } from '../core/orchestrator.js';
import { validateUserId, validateUtterance } from '../core/safety.js';
import { WARM_REDIRECT_MESSAGE } from '../core/adts.js';
import { requireSession } from '../middleware/session.js';
import { getRequestId } from '../middleware/requestId.js';
import { getPolicy, getUserById, ensureDefaultPolicy, recordSetupFieldAnswer } from '../db/users.js';
import { agentEnabledFor, config } from '../config.js';
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
  updateCommandLogAgentTrace,
} from '../db/command_logs.js';
import type { ParsedIntent } from '../core/adts.js';
import { wantsVoiceStream } from '../core/voice-stream.js';
import { buildAgentVoiceBody, deliverAgentOrStubStream } from '../core/voice-agent-stream.js';
import { runSchedulingAgent } from '../agent/scheduling-agent.js';

export const voiceRouter = Router();

export type VoiceRouteOutcome = {
  status: number;
  body: Record<string, unknown>;
  retryAfter?: string;
  streamable: boolean;
};

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

/** Agent path for pilot / globally enabled users — skips Haiku classifier + orchestrator. */
async function executeAgentVoicePath(
  userId: string,
  utterance: string,
  requestId: string,
  tz: string,
  commandLogId?: string,
): Promise<VoiceRouteOutcome> {
  try {
    const result = await runSchedulingAgent(
      utterance,
      { userId, requestId, timezone: tz },
      [],
    );

    if (commandLogId) {
      try {
        await updateCommandLogParsed(commandLogId, {
          intent: 'RESOLVE_MANUAL',
          params: { agentPath: true, agentRounds: result.rounds },
        });
        await updateCommandLogAgentTrace(commandLogId, result.trace);
      } catch (e) {
        logger.warn('Command log agent update failed', { commandLogId, error: String(e) });
      }
    }

    return {
      status: 200,
      streamable: true,
      body: buildAgentVoiceBody(result, tz),
    };
  } catch (err) {
    logger.error('Agent voice pipeline failed', { requestId, userId, error: String(err) });
    return {
      status: 503,
      body: { error: 'Caladdin is temporarily unavailable. Try again in 30 seconds.' },
      retryAfter: '30',
      streamable: false,
    };
  }
}

export async function executeVoiceRequest(
  req: Request,
  session: { userId: string; email: string },
): Promise<VoiceRouteOutcome> {
  const requestId = getRequestId(req);
  const userId = (req.body.userId as string) ?? session.userId;

  if (req.body.userId && req.body.userId !== session.userId) {
    return { status: 403, body: { error: 'Forbidden' }, streamable: false };
  }

  const uidCheck = validateUserId(userId);
  if (!uidCheck.valid) {
    return { status: 400, body: { error: uidCheck.error ?? 'Invalid user' }, streamable: false };
  }

  const utterance = req.body.utterance as string;
  const uttCheck = validateUtterance(utterance, config.utteranceMaxLength);
  if (!uttCheck.valid) {
    return { status: 400, body: { error: uttCheck.error ?? 'Invalid utterance' }, streamable: false };
  }

  const bucket = classifyVoiceRateLimitBucket(utterance);
  const rateKey = `${session.userId}:${bucket}`;
  const httpRate = await voiceHttpRateLimiter.check(rateKey);
  if (!httpRate.allowed) {
    return {
      status: 429,
      body: {
        error: 'Rate limit exceeded',
        retryAfterMs: httpRate.retryAfterMs,
      },
      streamable: false,
    };
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
      return {
        status: 503,
        body: { error: 'Caladdin is in safe mode. Try again shortly.' },
        retryAfter: '30',
        streamable: false,
      };
    }

    if (!policy && !(await getUserById(userId))) {
      return { status: 404, body: { error: 'No policy found for user' }, streamable: false };
    }

    const tz = policy?.timezone ?? 'America/Chicago';

    if (agentEnabledFor(userId)) {
      return executeAgentVoicePath(userId, utterance, requestId, tz, commandLogId);
    }

    let parsed: ParsedIntent | null = await tryResolvePendingSetup(userId, utterance);

    if (!parsed) {
      // @deprecated Legacy Haiku classifier hot path — bypassed when agentEnabledFor(userId).
      // Retained for users not on the agent pilot until full rollout (M5+).
      const { intent: pipelineIntent } = await mapVoiceUtteranceToIntent(utterance, { userId, timezone: tz });
      parsed = pipelineIntent;

      if (parsed.intent === 'WARM_REDIRECT') {
        if (pendingEmail) {
          parsed = { ...parsed, intent: 'RESOLVE_MANUAL' as const, params: {} };
        } else {
          return {
            status: 200,
            streamable: true,
            body: {
              intent: 'RESOLVE_MANUAL',
              success: true,
              requiresConfirmation: false,
              messageToUser: WARM_REDIRECT_MESSAGE,
              schemaVersion: 1,
            },
          };
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
        return {
          status: 200,
          streamable: true,
          body: emailGate.result as Record<string, unknown>,
        };
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
      return {
        status: 200,
        streamable: true,
        body: {
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
        },
      };
    }

    const result = await orchestrate(parsed, {
      userId,
      requestId,
      timezone: effectivePolicy.timezone,
      oauthClient: oauthClient ?? undefined,
      conversationContext,
      commandLogId,
    });

    return {
      status: 200,
      streamable: true,
      body: result as Record<string, unknown>,
    };
  } catch (err) {
    logger.error('Voice pipeline failed', { requestId, userId, error: String(err) });
    return {
      status: 503,
      body: { error: 'Caladdin is temporarily unavailable. Try again in 30 seconds.' },
      retryAfter: '30',
      streamable: false,
    };
  }
}

function sendVoiceJson(res: Response, requestId: string, outcome: VoiceRouteOutcome): void {
  if (outcome.retryAfter) {
    res.status(outcome.status).setHeader('Retry-After', outcome.retryAfter);
  } else {
    res.status(outcome.status);
  }
  res.setHeader('x-request-id', requestId).json(outcome.body);
}

voiceRouter.post('/', requireSession, async (req: Request, res: Response) => {
  const requestId = getRequestId(req);
  const session = (req as Request & { session: { userId: string; email: string } }).session;
  const useStream = wantsVoiceStream(req);
  const outcome = await executeVoiceRequest(req, session);

  if (useStream && outcome.streamable && outcome.status === 200) {
    const utterance = String(req.body.utterance ?? '');
    const tz =
      typeof outcome.body.timezone === 'string'
        ? outcome.body.timezone
        : 'America/Chicago';
    await deliverAgentOrStubStream(
      res,
      {
        userId: session.userId,
        utterance,
        requestId,
        timezone: tz,
      },
      outcome.body,
    );
    return;
  }

  sendVoiceJson(res, requestId, outcome);
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
