import { createHash } from 'crypto';
import { getSupabase } from './client.js';

export async function insertAuditLog(entry: {
  userId: string;
  intent: string;
  outcome: string;
  eventsAffected?: number;
  requestId?: string;
  metadata?: Record<string, unknown>;
  previousState?: unknown;
}): Promise<void> {
  const { error } = await getSupabase().from('audit_log').insert({
    user_id: entry.userId,
    intent: entry.intent,
    outcome: entry.outcome,
    events_affected: entry.eventsAffected ?? 0,
    request_id: entry.requestId,
    metadata: entry.metadata ?? {},
    previous_state: entry.previousState ?? null,
  });
  if (error) throw error;
}

export async function getLastAuditForUser(userId: string, intent?: string): Promise<Record<string, unknown> | null> {
  let q = getSupabase().from('audit_log').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(1);
  if (intent) q = q.eq('intent', intent);
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  return data;
}

export function hashPayload(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
