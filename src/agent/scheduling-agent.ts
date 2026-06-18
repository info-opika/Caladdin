import { config } from '../config.js';
import { buildAgentContext, type BuiltAgentContext } from './context-builder.js';
import { buildSchedulingSystemPrompt } from './prompts/system.js';
import { buildOpenAiToolDefinitions, executeAgentTool } from './tools/registry.js';
import { createLlmClient, type LlmClient, type LlmMessage } from '../services/llm/index.js';
import { selectToolsForUtterance } from './tool-pruning.js';
import { checkWrongTool } from './tool-call-guard.js';
import { validateHonestReply } from './honesty-validator.js';
import { runAgentPrefilter } from './agent-prefilter.js';
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
    ? selectToolsForUtterance(userMessage, history)
    : selectToolsForUtterance(userMessage, history);
  const tools = buildOpenAiToolDefinitions(toolNames);
  const system = buildSystemPrompt(built.systemContextBlock, toolNames);

  const messages: LlmMessage[] = [
    ...toOpenAiHistory(history),
    { role: 'user', content: userMessage },
  ];

  const toolCalls: SchedulingAgentResult['toolCalls'] = [];
  const toolTrace: AgentTrace['tools'] = [];
  const routedViaRounds: string[] = [];
  let rounds = 0;
  let lastReply = '';
  const startedAt = Date.now();

  while (rounds < maxRounds) {
    rounds += 1;

    const res = await llm.complete({
      model,
      system,
      messages,
      tools,
      sessionId,
      temperature: config.llmTemperature,
      parallelToolCalls: config.parallelToolCalls,
      maxTokens: 1024,
    });

    if (res.routedVia) routedViaRounds.push(res.routedVia);
    lastReply = res.text;

    if (res.finishReason !== 'tool_calls' || res.toolCalls.length === 0) {
      const honest = validateHonestReply(lastReply, toolCalls);
      return {
        reply: honest,
        toolCalls,
        rounds,
        trace: {
          model,
          rounds,
          totalLatencyMs: Date.now() - startedAt,
          tools: toolTrace,
          sessionId,
          toolSubset: toolNames,
          routedViaRounds,
          requestedModel: model,
        },
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

  const honest = validateHonestReply(
    lastReply || 'I need a bit more information to continue.',
    toolCalls,
  );

  return {
    reply: honest,
    toolCalls,
    rounds,
    trace: {
      model,
      rounds,
      totalLatencyMs: Date.now() - startedAt,
      tools: toolTrace,
      sessionId,
      toolSubset: toolNames,
      routedViaRounds,
      requestedModel: model,
    },
  };
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

  const prefilter = await runAgentPrefilter(userMessage, agentCtx, model);
  if (prefilter.bypassed) {
    return {
      reply: prefilter.reply,
      toolCalls: prefilter.toolCalls,
      rounds: prefilter.rounds,
      trace: prefilter.trace,
    };
  }

  const maxRounds = options.maxRounds ?? MAX_AGENT_ROUNDS;
  const primary = await runAgentLoop(userMessage, params, history, options, built, false);

  const exhausted = primary.rounds >= maxRounds;
  const weakReply = !primary.reply.trim() || primary.reply === 'I need a bit more information to continue.';
  const failedTools = primary.toolCalls.length > 0 && primary.toolCalls.every((t) => !t.result.ok);

  if (exhausted && (weakReply || failedTools)) {
    const escalated = await runAgentLoop(userMessage, params, history, options, built, true);
    if (escalated.reply.trim()) return escalated;
  }

  return primary;
}
