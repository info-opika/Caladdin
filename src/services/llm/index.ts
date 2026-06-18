export type {
  LlmClient,
  LlmMessage,
  LlmToolCall,
  OpenAiToolDefinition,
  LlmCompleteRequest,
  LlmCompleteResponse,
} from './types.js';
export { createOpenAiCompatClient } from './openai-compat-client.js';
import { createOpenAiCompatClient } from './openai-compat-client.js';
import type { LlmClient } from './types.js';

export function createLlmClient(): LlmClient {
  return createOpenAiCompatClient();
}
