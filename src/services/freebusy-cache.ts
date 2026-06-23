import type { calendar_v3 } from 'googleapis';
import { listBusyFromGCal } from './calendar_api.js';

const DEFAULT_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  expiresAt: number;
  busy: Array<{ start: string; end: string }>;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<Array<{ start: string; end: string }>>>();

function cacheKey(calendarUserId: string, timeMin: string, timeMax: string): string {
  return `${calendarUserId}:${timeMin}:${timeMax}`;
}

export function clearFreeBusyCacheForTests(): void {
  cache.clear();
  inflight.clear();
}

export function getFreeBusyCacheStats(): { entries: number; inflight: number } {
  return { entries: cache.size, inflight: inflight.size };
}

/** In-memory GCal free/busy cache with TTL (default 5 min). Dedupes concurrent fetches. */
export async function getCachedBusyFromGCal(
  cal: calendar_v3.Calendar,
  calendarUserId: string,
  timeMin: string,
  timeMax: string,
  ttlMs = DEFAULT_TTL_MS,
): Promise<Array<{ start: string; end: string }>> {
  const key = cacheKey(calendarUserId, timeMin, timeMax);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.busy;
  }

  const pending = inflight.get(key);
  if (pending) return pending;

  const fetchPromise = listBusyFromGCal(cal, timeMin, timeMax, calendarUserId)
    .then((busy) => {
      cache.set(key, { expiresAt: Date.now() + ttlMs, busy });
      return busy;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, fetchPromise);
  return fetchPromise;
}
