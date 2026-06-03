/**
 * Slot scoring — protected blocks exclude overlapping candidate slots.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { type UserPolicyProfile } from '../../src/core/adts.js';

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

vi.mock('../../src/db/users.js', () => ({
  getUserByEmail: (...a: unknown[]) => mockGetUserByEmail(...a),
}));

vi.mock('../../src/services/auth_service.js', () => ({
  getOAuthClientForUser: (...a: unknown[]) => mockGetOAuthClient(...a),
}));

import { generateSlots } from '../../src/core/slot-scoring.js';

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
  workingHoursStart: '09:00',
  workingHoursEnd: '17:00',
};

describe('generateSlots — protected blocks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListEvents.mockResolvedValue([]);
    mockListBusy.mockResolvedValue([]);
    mockGetUserByEmail.mockResolvedValue(null);
    mockGetOAuthClient.mockResolvedValue(null);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-03T12:00:00-05:00')); // Tuesday
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('excludes slots overlapping a protected block on matching weekday', async () => {
    const policy: UserPolicyProfile = {
      ...BASE_POLICY,
      protectedBlocks: [
        {
          label: 'Deep work',
          daysOfWeek: [2], // Tuesday (2026-06-03)
          startTime: '10:00',
          endTime: '12:00',
        },
      ],
    };
    const slots = await generateSlots('user-1', policy, 60, 1);
    const starts = slots.map((s) => s.start);
    // 10:00-11:00 and 10:30-11:30 should be excluded
    expect(starts.some((s) => s.includes('T10:00') || s.includes('T10:30'))).toBe(false);
    expect(slots.length).toBeGreaterThan(0);
  });

  it('allows slots on days outside protected block daysOfWeek', async () => {
    const policy: UserPolicyProfile = {
      ...BASE_POLICY,
      protectedBlocks: [
        {
          label: 'Monday focus',
          daysOfWeek: [1], // Monday only
          startTime: '09:00',
          endTime: '17:00',
        },
      ],
    };
    const slots = await generateSlots('user-1', policy, 60, 1);
    expect(slots.length).toBeGreaterThan(0);
  });

  it('still excludes busy events alongside protected blocks', async () => {
    mockListEvents.mockResolvedValueOnce([
      {
        start: '2026-06-03T14:00:00-05:00',
        end: '2026-06-03T15:00:00-05:00',
        status: 'confirmed',
        tier: 2,
        title: 'Meeting',
      },
    ]);
    const policy: UserPolicyProfile = {
      ...BASE_POLICY,
      protectedBlocks: [
        { label: 'Lunch', daysOfWeek: [2], startTime: '12:00', endTime: '13:00' },
      ],
    };
    const slots = await generateSlots('user-1', policy, 60, 1);
    expect(slots.every((s) => !s.start.includes('T14:00'))).toBe(true);
    expect(slots.every((s) => !s.start.includes('T12:00') && !s.start.includes('T12:30'))).toBe(true);
  });

  it('merges GCal busy with protected block filtering', async () => {
    mockListBusy.mockResolvedValueOnce([
      { start: '2026-06-03T15:00:00-05:00', end: '2026-06-03T16:00:00-05:00' },
    ]);
    const policy: UserPolicyProfile = {
      ...BASE_POLICY,
      protectedBlocks: [
        { label: 'Focus', daysOfWeek: [2], startTime: '09:00', endTime: '10:00' },
      ],
    };
    const cal = {} as import('googleapis').calendar_v3.Calendar;
    const slots = await generateSlots('user-1', policy, 60, 1, { cal });
    expect(slots.every((s) => !s.start.includes('T15:00'))).toBe(true);
    expect(slots.every((s) => !s.start.includes('T09:00'))).toBe(true);
  });

  it('includes recipient busy when recipientEmail resolves to user', async () => {
    mockGetUserByEmail.mockResolvedValueOnce({ id: 'guest-1', email: 'guest@example.com' });
    mockGetOAuthClient.mockResolvedValueOnce({});
    mockListBusy.mockResolvedValueOnce([
      { start: '2026-06-03T11:00:00-05:00', end: '2026-06-03T12:00:00-05:00' },
    ]);
    const slots = await generateSlots('user-1', BASE_POLICY, 60, 1, {
      recipientEmail: 'guest@example.com',
      cal: {} as import('googleapis').calendar_v3.Calendar,
    });
    expect(slots.every((s) => !s.start.includes('T11:00'))).toBe(true);
  });

  it('returns at most 2 scored slots with Option labels', async () => {
    const slots = await generateSlots('user-1', BASE_POLICY, 60, 3);
    expect(slots.length).toBeLessThanOrEqual(2);
    if (slots.length >= 1) expect(slots[0]?.label).toBe('Option 1');
    if (slots.length >= 2) expect(slots[1]?.label).toBe('Option 2');
  });

  it('ignores cancelled events when building busy list', async () => {
    const localOnePm = new Date();
    localOnePm.setHours(13, 0, 0, 0);
    const localTwoPm = new Date(localOnePm.getTime() + 60 * 60 * 1000);
    mockListEvents.mockResolvedValueOnce([
      {
        start: localOnePm.toISOString(),
        end: localTwoPm.toISOString(),
        status: 'cancelled',
        tier: 2,
        title: 'Cancelled',
      },
    ]);
    const narrowPolicy: UserPolicyProfile = {
      ...BASE_POLICY,
      workingHoursStart: '13:00',
      workingHoursEnd: '14:00',
    };
    const slots = await generateSlots('user-1', narrowPolicy, 60, 1);
    expect(slots.length).toBe(1);
    expect(Math.abs(new Date(slots[0]!.start).getTime() - localOnePm.getTime())).toBeLessThan(60 * 1000);
  });
});
