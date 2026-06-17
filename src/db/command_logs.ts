import { getSupabase } from './client.js';

export type CommandInputMode = 'text' | 'voice';

export type AgentToolTraceEntry = {
  name: string;
  latencyMs: number;
  ok: boolean;
};

/** Persisted on command_logs.agent_trace for agent-path /voice requests. */
export type AgentTrace = {
  model: string;
  rounds: number;
  totalLatencyMs: number;
  tools: AgentToolTraceEntry[];
};

export interface CommandLogRow {
  id: string;
  user_id: string;
  raw_input: string;
  input_mode: CommandInputMode;
  parsed_intent: string | null;
  parsed_params: Record<string, unknown>;
  agent_trace: AgentTrace | null;
  confirmed: boolean;
  resulting_action_id: string | null;
  created_at: string;
}

export async function insertCommandLog(entry: {
  userId: string;
  rawInput: string;
  inputMode?: CommandInputMode;
}): Promise<string> {
  const { data, error } = await getSupabase()
    .from('command_logs')
    .insert({
      user_id: entry.userId,
      raw_input: entry.rawInput,
      input_mode: entry.inputMode ?? 'text',
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

export async function updateCommandLogParsed(
  id: string,
  parsed: { intent: string; params: Record<string, unknown> },
): Promise<void> {
  const { error } = await getSupabase()
    .from('command_logs')
    .update({
      parsed_intent: parsed.intent,
      parsed_params: parsed.params,
    })
    .eq('id', id);
  if (error) throw error;
}

export async function markCommandLogConfirmed(
  id: string,
  resultingActionId?: string,
): Promise<void> {
  const { error } = await getSupabase()
    .from('command_logs')
    .update({
      confirmed: true,
      ...(resultingActionId ? { resulting_action_id: resultingActionId } : {}),
    })
    .eq('id', id);
  if (error) throw error;
}

export async function updateCommandLogAgentTrace(
  id: string,
  trace: AgentTrace,
): Promise<void> {
  const { error } = await getSupabase()
    .from('command_logs')
    .update({ agent_trace: trace })
    .eq('id', id);
  if (error) throw error;
}
