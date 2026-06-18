import { Router, Request, Response } from 'express';
import { validateUserId, validateUtterance } from '../core/safety.js';
import { requireSession } from '../middleware/session.js';
import { getRequestId } from '../middleware/requestId.js';
import { getPolicy, getUserById } from '../db/users.js';
import { agentEnabledFor, config } from '../config.js';
import { voiceHttpRateLimiter } from '../core/rate-limiter.js';
import { classifyVoiceRateLimitBucket } from '../core/voice-rate-limit-bucket.js';
import { resolveSystemMode } from '../core/system-mode.js';
import { logger } from '../logger.js';
import {
  insertCommandLog,
  updateCommandLogParsed,
  updateCommandLogAgentTrace,
} from '../db/command_logs.js';
import { wantsVoiceStream } from '../core/voice-stream.js';
import { buildAgentVoiceBody, deliverAgentOrStubStream } from '../core/voice-agent-stream.js';
import { runSchedulingAgent } from '../agent/scheduling-agent.js';
import { approvePendingConfirmation, rejectPendingConfirmation } from '../core/confirmation-actions.js';

export const voiceRouter = Router();

export type VoiceRouteOutcome = {
  status: number;
  body: Record<string, unknown>;
  retryAfter?: string;
  streamable: boolean;
  commandLogId?: string;
};

/** Agent path — FreeLLMAPI scheduling agent with deterministic prefilters. */
async function executeAgentVoicePath(
  userId: string,
  utterance: string,
  requestId: string,
  tz: string,
  commandLogId?: string,
  deferAgentExecution = false,
): Promise<VoiceRouteOutcome> {
  if (deferAgentExecution) {
    return {
      status: 200,
      streamable: true,
      body: { timezone: tz, deferredAgent: true },
      commandLogId,
    };
  }

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
      commandLogId,
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
  options?: { deferAgentExecution?: boolean },
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
    const [policy, , , systemMode] = await Promise.all([
      getPolicy(userId),
      Promise.resolve(null),
      Promise.resolve(null),
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
      return executeAgentVoicePath(
        userId,
        utterance,
        requestId,
        tz,
        commandLogId,
        options?.deferAgentExecution === true,
      );
    }

    return {
      status: 503,
      body: {
        error: 'Legacy voice classifier is retired. Enable the scheduling agent for this user.',
      },
      retryAfter: '30',
      streamable: false,
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
  const outcome = await executeVoiceRequest(req, session, {
    deferAgentExecution: useStream && agentEnabledFor(session.userId),
  });

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
        commandLogId: outcome.commandLogId,
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
