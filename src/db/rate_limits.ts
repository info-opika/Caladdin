import { getSupabase } from './client.js';

interface MemoryEvent {
  bucket_key: string;
  created_at: number;
}

const memoryEvents: MemoryEvent[] = [];

function useMemoryStore(): boolean {
  return process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
}

function pruneMemoryEvents(bucketKey: string, windowStartMs: number): void {
  for (let i = memoryEvents.length - 1; i >= 0; i -= 1) {
    const ev = memoryEvents[i]!;
    if (ev.bucket_key === bucketKey && ev.created_at < windowStartMs) {
      memoryEvents.splice(i, 1);
    }
  }
}

async function checkMemoryRateLimit(
  bucketKey: string,
  maxRequests: number,
  windowMs: number,
): Promise<{ allowed: boolean; retryAfterMs?: number }> {
  const now = Date.now();
  const windowStartMs = now - windowMs;
  pruneMemoryEvents(bucketKey, windowStartMs);

  const inWindow = memoryEvents.filter(
    (ev) => ev.bucket_key === bucketKey && ev.created_at >= windowStartMs,
  );

  if (inWindow.length >= maxRequests) {
    const oldest = inWindow.reduce((min, ev) => (ev.created_at < min ? ev.created_at : min), inWindow[0]!.created_at);
    return { allowed: false, retryAfterMs: Math.max(1, windowMs - (now - oldest)) };
  }

  memoryEvents.push({ bucket_key: bucketKey, created_at: now });
  return { allowed: true };
}

async function checkDbRateLimit(
  bucketKey: string,
  maxRequests: number,
  windowMs: number,
): Promise<{ allowed: boolean; retryAfterMs?: number }> {
  const now = Date.now();
  const windowStart = new Date(now - windowMs).toISOString();

  const { count, error: countError } = await getSupabase()
    .from('rate_limit_events')
    .select('*', { count: 'exact', head: true })
    .eq('bucket_key', bucketKey)
    .gte('created_at', windowStart);

  if (countError) throw new Error(`Rate limit count failed: ${countError.message}`);

  const current = count ?? 0;
  if (current >= maxRequests) {
    const { data: oldest, error: oldestError } = await getSupabase()
      .from('rate_limit_events')
      .select('created_at')
      .eq('bucket_key', bucketKey)
      .gte('created_at', windowStart)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (oldestError) throw new Error(`Rate limit oldest lookup failed: ${oldestError.message}`);

    const oldestMs = oldest?.created_at ? new Date(oldest.created_at as string).getTime() : now;
    return { allowed: false, retryAfterMs: Math.max(1, windowMs - (now - oldestMs)) };
  }

  const { error: insertError } = await getSupabase()
    .from('rate_limit_events')
    .insert({ bucket_key: bucketKey });

  if (insertError) throw new Error(`Rate limit insert failed: ${insertError.message}`);

  return { allowed: true };
}

export async function checkDistributedRateLimit(
  bucketKey: string,
  maxRequests: number,
  windowMs: number,
): Promise<{ allowed: boolean; retryAfterMs?: number }> {
  if (useMemoryStore()) {
    return checkMemoryRateLimit(bucketKey, maxRequests, windowMs);
  }
  return checkDbRateLimit(bucketKey, maxRequests, windowMs);
}

export async function resetDistributedRateLimit(bucketKey: string): Promise<void> {
  if (useMemoryStore()) {
    for (let i = memoryEvents.length - 1; i >= 0; i -= 1) {
      if (memoryEvents[i]!.bucket_key === bucketKey) {
        memoryEvents.splice(i, 1);
      }
    }
    return;
  }

  const { error } = await getSupabase().from('rate_limit_events').delete().eq('bucket_key', bucketKey);
  if (error) throw new Error(`Rate limit reset failed: ${error.message}`);
}

/** Test helper — clear in-memory rate limit state between tests. */
export function resetRateLimitsForTests(): void {
  memoryEvents.length = 0;
}
