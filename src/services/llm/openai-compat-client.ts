import { config } from '../../config.js';
import type {
  LlmClient,
  LlmCompleteRequest,
  LlmCompleteResponse,
  LlmMessage,
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

export function createOpenAiCompatClient(opts?: {
  baseUrl?: string;
  apiKey?: string;
  fetchFn?: typeof fetch;
}): LlmClient {
  const baseUrl = (opts?.baseUrl ?? config.freellmapiBaseUrl).replace(/\/$/, '');
  const apiKey = opts?.apiKey ?? config.freellmapiApiKey;
  const fetchFn = opts?.fetchFn ?? fetch;

  return {
    async complete(req: LlmCompleteRequest): Promise<LlmCompleteResponse> {
      const body = {
        model: req.model,
        messages: toApiMessages(req.system, req.messages),
        tools: req.tools,
        tool_choice: 'auto' as const,
        max_tokens: req.maxTokens ?? 1024,
        temperature: req.temperature ?? config.llmTemperature,
        parallel_tool_calls: req.parallelToolCalls ?? config.parallelToolCalls,
        stream: false,
      };

      const res = await fetchFn(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'X-Session-Id': req.sessionId,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`FreeLLMAPI ${res.status}: ${errText.slice(0, 500)}`);
      }

      const routedVia = res.headers.get('X-Routed-Via') ?? undefined;
      const fallbackRaw = res.headers.get('X-Fallback-Attempts');
      const fallbackAttempts =
        fallbackRaw !== null && fallbackRaw !== '' ? Number.parseInt(fallbackRaw, 10) : undefined;

      const json = (await res.json()) as OpenAiChatCompletion;
      const choice = json.choices?.[0];
      const msg = choice?.message;
      const text = (msg?.content ?? '').trim();

      const toolCalls: LlmToolCall[] = (msg?.tool_calls ?? []).map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.function.name, arguments: tc.function.arguments },
      }));

      return {
        text,
        toolCalls,
        finishReason: toolCalls.length > 0 ? 'tool_calls' : mapFinishReason(choice?.finish_reason),
        routedVia,
        fallbackAttempts: Number.isFinite(fallbackAttempts) ? fallbackAttempts : undefined,
      };
    },
  };
}
