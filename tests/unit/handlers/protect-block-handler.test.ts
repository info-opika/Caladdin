import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ParsedIntentSchema, type UserPolicyProfile } from '../../../src/core/adts.js';

const mockEnsurePolicy = vi.fn();
const mockSavePending = vi.fn();
const mockProtectBlock = vi.fn();
const mockGetOAuth = vi.fn();

vi.mock('../../../src/db/users.js', () => ({
  ensureDefaultPolicy: (...a: unknown[]) => mockEnsurePolicy(...a),
}));

vi.mock('../../../src/db/conversation-context.js', () => ({
  savePendingClarification: (...a: unknown[]) => mockSavePending(...a),
}));

vi.mock('../../../src/core/intents/protect-block.js', () => ({
  protectBlock: (...a: unknown[]) => mockProtectBlock(...a),
}));

vi.mock('../../../src/services/auth_service.js', () => ({
  getOAuth2AuthForUser: (...a: unknown[]) => mockGetOAuth(...a),
}));

import { handleProtectBlock } from '../../../src/handlers/protect-block.js';

const ctx = { userId: 'user-1', timezone: 'America/Chicago' };
const cal = {} as import('googleapis').calendar_v3.Calendar;

const BASE_POLICY: UserPolicyProfile = {
  userId: 'user-1',
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

const FULL_PB_PARAMS = {
  label: 'Deep Work',
  daysOfWeek: [2],
  startTime: '09:00',
  endTime: '11:00',
  rangeEnd: '2026-12-31',
  tier: 1,
};

describe('handleProtectBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnsurePolicy.mockResolvedValue({ ...BASE_POLICY });
    mockSavePending.mockResolvedValue(undefined);
    mockGetOAuth.mockResolvedValue({});
    mockProtectBlock.mockResolvedValue({
      success: true,
      intent: 'PROTECT_BLOCK',
      requiresConfirmation: false,
      messageToUser: 'Done — blocked.',
      eventsAffected: [],
    });
  });

  it('asks for clarification when label or timing missing', async () => {
    const parsed = ParsedIntentSchema.parse({
      intent: 'PROTECT_BLOCK',
      confidence: 0.9,
      params: { label: 'Lunch' },
      mappingMethod: 'direct',
      rawUtterance: 'block lunch every weekday',
    });
    const result = await handleProtectBlock(parsed, ctx, cal);
    expect(result.success).toBe(false);
    expect(mockSavePending).toHaveBeenCalled();
    expect(result.messageToUser).toMatch(/more detail/i);
    expect(mockProtectBlock).not.toHaveBeenCalled();
  });

  it('does not re-ask when label, startTime, and endTime are already parsed', async () => {
    const parsed = ParsedIntentSchema.parse({
      intent: 'PROTECT_BLOCK',
      confidence: 0.9,
      params: {
        ...FULL_PB_PARAMS,
        missingFields: ['rangeEnd'],
      },
      mappingMethod: 'direct',
      rawUtterance: 'block deep work tuesday 9-11 through end of year',
    });
    const result = await handleProtectBlock(parsed, ctx, cal);
    expect(mockSavePending).not.toHaveBeenCalled();
    expect(mockProtectBlock).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('detects duplicate protected block without calling protectBlock', async () => {
    mockEnsurePolicy.mockResolvedValue({
      ...BASE_POLICY,
      protectedBlocks: [{ label: 'Focus', daysOfWeek: [2], startTime: '09:00', endTime: '10:00', rangeEnd: '2026-12-31', tier: 1 }],
    });
    const parsed = ParsedIntentSchema.parse({
      intent: 'PROTECT_BLOCK',
      confidence: 0.9,
      params: {
        label: 'Focus',
        daysOfWeek: [2],
        startTime: '09:00',
        endTime: '10:00',
        rangeEnd: '2026-12-31',
      },
      mappingMethod: 'direct',
      rawUtterance: 'block focus tuesday 9-10',
    });
    const result = await handleProtectBlock(parsed, ctx, cal);
    expect(result.success).toBe(true);
    expect(result.messageToUser).toMatch(/already protected/i);
    expect(mockProtectBlock).not.toHaveBeenCalled();
  });

  it('delegates to protectBlock with confirmation skip flag from context', async () => {
    const parsed = ParsedIntentSchema.parse({
      intent: 'PROTECT_BLOCK',
      confidence: 0.9,
      params: FULL_PB_PARAMS,
      mappingMethod: 'direct',
      rawUtterance: 'protect deep work tuesday 9-11',
    });
    await handleProtectBlock(parsed, { ...ctx, _skipConfirmationGate: true }, cal);
    expect(mockProtectBlock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: 'user-1' }),
      expect.anything(),
      true,
    );
  });

  it('derives endTime from durationMinutes when endTime omitted', async () => {
    const parsed = ParsedIntentSchema.parse({
      intent: 'PROTECT_BLOCK',
      confidence: 0.9,
      params: {
        label: 'Meditation',
        daysOfWeek: [1],
        startTime: '08:00',
        durationMinutes: 30,
        rangeEnd: '2026-12-31',
      },
      mappingMethod: 'direct',
      rawUtterance: 'block 30 minutes meditation mondays at 8',
    });
    await handleProtectBlock(parsed, ctx, cal);
    expect(mockProtectBlock).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({ startTime: '08:00', endTime: '08:30' }),
      }),
      expect.anything(),
      expect.anything(),
      false,
    );
  });
});
