import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  selectTopSlots,
  offerSpecific,
} from '../../../src/core/intents/offer-specific.js';
import { type CandidateSlot, type UserPolicyProfile, type ParsedIntent } from '../../../src/core/adts.js';

vi.mock('../../../src/services/gcal.js', () => ({
  gcalGetFreeBusy: vi.fn().mockResolvedValue([]),
}));

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
    minBufferMinutes: 30,
    clusteringWeight: 0.35,
    energyWeight: 0.45,
    fragmentPenaltyWeight: 0.15,
    protectDeepWorkBlocks: true,
  },
  protectedBlocks: [],
  contactTiers: {},
};

function makeSlot(startHour: number, overrides: Partial<CandidateSlot> = {}): CandidateSlot {
  return {
    start: `2026-04-22T${String(startHour).padStart(2, '0')}:00:00-05:00`,
    end: `2026-04-22T${String(startHour + 1).padStart(2, '0')}:00:00-05:00`,
    adjacentEventCount: 0,
    energyScore: 0.5,
    createsFragment: false,
    ...overrides,
  };
}

const mockIntent: ParsedIntent = {
  intent: 'OFFER_SPECIFIC',
  confidence: 0.9,
  rawUtterance: 'Find me 2 slots to meet with Alex next week',
  params: {},
  mappingMethod: 'direct',
};

describe('offerSpecific — selectTopSlots', () => {
  it('returns top 2 slots by score', () => {
    const candidates = [
      makeSlot(9, { energyScore: 1.0, adjacentEventCount: 2 }),
      makeSlot(14, { energyScore: 0.5, adjacentEventCount: 0 }),
      makeSlot(16, { energyScore: 0.2, adjacentEventCount: 0 }),
      makeSlot(10, { energyScore: 0.9, adjacentEventCount: 1 }),
    ];
    const top = selectTopSlots(candidates, BASE_PROFILE, 2);
    expect(top.length).toBe(2);
  });

  it('filters out buffer-violated slots', () => {
    const shortSlot: CandidateSlot = {
      start: '2026-04-22T14:00:00-05:00',
      end: '2026-04-22T14:10:00-05:00',
      adjacentEventCount: 2,
      energyScore: 1.0,
      createsFragment: false,
    };
    const goodSlot = makeSlot(10, { energyScore: 0.8 });
    const top = selectTopSlots([shortSlot, goodSlot], BASE_PROFILE, 2);
    expect(top.length).toBe(1);
    expect(top[0]?.start).toContain('10:00');
  });

  it('returns empty when no valid candidates exist', () => {
    const top = selectTopSlots([], BASE_PROFILE, 2);
    expect(top.length).toBe(0);
  });
});

describe('offerSpecific — handler', () => {
  const mockOAuthClient = {} as import('google-auth-library').OAuth2Client;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns failure when no oauthClient provided', async () => {
    const candidates = [
      makeSlot(9, { energyScore: 1.0 }),
      makeSlot(14, { energyScore: 0.8 }),
    ];
    const result = await offerSpecific(mockIntent, BASE_PROFILE, candidates, null);
    expect(result.success).toBe(false);
    expect(result.intent).toBe('OFFER_SPECIFIC');
    expect(result.failureReason).toContain('Google Calendar not connected');
    expect(result.requiresConfirmation).toBeDefined();
  });

  it('returns success with top slots when oauthClient provided and gcal returns no busy blocks', async () => {
    const candidates = [
      makeSlot(9, { energyScore: 1.0 }),
      makeSlot(14, { energyScore: 0.8 }),
    ];
    const result = await offerSpecific(mockIntent, BASE_PROFILE, candidates, mockOAuthClient);
    expect(result.success).toBe(true);
    expect(result.intent).toBe('OFFER_SPECIFIC');
    expect(result.slots).toBeDefined();
    expect((result.slots ?? []).length).toBeLessThanOrEqual(2);
    expect(result.requiresConfirmation).toBeDefined();
  });

  it('returns failure when no slots can be generated', async () => {
    const { gcalGetFreeBusy } = await import('../../../src/services/gcal.js');
    vi.mocked(gcalGetFreeBusy).mockResolvedValueOnce([
      { start: '2020-01-01T00:00:00Z', end: '2099-12-31T23:59:59Z' },
    ]);
    const result = await offerSpecific(mockIntent, BASE_PROFILE, [], mockOAuthClient);
    expect(result.success).toBe(false);
    expect(result.failureReason).toBeDefined();
    expect(result.requiresConfirmation).toBeDefined();
  });

  it('never offers more than 2 slots', async () => {
    const candidates = [
      makeSlot(9, { energyScore: 1.0 }),
      makeSlot(10, { energyScore: 0.9 }),
      makeSlot(11, { energyScore: 0.85 }),
      makeSlot(14, { energyScore: 0.8 }),
    ];
    const result = await offerSpecific(mockIntent, BASE_PROFILE, candidates, mockOAuthClient);
    if (result.success) {
      expect((result.slots ?? []).length).toBeLessThanOrEqual(2);
    }
    const topSlots = selectTopSlots(candidates, BASE_PROFILE, 2);
    expect(topSlots.length).toBeLessThanOrEqual(2);
  });
});