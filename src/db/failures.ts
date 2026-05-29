import { getSupabase } from './client.js';

export async function insertFailureLog(entry: {
  userId?: string | null;
  rawUtterance?: string;
  attemptedIntent?: string | null;
  confidence?: number | null;
  failureReason?: string;
  requestId?: string;
}): Promise<void> {
  const { error } = await getSupabase().from('failure_logs').insert({
    user_id: entry.userId ?? null,
    raw_utterance: entry.rawUtterance,
    attempted_intent: entry.attemptedIntent ?? null,
    confidence: entry.confidence ?? null,
    failure_reason: entry.failureReason,
    request_id: entry.requestId,
  });
  if (error) throw error;
}

export async function listFailuresSince(since: Date): Promise<Record<string, unknown>[]> {
  const { data, error } = await getSupabase()
    .from('failure_logs')
    .select('*')
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}
