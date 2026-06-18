import { vi } from 'vitest';
import type { LlmClient, LlmCompleteRequest, LlmCompleteResponse } from '../../src/services/llm/types.js';

export type MockLlmStep = {
  text?: string;
  toolCalls?: Array<{ id: string; name: string; input: unknown }>;
  routedVia?: string;
  fallbackAttempts?: number;
};

export function mockLlmClient(sequence: MockLlmStep[]): LlmClient {
  let call = 0;
  return {
    complete: vi.fn(async (_req: LlmCompleteRequest): Promise<LlmCompleteResponse> => {
      const step = sequence[call] ?? sequence[sequence.length - 1]!;
      call += 1;
      const toolCalls = (step.toolCalls ?? []).map((t) => ({
        id: t.id,
        type: 'function' as const,
        function: { name: t.name, arguments: JSON.stringify(t.input) },
      }));
      return {
        text: step.text ?? '',
        toolCalls,
        finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
        routedVia: step.routedVia,
        fallbackAttempts: step.fallbackAttempts,
      };
    }),
  };
}
