import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushRange } from '../../../src/core/intents/flush-range.js';
import { type CalendarEvent, type UserPolicyProfile, type ParsedIntent } from '../../../src/core/adts.js';

vi.mock('../../../src/db/events.js', () => ({
  updateEventStatus: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/db/audit.js', () => ({
  insertAuditLog: vi.fn().mockResolvedValue(undefined),
}));

import { updateEventStatus } from '../../../src/db/events.js';
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

function makeEvent(id: string, tier: 0 | 1 | 2 | 3, title = 'Test Event'): CalendarEvent {
  return {
    id,
    title,
    start: '2026-04-22T09:00:00-05:00',
    end: '2026-04-22T10:00:00-05:00',
    participants: [],
    tier,
    isRecurring: false,
    status: 'confirmed',
  };
}

const mockIntent: ParsedIntent = {
  intent: 'FLUSH_RANGE',
  confidence: 0.9,
  rawUtterance: 'Clear my calendar Friday',
  params: {},
  mappingMethod: 'direct',
};

describe('flushRange intent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Tier 0 is never mutated without confirmation token', async () => {
    const events = [makeEvent('evt-001', 0, 'Board Meeting')];
    const result = await flushRange(mockIntent, BASE_PROFILE, events);
    expect(result.success).toBe(false);
    expect(result.requiresConfirmation).toBe(true);
    expect(updateEventStatus).not.toHaveBeenCalled();
  });

  it('creates pending_confirmations row for Tier 0 (requiresConfirmation=true)', async () => {
    const events = [makeEvent('evt-002', 0, 'Immovable Block')];
    const result = await flushRange(mockIntent, BASE_PROFILE, events);
    expect(result.requiresConfirmation).toBe(true);
  });

  it('allows flushing Tier 2 events and writes audit log', async () => {
    const events = [makeEvent('evt-003', 2)];
    const result = await flushRange(mockIntent, BASE_PROFILE, events);
    expect(result.success).toBe(true);
    expect(updateEventStatus).toHaveBeenCalledTimes(1);
    expect(insertAuditLog).toHaveBeenCalledTimes(1);
  });

  it('requires confirmation for blast radius >5 (tier-2 only) without mutating', async () => {
    const events = Array.from({ length: 6 }, (_, i) => makeEvent(`evt-b${i}`, 2));
    const result = await flushRange(mockIntent, BASE_PROFILE, events);
    expect(result.success).toBe(false);
    expect(result.requiresConfirmation).toBe(true);
    expect(result.failureReason).toMatch(/Blast radius: 6 events/);
    expect(updateEventStatus).not.toHaveBeenCalled();
  });

  it('allows flushing Tier 3 events', async () => {
    const events = [makeEvent('evt-005', 3)];
    const result = await flushRange(mockIntent, BASE_PROFILE, events);
    expect(result.success).toBe(true);
    expect(result.requiresConfirmation).toBe(false);
  });

  it('returns success when range is empty', async () => {
    const result = await flushRange(mockIntent, BASE_PROFILE, []);
    expect(result.success).toBe(true);
    expect(result.eventsAffected.length).toBe(0);
    expect(updateEventStatus).not.toHaveBeenCalled();
  });

  it('returns full IntentResult shape', async () => {
    const result = await flushRange(mockIntent, BASE_PROFILE, []);
    expect(result.success).toBeDefined();
    expect(result.intent).toBeDefined();
    expect(result.requiresConfirmation).toBeDefined();
    expect(result.eventsAffected).toBeDefined();
  });
});