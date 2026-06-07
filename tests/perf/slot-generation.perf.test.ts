/**
 * Perf timing for generateSlots with mocked I/O (CI-safe).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { performance } from 'node:perf_hooks';
import type { UserPolicyProfile } from '../../src/core/adts.js';

const mockListEvents = vi.fn();
const mockListBusy = vi.fn();
const mockGetUserByEmail = vi.fn();
const mockGetOAuthClient = vi.fn();

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
  getUserByEmail: (...a: unknown[]) => mockGetUserByEmail(...a),
}));

vi.mock('../../src/services/auth_service.js', () => ({
  getOAuthClientForUser: (...a: unknown[]) => mockGetOAuthClient(...a),
}));

import { generateSlots } from '../../src/core/slot-scoring.js';

const POLICY: UserPolicyProfile = {
  userId: 'perf-user',
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

describe('perf: generateSlots', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListEvents.mockResolvedValue([]);
    mockListBusy.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 8));
      return [{ start: '2026-06-10T14:00:00.000Z', end: '2026-06-10T15:00:00.000Z' }];
    });
    mockGetUserByEmail.mockResolvedValue(null);
    mockGetOAuthClient.mockResolvedValue(null);
  });

  it('reports cold vs warm timing with parallel prefetch', async () => {
    const cal = {} as import('googleapis').calendar_v3.Calendar;
    const coldStart = performance.now();
    await generateSlots('perf-user', POLICY, 60, 7, { cal });
    const coldMs = performance.now() - coldStart;

    const warmStart = performance.now();
    await generateSlots('perf-user', POLICY, 60, 7, { cal });
    const warmMs = performance.now() - warmStart;

    console.log(
      JSON.stringify({
        metric: 'generateSlots_ms',
        cold: Math.round(coldMs),
        warm: Math.round(warmMs),
        gcalMockCalls: mockListBusy.mock.calls.length,
      }),
    );

    expect(coldMs).toBeGreaterThan(0);
    expect(mockListBusy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
