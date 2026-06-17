import { describe, it, expect } from 'vitest';
import { preflightSafety, requiresConfirmationForTier, validateUserId, validateUtterance } from '../../src/core/safety.js';
import type { ParsedIntent } from '../../src/core/adts.js';

function parsed(intent: ParsedIntent['intent'], params: Record<string, unknown> = {}): ParsedIntent {
  return {
    intent,
    confidence: 0.95,
    rawUtterance: 'test utterance',
    mappingMethod: 'direct',
    params,
  };
}

describe('Safety — preflightSafety', () => {
  it('requires confirmation for FLUSH_RANGE', async () => {
    const result = await preflightSafety(parsed('FLUSH_RANGE', { tier: 1 }), '8b616ceb-7e77-4886-9361-92a534374fac');
    expect(result.requiresConfirmation).toBe(true);
    expect(result.blocked).toBe(false);
  });

  it('requires confirmation for destructive Tier 0 mutations', async () => {
    const result = await preflightSafety(
      { ...parsed('MODIFY_EVENT', { tier: 0 }), _destructivePreFilter: true },
      '8b616ceb-7e77-4886-9361-92a534374fac',
    );
    expect(result.requiresConfirmation).toBe(true);
    expect(result.blocked).toBe(false);
  });

  it('requires confirmation for PROTECT_BLOCK writes', async () => {
    const result = await preflightSafety(parsed('PROTECT_BLOCK', { tier: 2 }), '8b616ceb-7e77-4886-9361-92a534374fac');
    expect(result.requiresConfirmation).toBe(true);
    expect(result.blocked).toBe(false);
  });
});

describe('Safety — validation helpers', () => {
  it('accepts valid UUID user ID', () => {
    expect(validateUserId('8b616ceb-7e77-4886-9361-92a534374fac')).toEqual({ valid: true });
  });

  it('rejects invalid user IDs', () => {
    expect(validateUserId('')).toEqual({ valid: false, error: 'Invalid user ID' });
    expect(validateUserId('not-a-uuid')).toEqual({ valid: false, error: 'Invalid user ID' });
  });

  it('validates utterance presence and max length', () => {
    expect(validateUtterance('Schedule lunch', 200)).toEqual({ valid: true });
    expect(validateUtterance('   ', 200)).toEqual({ valid: false, error: 'Utterance is required' });
  });
});

describe('Safety — tier confirmation helper', () => {
  it('requires confirmation for tier 0 always', () => {
    expect(requiresConfirmationForTier(0, false)).toBe(true);
    expect(requiresConfirmationForTier(0, true)).toBe(true);
  });

  it('requires confirmation for tier 1 only when destructive', () => {
    expect(requiresConfirmationForTier(1, true)).toBe(true);
    expect(requiresConfirmationForTier(1, false)).toBe(false);
  });

  it('does not require confirmation for tier 2+', () => {
    expect(requiresConfirmationForTier(2, true)).toBe(false);
    expect(requiresConfirmationForTier(3, false)).toBe(false);
  });
});