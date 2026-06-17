import Anthropic from '@anthropic-ai/sdk';
import type {
  Message,
  MessageParam,
  Tool,
  ToolResultBlockParam,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources/messages/messages.mjs';
import { config } from '../config.js';
import { buildAgentContext } from './context-builder.js';
import { buildSchedulingSystemPrompt } from './prompts/system.js';
import { buildAnthropicToolDefinitions, executeAgentTool } from './tools/registry.js';
import type {
  AgentContext,
  AgentMessage,
  AgentTrace,
  SchedulingAgentResult,
  ToolResult,
} from './types.js';

export const DEFAULT_AGENT_MODEL = 'claude-sonnet-4-20250514';
export const MAX_AGENT_ROUNDS = 5;

export type AnthropicMessagesClient = {
  create: Anthropic['messages']['create'];
};

export type SchedulingAgentOptions = {
  anthropic?: AnthropicMessagesClient;
  model?: string;
  maxRounds?: number;
  prebuiltContext?: AgentContext & { systemContextBlock?: string };
};

function extractText(message: Message): string {
  const parts: string[] = [];
  for (const block of message.content) {
    if (block.type === 'text') {
      parts.push(block.text);
    }
  }
  return parts.join('\n').trim();
}

function toolUseBlocks(message: Message): ToolUseBlock[] {
  return message.content.filter((b): b is ToolUseBlock => b.type === 'tool_use');
}

export async function runSchedulingAgent(
  userMessage: string,
  params: { userId: string; requestId: string; timezone?: string },
  history: AgentMessage[] = [],
  options: SchedulingAgentOptions = {},
): Promise<SchedulingAgentResult> {
  const built = options.prebuiltContext
    ? {
        ...options.prebuiltContext,
        systemContextBlock:
          options.prebuiltContext.systemContextBlock ??
          '',
      }
    : await buildAgentContext(params);

  const system = buildSchedulingSystemPrompt(built.systemContextBlock);
  const tools = buildAnthropicToolDefinitions() as Tool[];
  const defaultAnthropic = new Anthropic({ apiKey: config.anthropicApiKey || 'sk-placeholder' });
  const client: AnthropicMessagesClient =
    options.anthropic ?? { create: defaultAnthropic.messages.create.bind(defaultAnthropic.messages) };
  const model = options.model ?? process.env.ANTHROPIC_AGENT_MODEL ?? DEFAULT_AGENT_MODEL;
  const maxRounds = options.maxRounds ?? MAX_AGENT_ROUNDS;

  const messages: MessageParam[] = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ];

  const toolCalls: SchedulingAgentResult['toolCalls'] = [];
  const toolTrace: AgentTrace['tools'] = [];
  let rounds = 0;
  let lastReply = '';
  const startedAt = Date.now();

  const agentCtx: AgentContext = {
    userId: built.userId,
    requestId: built.requestId,
    timezone: built.timezone,
    cal: built.cal,
    policy: built.policy,
    conversationContext: built.conversationContext,
  };

  while (rounds < maxRounds) {
    rounds += 1;

    const response = await client.create({
      model,
      max_tokens: 1024,
      system,
      tools,
      messages,
    });

    lastReply = extractText(response);

    const uses = toolUseBlocks(response);
    if (response.stop_reason !== 'tool_use' || uses.length === 0) {
      return {
        reply: lastReply,
        toolCalls,
        rounds,
        trace: { model, rounds, totalLatencyMs: Date.now() - startedAt, tools: toolTrace },
      };
    }

    messages.push({ role: 'assistant', content: response.content });

    const toolResultBlocks: ToolResultBlockParam[] = [];

    for (const use of uses) {
      const toolStarted = Date.now();
      const result: ToolResult = await executeAgentTool(use.name, use.input, agentCtx);
      toolTrace.push({
        name: use.name,
        latencyMs: Date.now() - toolStarted,
        ok: result.ok,
      });
      toolCalls.push({ name: use.name, input: use.input, result });

      toolResultBlocks.push({
        type: 'tool_result',
        tool_use_id: use.id,
        content: JSON.stringify(result),
        is_error: !result.ok,
      });
    }

    messages.push({ role: 'user', content: toolResultBlocks });
  }

  return {
    reply: lastReply || 'I need a bit more information to continue.',
    toolCalls,
    rounds,
    trace: { model, rounds, totalLatencyMs: Date.now() - startedAt, tools: toolTrace },
  };
}
