import { describe, it, expect, beforeEach } from 'vitest';
import { createPersistentRateLimiter } from '../../src/core/rate-limiter.js';
import { resetRateLimitsForTests } from '../../src/db/rate_limits.js';

describe('Distributed rate limiter (P0-07)', () => {
  beforeEach(() => {
    resetRateLimitsForTests();
    process.env.VITEST = 'true';
  });

  it('allows requests up to the limit', async () => {
    const limiter = createPersistentRateLimiter(3, 60_000, 'test:');
    expect((await limiter.check('user1')).allowed).toBe(true);
    expect((await limiter.check('user1')).allowed).toBe(true);
    expect((await limiter.check('user1')).allowed).toBe(true);
  });

  it('blocks at the limit and returns retryAfterMs', async () => {
    const limiter = createPersistentRateLimiter(3, 60_000, 'test:');
    await limiter.check('user2');
    await limiter.check('user2');
    await limiter.check('user2');
    const result = await limiter.check('user2');
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it('resets the bucket', async () => {
    const limiter = createPersistentRateLimiter(1, 60_000, 'test:');
    await limiter.check('user3');
    expect((await limiter.check('user3')).allowed).toBe(false);
    await limiter.reset('user3');
    expect((await limiter.check('user3')).allowed).toBe(true);
  });

  it('tracks limits per key independently (shared backing store)', async () => {
    const limiter = createPersistentRateLimiter(1, 60_000, 'test:');
    await limiter.check('userA');
    expect((await limiter.check('userA')).allowed).toBe(false);
    expect((await limiter.check('userB')).allowed).toBe(true);
  });
});
