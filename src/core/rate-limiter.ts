import { config } from '../config.js';
import { checkDistributedRateLimit, resetDistributedRateLimit } from '../db/rate_limits.js';

interface WindowEntry {
  count: number;
  windowStart: number;
}

/** Synchronous in-memory limiter for unit tests (legacy). */
export function createRateLimiter(maxRequests: number, windowMs: number) {
  const windows = new Map<string, WindowEntry>();

  return {
    check(userId: string): { allowed: boolean; retryAfterMs?: number } {
      const now = Date.now();
      const entry = windows.get(userId);
      if (!entry || now - entry.windowStart >= windowMs) {
        windows.set(userId, { count: 1, windowStart: now });
        return { allowed: true };
      }
      if (entry.count >= maxRequests) {
        const retryAfterMs = windowMs - (now - entry.windowStart);
        return { allowed: false, retryAfterMs };
      }
      entry.count += 1;
      return { allowed: true };
    },
    reset(userId: string): void {
      windows.delete(userId);
    },
  };
}

export interface PersistentRateLimiter {
  check(key: string): Promise<{ allowed: boolean; retryAfterMs?: number }>;
  reset(key: string): Promise<void>;
}

export function createPersistentRateLimiter(
  maxRequests: number,
  windowMs: number,
  bucketPrefix = '',
): PersistentRateLimiter {
  return {
    check(key: string) {
      return checkDistributedRateLimit(`${bucketPrefix}${key}`, maxRequests, windowMs);
    },
    reset(key: string) {
      return resetDistributedRateLimit(`${bucketPrefix}${key}`);
    },
  };
}

/** Intent mutation limit — 20/hr per user (Postgres-backed in production). */
export const globalRateLimiter = createPersistentRateLimiter(
  config.rateLimitMax,
  config.rateLimitWindowMs,
  'mut:',
);

/** HTTP POST /voice — per userId. */
export const voiceHttpRateLimiter = createPersistentRateLimiter(
  config.voiceHttpRateLimitMax,
  config.voiceHttpRateLimitWindowMs,
  'voice:',
);

/** HTTP POST /s/:token/select — per scheduling token. */
export const bookingSelectRateLimiter = createPersistentRateLimiter(
  config.bookingSelectRateLimitMax,
  config.bookingSelectRateLimitWindowMs,
  'book:',
);
