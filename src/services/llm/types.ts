export type LlmMessage =
  | { role: 'user' | 'assistant'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: LlmToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export type LlmToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

export type OpenAiToolDefinition = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type LlmCompleteRequest = {
  model: string;
  system: string;
  messages: LlmMessage[];
  tools: OpenAiToolDefinition[];
  maxTokens?: number;
  temperature?: number;
  sessionId: string;
  parallelToolCalls?: boolean;
};

export type LlmCompleteResponse = {
  text: string;
  toolCalls: LlmToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
  routedVia?: string;
  fallbackAttempts?: number;
};

export type LlmClient = {
  complete(req: LlmCompleteRequest): Promise<LlmCompleteResponse>;
};
