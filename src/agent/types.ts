import type { calendar_v3 } from 'googleapis';
import type { ConversationContext } from '../db/conversation-context.js';
import type { UserPolicyProfile } from '../core/adts.js';

export type SlotSource = 'mutual' | 'host-only';

export type AvailabilityScope = 'host' | 'mutual' | 'host-only';

export type ToolHonesty = {
  mutualChecked: boolean;
  slotSource: SlotSource;
};

export type ToolResult<T = unknown> = {
  ok: boolean;
  data?: T;
  error?: string;
  honesty?: ToolHonesty;
};

export type AgentContext = {
  userId: string;
  requestId: string;
  timezone: string;
  cal: calendar_v3.Calendar | null;
  policy: UserPolicyProfile;
  conversationContext?: ConversationContext | null;
};

export type AgentMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type AgentToolTraceEntry = {
  name: string;
  latencyMs: number;
  ok: boolean;
};

export type AgentTrace = {
  model: string;
  rounds: number;
  totalLatencyMs: number;
  tools: AgentToolTraceEntry[];
  sessionId?: string;
  toolSubset?: string[];
  routedViaRounds?: string[];
  requestedModel?: string;
  prefilterBypass?: boolean;
  fallbackAttempts?: number;
};

export type SchedulingAgentResult = {
  reply: string;
  toolCalls: Array<{ name: string; input: unknown; result: ToolResult }>;
  rounds: number;
  trace: AgentTrace;
};
