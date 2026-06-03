import { describe, it, expect, vi, beforeEach } from 'vitest';
import { modifyEvent } from '../../../src/core/intents/modify-event.js';
import { type CalendarEvent, type UserPolicyProfile, type ParsedIntent } from '../../../src/core/adts.js';

vi.mock('../../../src/db/audit.js', () => ({
  insertAuditLog: vi.fn().mockResolvedValue(undefined),
}));

import { insertAuditLog } from '../../../src/db/audit.js';

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

const mockIntent: ParsedIntent = {
  intent: 'MODIFY_EVENT',
  confidence: 0.9,
  rawUtterance: 'Move my 3pm to tomorrow',
  params: { newTitle: 'Moved meeting' },
  mappingMethod: 'direct',
};

function makeEvent(tier: 0 | 1 | 2 | 3): CalendarEvent {
  return {
    id: 'eebb589c-429c-4a36-a7bb-ee2652832aaa',
    title: 'Team Standup',
    start: '2026-04-22T15:00:00-05:00',
    end: '2026-04-22T15:30:00-05:00',
    participants: ['team@company.com'],
    tier,
    isRecurring: false,
    status: 'confirmed',
  };
}

describe('modifyEvent intent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns failure when event is null', async () => {
    const result = await modifyEvent(mockIntent, BASE_PROFILE, null);
    expect(result.success).toBe(false);
    expect(result.failureReason).toContain('not found');
    expect(result.requiresConfirmation).toBeDefined();
  });

  it('blocks Tier 0 modification and requires confirmation', async () => {
    const result = await modifyEvent(mockIntent, BASE_PROFILE, makeEvent(0));
    expect(result.success).toBe(false);
    expect(result.requiresConfirmation).toBe(true);
    expect(insertAuditLog).not.toHaveBeenCalled();
  });

  it('blocks Tier 1 with MODIFY_EVENT (destructive intent)', async () => {
    const result = await modifyEvent(mockIntent, BASE_PROFILE, makeEvent(1));
    expect(result.success).toBe(false);
    expect(result.requiresConfirmation).toBe(true);
  });

  it('allows Tier 2 modification and writes audit log', async () => {
    const result = await modifyEvent(mockIntent, BASE_PROFILE, makeEvent(2));
    expect(result.success).toBe(true);
    expect(result.requiresConfirmation).toBe(false);
    expect(insertAuditLog).toHaveBeenCalledOnce();
  });

  it('allows Tier 3 modification', async () => {
    const result = await modifyEvent(mockIntent, BASE_PROFILE, makeEvent(3));
    expect(result.success).toBe(true);
    expect(insertAuditLog).toHaveBeenCalledOnce();
  });

  it('returns full IntentResult shape', async () => {
    const result = await modifyEvent(mockIntent, BASE_PROFILE, makeEvent(2));
    expect(result.success).toBeDefined();
    expect(result.intent).toBe('MODIFY_EVENT');
    expect(result.requiresConfirmation).toBeDefined();
    expect(result.eventsAffected).toBeDefined();
  });
});
