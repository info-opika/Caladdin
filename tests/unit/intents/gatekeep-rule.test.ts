import { describe, it, expect, vi, beforeEach } from 'vitest';
import { gatekeepRule } from '../../../src/core/intents/gatekeep-rule.js';
import { type UserPolicyProfile, type ParsedIntent } from '../../../src/core/adts.js';

vi.mock('../../../src/db/policies.js', () => ({
  upsertUserPolicy: vi.fn().mockResolvedValue(undefined),
}));

import { upsertUserPolicy } from '../../../src/db/policies.js';

const BASE_PROFILE: UserPolicyProfile = {
  userId: '8b616ceb-7e77-4886-9361-92a534374fac',
  schemaVersion: 1,
  timezone: 'America/Chicago',
  chronotype: 'morning',
  defaultBufferMinutes: 15,
  clusteringPreference: 'balanced',
  maxFragmentsPerDay: 4,
  faxEffectConfig: {
    targetSlotsPerOffer: 2,
    minBufferMinutes: 15,
    clusteringWeight: 0.35,
    energyWeight: 0.45,
    fragmentPenaltyWeight: 0.15,
    protectDeepWorkBlocks: true,
  },
  protectedBlocks: [],
  contactTiers: {},
};

function makeIntent(params: Record<string, unknown>): ParsedIntent {
  return {
    intent: 'GATEKEEP_RULE',
    confidence: 0.9,
    rawUtterance: 'Treat sarah@enterprise.com as high priority',
    params,
    mappingMethod: 'direct',
  };
}

describe('gatekeepRule intent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('successfully updates contact tier', async () => {
    const result = await gatekeepRule(
      makeIntent({ contact: 'sarah@enterprise.com', tier: 1 }),
      BASE_PROFILE
    );
    expect(result.success).toBe(true);
    expect(upsertUserPolicy).toHaveBeenCalledOnce();
    const updatedProfile = vi.mocked(upsertUserPolicy).mock.calls[0]?.[1];
    expect(updatedProfile?.contactTiers?.['sarah@enterprise.com']).toBe(1);
  });

  it('returns failure when contact is missing', async () => {
    const result = await gatekeepRule(makeIntent({ tier: 1 }), BASE_PROFILE);
    expect(result.success).toBe(false);
    expect(result.failureReason).toBeDefined();
    expect(upsertUserPolicy).not.toHaveBeenCalled();
  });

  it('returns failure when tier is missing', async () => {
    const result = await gatekeepRule(
      makeIntent({ contact: 'someone@company.com' }),
      BASE_PROFILE
    );
    expect(result.success).toBe(false);
    expect(result.failureReason).toBeDefined();
  });

  it('returns full IntentResult shape', async () => {
    const result = await gatekeepRule(
      makeIntent({ contact: 'test@test.com', tier: 2 }),
      BASE_PROFILE
    );
    expect(result.success).toBeDefined();
    expect(result.intent).toBe('GATEKEEP_RULE');
    expect(result.requiresConfirmation).toBeDefined();
    expect(result.eventsAffected).toBeDefined();
  });

  it('requires confirmation for tier 0 and does not persist until approved', async () => {
    const result = await gatekeepRule(
      makeIntent({ contact: 'sacred@example.com', tier: 0 }),
      BASE_PROFILE
    );
    expect(result.success).toBe(false);
    expect(result.requiresConfirmation).toBe(true);
    expect(upsertUserPolicy).not.toHaveBeenCalled();
  });

  it('applies tier 0 when fromApprovedConfirmation', async () => {
    const result = await gatekeepRule(
      makeIntent({ contact: 'sacred2@example.com', tier: 0 }),
      BASE_PROFILE,
      true
    );
    expect(result.success).toBe(true);
    expect(upsertUserPolicy).toHaveBeenCalled();
  });
});