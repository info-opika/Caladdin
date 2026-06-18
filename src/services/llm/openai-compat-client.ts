import { config } from '../../config.js';
import type {
  LlmClient,
  LlmCompleteRequest,
  LlmCompleteResponse,
  LlmMessage,
  LlmStreamEvent,
  LlmToolCall,
} from './types.js';

type OpenAiChatCompletion = {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
    };
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: 'function';
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string;
  }>;
};

function toApiMessages(system: string, messages: LlmMessage[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'tool') {
      out.push({ role: 'tool', tool_call_id: m.tool_call_id, content: m.content });
    } else if (m.role === 'assistant' && 'tool_calls' in m && m.tool_calls?.length) {
      out.push({
        role: 'assistant',
        content: m.content ?? null,
        tool_calls: m.tool_calls,
      });
    } else if (m.role === 'user' || m.role === 'assistant') {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
}

function mapFinishReason(raw: string | undefined): LlmCompleteResponse['finishReason'] {
  if (raw === 'tool_calls') return 'tool_calls';
  if (raw === 'length') return 'length';
  if (raw === 'stop') return 'stop';
  return 'error';
}

function buildRequestBody(req: LlmCompleteRequest, stream: boolean): Record<string, unknown> {
  return {
    model: req.model,
    messages: toApiMessages(req.system, req.messages),
    tools: req.tools,
    tool_choice: 'auto' as const,
    max_tokens: req.maxTokens ?? 1024,
    temperature: req.temperature ?? config.llmTemperature,
    parallel_tool_calls: req.parallelToolCalls ?? config.parallelToolCalls,
    stream,
  };
}

function parseResponseHeaders(res: Response): Pick<LlmCompleteResponse, 'routedVia' | 'fallbackAttempts'> {
  const routedVia = res.headers.get('X-Routed-Via') ?? undefined;
  const fallbackRaw = res.headers.get('X-Fallback-Attempts');
  const fallbackAttempts =
    fallbackRaw !== null && fallbackRaw !== '' ? Number.parseInt(fallbackRaw, 10) : undefined;
  return {
    routedVia,
    fallbackAttempts: Number.isFinite(fallbackAttempts) ? fallbackAttempts : undefined,
  };
}

function mapToolCalls(
  raw?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>,
): LlmToolCall[] {
  return (raw ?? []).map((tc) => ({
    id: tc.id,
    type: 'function' as const,
    function: { name: tc.function.name, arguments: tc.function.arguments },
  }));
}

function choiceToResponse(
  choice: NonNullable<OpenAiChatCompletion['choices']>[number],
  meta: Pick<LlmCompleteResponse, 'routedVia' | 'fallbackAttempts'>,
): LlmCompleteResponse {
  const msg = choice.message;
  const text = (msg?.content ?? '').trim();
  const toolCalls = mapToolCalls(msg?.tool_calls);
  return {
    text,
    toolCalls,
    finishReason: toolCalls.length > 0 ? 'tool_calls' : mapFinishReason(choice.finish_reason),
    ...meta,
  };
}

function mergeStreamToolCalls(
  accumulated: Map<number, LlmToolCall>,
  deltaCalls: NonNullable<NonNullable<OpenAiChatCompletion['choices']>[number]['delta']>['tool_calls'],
): void {
  for (const dc of deltaCalls ?? []) {
    const idx = dc.index ?? 0;
    const existing = accumulated.get(idx) ?? {
      id: dc.id ?? `call_${idx}`,
      type: 'function' as const,
      function: { name: '', arguments: '' },
    };
    if (dc.id) existing.id = dc.id;
    if (dc.function?.name) existing.function.name += dc.function.name;
    if (dc.function?.arguments) existing.function.arguments += dc.function.arguments;
    accumulated.set(idx, existing);
  }
}

async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
  meta: Pick<LlmCompleteResponse, 'routedVia' | 'fallbackAttempts'>,
): AsyncGenerator<LlmStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  const toolCallsByIndex = new Map<number, LlmToolCall>();
  let finishReason: LlmCompleteResponse['finishReason'] = 'stop';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let lineBreak = buffer.indexOf('\n');
    while (lineBreak >= 0) {
      const line = buffer.slice(0, lineBreak).trim();
      buffer = buffer.slice(lineBreak + 1);

      if (line.startsWith('data:')) {
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') {
          const toolCalls = [...toolCallsByIndex.entries()]
            .sort(([a], [b]) => a - b)
            .map(([, tc]) => tc);
          yield {
            type: 'done',
            response: {
              text: text.trim(),
              toolCalls,
              finishReason: toolCalls.length > 0 ? 'tool_calls' : finishReason,
              ...meta,
            },
          };
          return;
        }

        try {
          const json = JSON.parse(payload) as OpenAiChatCompletion;
          const choice = json.choices?.[0];
          const delta = choice?.delta;
          if (delta?.content) {
            text += delta.content;
            yield { type: 'delta', text: delta.content };
          }
          if (delta?.tool_calls) {
            mergeStreamToolCalls(toolCallsByIndex, delta.tool_calls);
          }
          if (choice?.finish_reason) {
            finishReason = mapFinishReason(choice.finish_reason);
          }
        } catch {
          // ignore malformed SSE chunks
        }
      }

      lineBreak = buffer.indexOf('\n');
    }
  }

  const toolCalls = [...toolCallsByIndex.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, tc]) => tc);
  yield {
    type: 'done',
    response: {
      text: text.trim(),
      toolCalls,
      finishReason: toolCalls.length > 0 ? 'tool_calls' : finishReason,
      ...meta,
    },
  };
}

export function createOpenAiCompatClient(opts?: {
  baseUrl?: string;
  apiKey?: string;
  fetchFn?: typeof fetch;
}): LlmClient {
  const baseUrl = (opts?.baseUrl ?? config.freellmapiBaseUrl).replace(/\/$/, '');
  const apiKey = opts?.apiKey ?? config.freellmapiApiKey;
  const fetchFn = opts?.fetchFn ?? fetch;

  async function postChat(req: LlmCompleteRequest, stream: boolean): Promise<Response> {
    return fetchFn(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Session-Id': req.sessionId,
      },
      body: JSON.stringify(buildRequestBody(req, stream)),
    });
  }

  return {
    async complete(req: LlmCompleteRequest): Promise<LlmCompleteResponse> {
      const res = await postChat(req, false);

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`FreeLLMAPI ${res.status}: ${errText.slice(0, 500)}`);
      }

      const meta = parseResponseHeaders(res);
      const json = (await res.json()) as OpenAiChatCompletion;
      const choice = json.choices?.[0];
      if (!choice) {
        return { text: '', toolCalls: [], finishReason: 'error', ...meta };
      }
      return choiceToResponse(choice, meta);
    },

    async *completeStream(req: LlmCompleteRequest): AsyncGenerator<LlmStreamEvent> {
      const res = await postChat(req, true);

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`FreeLLMAPI ${res.status}: ${errText.slice(0, 500)}`);
      }

      if (!res.body) {
        throw new Error('FreeLLMAPI stream: empty body');
      }

      const meta = parseResponseHeaders(res);
      yield* parseSseStream(res.body, meta);
    },
  };
}
