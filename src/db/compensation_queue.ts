import { getSupabase } from './client.js';

export async function enqueueCompensation(entry: {
  userId: string;
  operation: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  const { error } = await getSupabase().from('compensation_queue').insert({
    user_id: entry.userId,
    operation: entry.operation,
    payload: entry.payload,
    next_retry_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export async function pollCompensationBatch(limit = 10): Promise<Record<string, unknown>[]> {
  const { data, error } = await getSupabase()
    .from('compensation_queue')
    .select('*')
    .lte('next_retry_at', new Date().toISOString())
    .lt('attempts', 10)
    .order('created_at')
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function markCompensationAttempt(id: string, attempts: number): Promise<void> {
  const nextRetry = new Date(Date.now() + Math.min(attempts * 60000, 3600000)).toISOString();
  const { error } = await getSupabase()
    .from('compensation_queue')
    .update({ attempts, next_retry_at: nextRetry })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteCompensation(id: string): Promise<void> {
  const { error } = await getSupabase().from('compensation_queue').delete().eq('id', id);
  if (error) throw error;
}

export async function checkIdempotency(keyHash: string): Promise<boolean> {
  const { data, error } = await getSupabase()
    .from('idempotency_keys')
    .select('key_hash')
    .eq('key_hash', keyHash)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

export async function storeIdempotency(entry: {
  keyHash: string;
  userId: string;
  intent: string;
  bucket5min: string;
}): Promise<void> {
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const { error } = await getSupabase().from('idempotency_keys').upsert({
    key_hash: entry.keyHash,
    user_id: entry.userId,
    intent: entry.intent,
    bucket_5min: entry.bucket5min,
    expires_at: expiresAt,
  });
  if (error) throw error;
}
