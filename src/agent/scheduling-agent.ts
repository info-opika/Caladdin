import { config } from '../config.js';
import { buildAgentContext, type BuiltAgentContext } from './context-builder.js';
import { buildSchedulingSystemPrompt } from './prompts/system.js';
import { buildOpenAiToolDefinitions, executeAgentTool } from './tools/registry.js';
import { createLlmClient, type LlmClient, type LlmMessage } from '../services/llm/index.js';
import { CORE_TOOL_NAMES, selectToolsForUtterance } from './tool-pruning.js';
import { checkWrongTool } from './tool-call-guard.js';
import { validateHonestReply } from './honesty-validator.js';
import { stripLlmReasoningLeak } from './reply-sanitizer.js';
import { assembleAgentContext } from './agent-context-assembler.js';
import { runAgentPrefilter } from './agent-prefilter.js';
import { getPendingFrame } from '../db/conversation-context.js';
import {
  appendAgentChatTurn,
  clearAgentChatSession,
  getAgentChatHistory,
} from './agent-chat-session.js';
import { WARM_REDIRECT_MESSAGE } from '../core/adts.js';
import type {
  AgentContext,
  AgentMessage,
  AgentTrace,
  SchedulingAgentResult,
  ToolResult,
} from './types.js';

export const DEFAULT_AGENT_MODEL = config.agentModel;
export const MAX_AGENT_ROUNDS = 5;

export type SchedulingAgentOptions = {
  llm?: LlmClient;
  model?: string;
  maxRounds?: number;
  prebuiltContext?: AgentContext & { systemContextBlock?: string };
  /** When set, streams final reply tokens from the LLM (falls back to non-streaming on error). */
  onToken?: (text: string) => void;
};

function parseToolArguments(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const trimmed = raw?.trim() ?? '';
  if (!trimmed) {
    return { ok: false, error: 'empty arguments' };
  }
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {
    return { ok: false, error: 'invalid JSON' };
  }
}

function toOpenAiHistory(history: AgentMessage[]): LlmMessage[] {
  return history.map((m) => ({ role: m.role, content: m.content }));
}

function buildSystemPrompt(contextBlock: string, toolNames: string[]): string {
  const base = buildSchedulingSystemPrompt(contextBlock);
  if (toolNames.length === 0) return base;
  return `${base}\n\n## Active tools this turn\n${toolNames.join(', ')}`;
}

async function resolveBuiltContext(
  params: { userId: string; requestId: string; timezone?: string },
  options: SchedulingAgentOptions,
): Promise<BuiltAgentContext> {
  if (options.prebuiltContext) {
    return {
      ...options.prebuiltContext,
      systemContextBlock: options.prebuiltContext.systemContextBlock ?? '',
    };
  }
  return buildAgentContext(params);
}

function buildTrace(
  model: string,
  rounds: number,
  startedAt: number,
  toolTrace: AgentTrace['tools'],
  sessionId: string,
  toolNames: string[],
  routedViaRounds: string[],
  fallbackAttempts?: number,
): AgentTrace {
  return {
    model,
    rounds,
    totalLatencyMs: Date.now() - startedAt,
    tools: toolTrace,
    sessionId,
    toolSubset: toolNames,
    routedViaRounds,
    requestedModel: model,
    fallbackAttempts,
  };
}

function isMissingRoutingProfileError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /Profile\s+'[^']+'\s+not found/i.test(msg);
}

async function completeWithOptionalStream(
  llm: LlmClient,
  req: Parameters<LlmClient['complete']>[0],
  onToken?: (text: string) => void,
): Promise<Awaited<ReturnType<LlmClient['complete']>>> {
  if (!onToken || !llm.completeStream) {
    return llm.complete(req);
  }

  try {
    let response: Awaited<ReturnType<LlmClient['complete']>> | null = null;
    for await (const event of llm.completeStream(req)) {
      if (event.type === 'delta') {
        onToken(event.text);
      } else {
        response = event.response;
      }
    }
    if (response) return response;
    throw new Error('stream ended without response');
  } catch (streamErr) {
    if (isMissingRoutingProfileError(streamErr)) throw streamErr;
    const res = await llm.complete(req);
    if (res.text && onToken) {
      onToken(res.text);
    }
    return res;
  }
}

/** Retry with escalation model when a custom routing profile is missing on FreeLLMAPI. */
async function completeResilient(
  llm: LlmClient,
  req: Parameters<LlmClient['complete']>[0],
  onToken?: (text: string) => void,
): Promise<Awaited<ReturnType<LlmClient['complete']>>> {
  try {
    return await completeWithOptionalStream(llm, req, onToken);
  } catch (err) {
    const fallback = config.agentEscalationModel;
    if (!isMissingRoutingProfileError(err) || req.model === fallback || req.model === 'auto') {
      throw err;
    }
    return completeWithOptionalStream(llm, { ...req, model: fallback }, onToken);
  }
}

function llmUnavailableResult(model: string): SchedulingAgentResult {
  return {
    reply:
      "I'm having trouble reaching the scheduling AI right now. Please try again in a moment.",
    toolCalls: [],
    rounds: 0,
    trace: {
      model,
      rounds: 0,
      totalLatencyMs: 0,
      tools: [],
      requestedModel: model,
    },
  };
}

async function runAgentLoop(
  userMessage: string,
  params: { userId: string; requestId: string; timezone?: string },
  history: AgentMessage[],
  options: SchedulingAgentOptions,
  built: BuiltAgentContext,
  escalation = false,
): Promise<SchedulingAgentResult> {
  const llm = options.llm ?? createLlmClient();
  const model = escalation
    ? config.agentEscalationModel
    : (options.model ?? config.agentModel);
  const maxRounds = options.maxRounds ?? MAX_AGENT_ROUNDS;
  const sessionId = `caladdin:${params.userId}:${params.requestId}`;

  const agentCtx: AgentContext = {
    userId: built.userId,
    requestId: built.requestId,
    timezone: built.timezone,
    cal: built.cal,
    policy: built.policy,
    conversationContext: built.conversationContext,
  };

  const toolNames = escalation
    ? [...CORE_TOOL_NAMES]
    : selectToolsForUtterance(userMessage, history);
  const tools = buildOpenAiToolDefinitions(toolNames);

  const pendingIntent = await getPendingFrame(params.userId).catch(() => null);
  const contextAssembly = assembleAgentContext({
    userUtterance: userMessage,
    chatHistory: history,
    agentContext: agentCtx,
    baseContextBlock: built.systemContextBlock,
    pendingIntent,
  });
  const system = buildSystemPrompt(contextAssembly.enrichedContextBlock, toolNames);

  const userContent = contextAssembly.userMessagePrefix
    ? `${contextAssembly.userMessagePrefix}\n\n${userMessage}`
    : userMessage;
  const messages: LlmMessage[] = [
    ...toOpenAiHistory(history),
    { role: 'user', content: userContent },
  ];

  const toolCalls: SchedulingAgentResult['toolCalls'] = [];
  const toolTrace: AgentTrace['tools'] = [];
  const routedViaRounds: string[] = [];
  let maxFallbackAttempts: number | undefined;
  let rounds = 0;
  let lastReply = '';
  const startedAt = Date.now();

  while (rounds < maxRounds) {
    rounds += 1;

    const res = await completeResilient(
      llm,
      {
        model,
        system,
        messages,
        tools,
        sessionId,
        temperature: config.llmTemperature,
        parallelToolCalls: config.parallelToolCalls,
        maxTokens: 1024,
      },
      options.onToken,
    );

    if (res.routedVia) routedViaRounds.push(res.routedVia);
    if (res.fallbackAttempts !== undefined) {
      maxFallbackAttempts =
        maxFallbackAttempts === undefined
          ? res.fallbackAttempts
          : Math.max(maxFallbackAttempts, res.fallbackAttempts);
    }
    lastReply = res.text;

    if (res.finishReason !== 'tool_calls' || res.toolCalls.length === 0) {
      const honest = stripLlmReasoningLeak(validateHonestReply(lastReply, toolCalls));
      return {
        reply: honest,
        toolCalls,
        rounds,
        trace: buildTrace(
          model,
          rounds,
          startedAt,
          toolTrace,
          sessionId,
          toolNames,
          routedViaRounds,
          maxFallbackAttempts,
        ),
      };
    }

    messages.push({
      role: 'assistant',
      content: res.text || null,
      tool_calls: res.toolCalls,
    });

    let wrongToolRetried = false;
    let argsRetried = false;

    for (const call of res.toolCalls) {
      const parsedArgs = parseToolArguments(call.function.arguments);

      if (!parsedArgs.ok && !argsRetried) {
        argsRetried = true;
        messages.push({
          role: 'user',
          content: `Tool ${call.function.name} failed: ${parsedArgs.error}. Fix and retry with valid JSON.`,
        });
        rounds -= 1;
        break;
      }

      if (!parsedArgs.ok) {
        toolCalls.push({
          name: call.function.name,
          input: call.function.arguments,
          result: { ok: false, error: parsedArgs.error },
        });
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({ ok: false, error: parsedArgs.error }),
        });
        continue;
      }

      const wrongCheck = checkWrongTool(userMessage, call.function.name);
      if (wrongCheck.wrong && !wrongToolRetried) {
        wrongToolRetried = true;
        messages.push({
          role: 'user',
          content: wrongCheck.correction ?? 'Use the correct tool for this request.',
        });
        rounds -= 1;
        break;
      }

      const toolStarted = Date.now();
      const result: ToolResult = await executeAgentTool(
        call.function.name,
        parsedArgs.value,
        agentCtx,
      );
      toolTrace.push({
        name: call.function.name,
        latencyMs: Date.now() - toolStarted,
        ok: result.ok,
      });
      toolCalls.push({ name: call.function.name, input: parsedArgs.value, result });

      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }

    if (argsRetried || wrongToolRetried) {
      continue;
    }
  }

  const honest = stripLlmReasoningLeak(
    validateHonestReply(
      lastReply || 'I need a bit more information to continue.',
      toolCalls,
    ),
  );

  return {
    reply: honest,
    toolCalls,
    rounds,
    trace: buildTrace(
      model,
      rounds,
      startedAt,
      toolTrace,
      sessionId,
      toolNames,
      routedViaRounds,
      maxFallbackAttempts,
    ),
  };
}

function isAlreadyProtectedToolResult(data: unknown): boolean {
  return (
    typeof data === 'object' &&
    data !== null &&
    'alreadyProtected' in data &&
    (data as { alreadyProtected?: boolean }).alreadyProtected === true
  );
}

export function shouldClearAgentChatSession(result: SchedulingAgentResult): boolean {
  if (result.toolCalls.length === 0) return false;
  const successful = result.toolCalls.filter((t) => t.result.ok);
  if (successful.length === 0) return false;
  if (successful.every((t) => isAlreadyProtectedToolResult(t.result.data))) return false;
  return successful.some((t) => !isAlreadyProtectedToolResult(t.result.data));
}

async function persistAgentSession(
  userId: string,
  userMessage: string,
  result: SchedulingAgentResult,
): Promise<void> {
  if (shouldClearAgentChatSession(result)) {
    await clearAgentChatSession(userId).catch(() => undefined);
    return;
  }
  if (!result.reply.trim() || result.reply === WARM_REDIRECT_MESSAGE) {
    return;
  }
  await appendAgentChatTurn(userId, userMessage, result.reply).catch(() => undefined);
}

export async function runSchedulingAgent(
  userMessage: string,
  params: { userId: string; requestId: string; timezone?: string },
  history: AgentMessage[] = [],
  options: SchedulingAgentOptions = {},
): Promise<SchedulingAgentResult> {
  const built = await resolveBuiltContext(params, options);
  const model = options.model ?? config.agentModel;

  const agentCtx: AgentContext = {
    userId: built.userId,
    requestId: built.requestId,
    timezone: built.timezone,
    cal: built.cal,
    policy: built.policy,
    conversationContext: built.conversationContext,
  };

  const chatHistory =
    history.length > 0 ? history : await getAgentChatHistory(params.userId);

  const prefilter = await runAgentPrefilter(userMessage, agentCtx, model, chatHistory);
  if (prefilter.bypassed) {
    await persistAgentSession(params.userId, userMessage, prefilter);
    return {
      reply: prefilter.reply,
      toolCalls: prefilter.toolCalls,
      rounds: prefilter.rounds,
      trace: prefilter.trace,
    };
  }

  const maxRounds = options.maxRounds ?? MAX_AGENT_ROUNDS;

  try {
    const primary = await runAgentLoop(userMessage, params, chatHistory, options, built, false);

    const exhausted = primary.rounds >= maxRounds;
    const weakReply = !primary.reply.trim() || primary.reply === 'I need a bit more information to continue.';
    const failedTools = primary.toolCalls.length > 0 && primary.toolCalls.every((t) => !t.result.ok);

    if (exhausted && (weakReply || failedTools)) {
      const escalated = await runAgentLoop(userMessage, params, chatHistory, options, built, true);
      if (escalated.reply.trim()) {
        await persistAgentSession(params.userId, userMessage, escalated);
        return escalated;
      }
    }

    await persistAgentSession(params.userId, userMessage, primary);
    return primary;
  } catch {
    return llmUnavailableResult(model);
  }
}
