import type { Response } from 'express';
import {
  deliverVoiceResultAsSse,
  writeVoiceStreamError,
  endVoiceSse,
  initVoiceSseResponse,
  writeVoiceStreamStatus,
  writeVoiceStreamToken,
  writeVoiceStreamDone,
} from './voice-stream.js';
import { config, agentEnabledFor } from '../config.js';
import { runSchedulingAgent } from '../agent/scheduling-agent.js';
import type { SchedulingAgentResult } from '../agent/types.js';
import {
  updateCommandLogAgentTrace,
  updateCommandLogParsed,
} from '../db/command_logs.js';
import { logger } from '../logger.js';

export type AgentStreamContext = {
  userId: string;
  utterance: string;
  requestId: string;
  timezone: string;
  commandLogId?: string;
};

export type AgentStreamYield =
  | { type: 'token'; text: string }
  | { type: 'result'; payload: Record<string, unknown> };

export function buildAgentVoiceBody(
  result: SchedulingAgentResult,
  timezone: string,
): Record<string, unknown> {
  return {
    intent: 'RESOLVE_MANUAL',
    success: true,
    requiresConfirmation: false,
    messageToUser: result.reply,
    schemaVersion: 1,
    timezone,
    agentRounds: result.rounds,
    agentToolCalls: result.toolCalls.map((t) => ({
      name: t.name,
      ok: t.result.ok,
      error: t.result.error,
    })),
  };
}

function isPrecomputedAgentBody(body: Record<string, unknown>): boolean {
  return typeof body.agentRounds === 'number' && typeof body.messageToUser === 'string';
}

async function* streamPrecomputedAgentBody(
  body: Record<string, unknown>,
): AsyncGenerator<AgentStreamYield> {
  const reply = String(body.messageToUser ?? '');
  for (const chunk of chunkReplyForStream(reply)) {
    yield { type: 'token', text: chunk };
  }
  yield { type: 'result', payload: body };
}

function chunkReplyForStream(reply: string): string[] {
  if (!reply.trim()) return [];
  const words = reply.split(/(\s+)/);
  const chunks: string[] = [];
  let buf = '';
  for (const part of words) {
    if (buf.length + part.length > 48 && buf.trim()) {
      chunks.push(buf);
      buf = part;
    } else {
      buf += part;
    }
  }
  if (buf) chunks.push(buf);
  return chunks.length ? chunks : [reply];
}

async function persistAgentCommandLog(
  commandLogId: string | undefined,
  result: SchedulingAgentResult,
): Promise<void> {
  if (!commandLogId) return;
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

/**
 * Lane B agent loop hook. When the scheduling agent is enabled for the user,
 * streams the agent reply and tool summary for voice SSE clients.
 */
export async function* runAgentStream(
  ctx: AgentStreamContext,
  precomputed?: Record<string, unknown>,
): AsyncGenerator<AgentStreamYield> {
  if (!agentEnabledFor(ctx.userId)) {
    return;
  }

  if (precomputed && isPrecomputedAgentBody(precomputed)) {
    yield* streamPrecomputedAgentBody(precomputed);
    return;
  }

  const queue: AgentStreamYield[] = [];
  let wake: (() => void) | undefined;
  let streamedTokens = false;

  const agentPromise = runSchedulingAgent(
    ctx.utterance,
    {
      userId: ctx.userId,
      requestId: ctx.requestId,
      timezone: ctx.timezone,
    },
    [],
    {
      onToken: (text) => {
        streamedTokens = true;
        queue.push({ type: 'token', text });
        wake?.();
      },
    },
  )
    .then(async (result) => {
      await persistAgentCommandLog(ctx.commandLogId, result);
      if (!streamedTokens && result.reply.trim()) {
        for (const chunk of chunkReplyForStream(result.reply)) {
          queue.push({ type: 'token', text: chunk });
        }
      }
      queue.push({
        type: 'result',
        payload: buildAgentVoiceBody(result, ctx.timezone),
      });
      wake?.();
      return result;
    })
    .catch((err) => {
      logger.error('Agent stream failed', { error: String(err), requestId: ctx.requestId });
      const fallback = buildAgentVoiceBody(
        {
          reply:
            "I'm having trouble reaching the scheduling AI right now. Please try again in a moment.",
          toolCalls: [],
          rounds: 0,
          trace: { model: config.agentModel, rounds: 0, totalLatencyMs: 0, tools: [] },
        },
        ctx.timezone,
      );
      queue.push({ type: 'result', payload: fallback });
      wake?.();
    });

  while (true) {
    while (queue.length > 0) {
      const event = queue.shift()!;
      if (event.type === 'result') {
        yield event;
        await agentPromise;
        return;
      }
      yield event;
    }
    await new Promise<void>((resolve) => {
      wake = resolve;
    });
  }
}

export async function deliverAgentOrStubStream(
  res: Response,
  ctx: AgentStreamContext,
  fallbackResult: Record<string, unknown>,
): Promise<void> {
  initVoiceSseResponse(res, ctx.requestId);

  if (!agentEnabledFor(ctx.userId)) {
    await deliverVoiceResultAsSse(res, fallbackResult, {
      chunkDelayMs: config.nodeEnv === 'test' ? 0 : 20,
    });
    return;
  }

  writeVoiceStreamStatus(res, 'thinking');
  let resultPayload: Record<string, unknown> | null = null;

  try {
    const precomputed = isPrecomputedAgentBody(fallbackResult) ? fallbackResult : undefined;
    for await (const event of runAgentStream(ctx, precomputed)) {
      if (event.type === 'token') {
        writeVoiceStreamStatus(res, 'streaming');
        writeVoiceStreamToken(res, event.text);
      } else {
        resultPayload = event.payload;
      }
    }
  } catch {
    writeVoiceStreamError(res, 'Caladdin is temporarily unavailable. Try again shortly.', 503);
    endVoiceSse(res);
    return;
  }

  if (!resultPayload) {
    await deliverVoiceResultAsSse(res, fallbackResult, { chunkDelayMs: 0 });
    return;
  }

  writeVoiceStreamDone(res, resultPayload);
  endVoiceSse(res);
}
