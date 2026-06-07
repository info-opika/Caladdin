import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/core/rate-limiter.js', () => ({
  globalRateLimiter: { check: vi.fn().mockResolvedValue({ allowed: true }) },
}));

vi.mock('../../src/db/events.js', () => ({
  listEvents: vi.fn().mockResolvedValue([
    { status: 'confirmed' },
    { status: 'cancelled' },
    { status: 'confirmed' },
  ]),
}));

import {
  validateUser,
  checkMutation,
  checkRateLimit,
  computeBlastRadius,
  requiresConfirmationForTier,
  preflightSafety,
  isMutationIntent,
} from '../../src/core/safety.js';

describe('safety mutations and preflight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('validateUser throws on bad ids', () => {
    expect(() => validateUser('')).toThrow(/Invalid user ID/);
    expect(validateUser('11111111-1111-4111-8111-111111111111')).toBe(
      '11111111-1111-4111-8111-111111111111',
    );
  });

  it('checkMutation blocks tier 0 and tier 1 destructive', () => {
    const profile = { userId: 'u1' } as import('../../src/core/adts.js').UserPolicyProfile;
    expect(checkMutation('MODIFY_EVENT', { tier: 0 } as never, profile).allowed).toBe(false);
    expect(checkMutation('FLUSH_RANGE', { tier: 1 } as never, profile).requiresConfirmation).toBe(true);
    expect(checkMutation('CREATE_EVENT', { tier: 2 } as never, profile).allowed).toBe(true);
  });

  it('checkRateLimit skips non-mutation intents', async () => {
    expect(await checkRateLimit('u1', 'QUERY_CALENDAR')).toEqual({ allowed: true });
  });

  it('computeBlastRadius counts non-cancelled events', async () => {
    const n = await computeBlastRadius('u1', '2026-06-01', '2026-06-30');
    expect(n).toBe(2);
  });

  it('requiresConfirmationForTier follows tier rules', () => {
    expect(requiresConfirmationForTier(0, false)).toBe(true);
    expect(requiresConfirmationForTier(1, true)).toBe(true);
    expect(requiresConfirmationForTier(2, true)).toBe(false);
  });

  it('preflightSafety flags large flush and destructive prefilter', async () => {
    const flush = await preflightSafety(
      { intent: 'FLUSH_RANGE', params: {}, confidence: 0.9, mappingMethod: 'direct', rawUtterance: 'clear week' },
      'u1',
      6,
    );
    expect(flush.requiresConfirmation).toBe(true);

    const destructive = await preflightSafety(
      {
        intent: 'MODIFY_EVENT',
        params: { tier: 0 },
        confidence: 0.9,
        mappingMethod: 'direct',
        rawUtterance: 'move sacred block',
        _destructivePreFilter: true,
      },
      'u1',
    );
    expect(destructive.requiresConfirmation).toBe(true);
  });

  it('isMutationIntent identifies write intents', () => {
    expect(isMutationIntent('CREATE_EVENT')).toBe(true);
    expect(isMutationIntent('QUERY_CALENDAR')).toBe(false);
  });
});
