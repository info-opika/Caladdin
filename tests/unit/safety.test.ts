import { describe, it, expect, afterEach } from 'vitest';
import { validateUserId, validateUtterance } from '../../src/core/safety.js';
import { createRateLimiter } from '../../src/core/rate-limiter.js';
import { config } from '../../src/config.js';

describe('safety', () => {
  it('rejects invalid UUID', () => {
    expect(validateUserId('not-a-uuid').valid).toBe(false);
    expect(validateUserId('admin').valid).toBe(false);
  });

  it('accepts valid UUID', () => {
    expect(validateUserId('77a22c75-4e6b-47ca-aee6-2f4ace21be53').valid).toBe(true);
  });

  it('rejects utterance over max length', () => {
    const r = validateUtterance('a'.repeat(1001), config.utteranceMaxLength);
    expect(r.valid).toBe(false);
    expect(r.error).toContain('too long');
  });

  it('rate limiter blocks 6th request', () => {
    const limiter = createRateLimiter(5, 60000);
    const uid = '77a22c75-4e6b-47ca-aee6-2f4ace21be53';
    for (let i = 0; i < 5; i++) {
      expect(limiter.check(uid).allowed).toBe(true);
    }
    const sixth = limiter.check(uid);
    expect(sixth.allowed).toBe(false);
    expect(sixth.retryAfterMs).toBeDefined();
    limiter.reset(uid);
  });
});
