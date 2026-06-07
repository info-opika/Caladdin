/**
 * Availability engine — slot generation integration (mocked calendar + events).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { type UserPolicyProfile } from '../../src/core/adts.js';

const mockListEvents = vi.fn();
const mockListBusy = vi.fn();

vi.mock('../../src/db/events.js', () => ({
  listEvents: (...a: unknown[]) => mockListEvents(...a),
}));

vi.mock('../../src/services/calendar_api.js', () => ({
  listBusyFromGCal: (...a: unknown[]) => mockListBusy(...a),
}));

vi.mock('../../src/services/freebusy-cache.js', () => ({
  getCachedBusyFromGCal: (_cal: unknown, userId: unknown, timeMin: unknown, timeMax: unknown) =>
    mockListBusy(userId, timeMin, timeMax),
}));

vi.mock('../../src/db/users.js', () => ({
  getUserByEmail: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../src/services/auth_service.js', () => ({
  getOAuthClientForUser: vi.fn().mockResolvedValue({}),
}));

import { generateSlots } from '../../src/core/slot-scoring.js';

const POLICY: UserPolicyProfile = {
  userId: 'host-1',
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
  workingHoursStart: '09:00',
  workingHoursEnd: '17:00',
};

describe('availability engine (generateSlots)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListEvents.mockResolvedValue([]);
    mockListBusy.mockResolvedValue([]);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-09T14:00:00.000Z')); // Monday
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns scored candidate slots within working hours', async () => {
    const slots = await generateSlots('host-1', POLICY, 30, 5, { cal: {} as never });
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.length).toBeLessThanOrEqual(POLICY.faxEffectConfig.targetSlotsPerOffer);
    for (const s of slots) {
      expect(new Date(s.end).getTime() - new Date(s.start).getTime()).toBe(30 * 60 * 1000);
    }
  });

  it('excludes slots overlapping busy calendar blocks', async () => {
    mockListBusy.mockResolvedValue([
      {
        start: '2026-06-10T14:00:00-05:00',
        end: '2026-06-10T16:00:00-05:00',
      },
    ]);
    const slots = await generateSlots('host-1', POLICY, 60, 7, { cal: {} as never });
    for (const s of slots) {
      const start = new Date(s.start).getTime();
      const busyStart = new Date('2026-06-10T19:00:00.000Z').getTime();
      const busyEnd = new Date('2026-06-10T21:00:00.000Z').getTime();
      const overlaps = start < busyEnd && new Date(s.end).getTime() > busyStart;
      expect(overlaps).toBe(false);
    }
  });

  it('respects minimum notice from availability rules', async () => {
    const slots = await generateSlots('host-1', POLICY, 30, 3, {
      cal: null,
      availabilityRules: { minimumNoticeMinutes: 24 * 60 },
    });
    const cutoff = Date.now() + 24 * 60 * 60 * 1000;
    for (const s of slots) {
      expect(new Date(s.start).getTime()).toBeGreaterThanOrEqual(cutoff - 60_000);
    }
  });
});
