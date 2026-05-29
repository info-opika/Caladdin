import { config } from '../config.js';

interface WindowEntry {
  count: number;
  windowStart: number;
}

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

export const globalRateLimiter = createRateLimiter(config.rateLimitMax, config.rateLimitWindowMs);
