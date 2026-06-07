import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ParsedIntentSchema } from '../../../src/core/adts.js';

const mockOffer = vi.fn();
const mockGatekeep = vi.fn();

vi.mock('../../../src/handlers/offer-specific.js', () => ({
  handleOfferSpecific: (...a: unknown[]) => mockOffer(...a),
}));

vi.mock('../../../src/handlers/gatekeep-rule.js', () => ({
  handleGatekeepRule: (...a: unknown[]) => mockGatekeep(...a),
}));

import { handlePivotAsync } from '../../../src/handlers/pivot-async.js';

const ctx = { userId: 'user-1', timezone: 'America/Chicago' };

function parsed(params: Record<string, unknown> = {}, raw = 'test') {
  return ParsedIntentSchema.parse({
    intent: 'PIVOT_ASYNC',
    confidence: 0.9,
    params,
    mappingMethod: 'direct',
    rawUtterance: raw,
  });
}

describe('handlePivotAsync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOffer.mockResolvedValue({
      intent: 'OFFER_SPECIFIC',
      success: true,
      messageToUser: 'Here are slots.',
      schemaVersion: 1,
    });
    mockGatekeep.mockResolvedValue({
      intent: 'GATEKEEP_RULE',
      success: true,
      messageToUser: 'Blocked contact.',
      schemaVersion: 1,
    });
  });

  it('mode A delegates to offer-specific with decline prefix', async () => {
    const result = await handlePivotAsync(parsed({ mode: 'A' }), ctx, null);
    expect(result.intent).toBe('PIVOT_ASYNC');
    expect(result.messageToUser).toMatch(/Decline noted/i);
    expect(mockOffer).toHaveBeenCalled();
  });

  it('mode C delegates to gatekeep rule', async () => {
    await handlePivotAsync(parsed({ mode: 'C' }), ctx, null);
    expect(mockGatekeep).toHaveBeenCalled();
  });

  it('mode B returns draft decline message', async () => {
    const result = await handlePivotAsync(parsed({ mode: 'B' }), ctx, null);
    expect(result.messageToUser).toMatch(/Decline message drafted/i);
  });

  it('infers reschedule mode from utterance', async () => {
    await handlePivotAsync(parsed({}, 'find another time please'), ctx, null);
    expect(mockOffer).toHaveBeenCalled();
  });
});
