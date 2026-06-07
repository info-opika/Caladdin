import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ParsedIntentSchema, type UserPolicyProfile } from '../../../src/core/adts.js';

const mockEnsurePolicy = vi.fn();
const mockUpsertPolicy = vi.fn();
const mockSavePending = vi.fn();
const mockCreateEventWithSync = vi.fn();

vi.mock('../../../src/db/users.js', () => ({
  ensureDefaultPolicy: (...a: unknown[]) => mockEnsurePolicy(...a),
  upsertPolicy: (...a: unknown[]) => mockUpsertPolicy(...a),
}));

vi.mock('../../../src/db/conversation-context.js', () => ({
  savePendingClarification: (...a: unknown[]) => mockSavePending(...a),
}));

vi.mock('../../../src/services/calendar_api.js', () => ({
  createEventWithSync: (...a: unknown[]) => mockCreateEventWithSync(...a),
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

describe('handleProtectBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnsurePolicy.mockResolvedValue({ ...BASE_POLICY });
    mockUpsertPolicy.mockResolvedValue(undefined);
    mockSavePending.mockResolvedValue(undefined);
    mockCreateEventWithSync.mockResolvedValue({ id: 'ev-pb' });
  });

  it('asks for clarification on vague utterance', async () => {
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
  });

  it('detects duplicate protected block', async () => {
    mockEnsurePolicy.mockResolvedValue({
      ...BASE_POLICY,
      protectedBlocks: [{ label: 'Focus', daysOfWeek: [2], startTime: '09:00', endTime: '10:00' }],
    });
    const parsed = ParsedIntentSchema.parse({
      intent: 'PROTECT_BLOCK',
      confidence: 0.9,
      params: { label: 'Focus', daysOfWeek: [2], startTime: '09:00', endTime: '10:00' },
      mappingMethod: 'direct',
      rawUtterance: 'block focus tuesday 9-10',
    });
    const result = await handleProtectBlock(parsed, ctx, cal);
    expect(result.success).toBe(true);
    expect(result.messageToUser).toMatch(/already protected/i);
  });

  it('creates protected block and calendar event', async () => {
    const parsed = ParsedIntentSchema.parse({
      intent: 'PROTECT_BLOCK',
      confidence: 0.9,
      params: { label: 'Deep Work', daysOfWeek: [2], startTime: '09:00', endTime: '11:00' },
      mappingMethod: 'direct',
      rawUtterance: 'protect deep work tuesday 9-11',
    });
    const result = await handleProtectBlock(parsed, ctx, cal);
    expect(result.success).toBe(true);
    expect(mockUpsertPolicy).toHaveBeenCalled();
    expect(mockCreateEventWithSync).toHaveBeenCalled();
    expect(result.messageToUser).toMatch(/protected/i);
  });
});
