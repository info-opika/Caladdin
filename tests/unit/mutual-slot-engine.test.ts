import { describe, it, expect } from 'vitest';
import { findMutualSlots, mergeHostAndInviteeBusy } from '../../src/services/mutual_slot_engine.js';

describe('mutual_slot_engine', () => {
  const tz = 'America/Chicago';
  const windowStart = '2026-06-10T09:00:00-05:00';
  const windowEnd = '2026-06-10T18:00:00-05:00';

  it('mergeHostAndInviteeBusy combines overlapping intervals', () => {
    const merged = mergeHostAndInviteeBusy(
      [{ start: '2026-06-10T10:00:00-05:00', end: '2026-06-10T11:00:00-05:00' }],
      [{ start: '2026-06-10T10:30:00-05:00', end: '2026-06-10T12:00:00-05:00' }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual({
      start: '2026-06-10T10:00:00-05:00',
      end: '2026-06-10T12:00:00-05:00',
    });
  });

  it('findMutualSlots returns up to two non-overlapping free slots', () => {
    const hostBusy = [
      { start: '2026-06-10T09:00:00-05:00', end: '2026-06-10T10:00:00-05:00' },
      { start: '2026-06-10T14:00:00-05:00', end: '2026-06-10T15:00:00-05:00' },
    ];
    const inviteeBusy = [
      { start: '2026-06-10T11:00:00-05:00', end: '2026-06-10T12:00:00-05:00' },
    ];

    const slots = findMutualSlots({
      hostBusy,
      inviteeBusy,
      windowStart,
      windowEnd,
      durationMinutes: 60,
      timezone: tz,
      dayStartHour: 9,
      dayEndHour: 18,
    });

    expect(slots.length).toBeGreaterThanOrEqual(1);
    expect(slots.length).toBeLessThanOrEqual(2);
    for (const slot of slots) {
      expect(new Date(slot.end).getTime() - new Date(slot.start).getTime()).toBe(60 * 60 * 1000);
    }
  });

  it('findMutualSlots excludes already offered slots', () => {
    const slots = findMutualSlots({
      hostBusy: [],
      inviteeBusy: [],
      windowStart,
      windowEnd,
      durationMinutes: 60,
      timezone: tz,
      dayStartHour: 9,
      dayEndHour: 18,
      excludeSlots: [{ start: '2026-06-10T10:00:00-05:00', end: '2026-06-10T11:00:00-05:00' }],
    });

    expect(slots.every((s) => s.start !== '2026-06-10T10:00:00-05:00')).toBe(true);
  });

  it('findMutualSlots returns empty when window is invalid', () => {
    const slots = findMutualSlots({
      hostBusy: [],
      inviteeBusy: [],
      windowStart: windowEnd,
      windowEnd: windowStart,
      durationMinutes: 60,
      timezone: tz,
      dayStartHour: 9,
      dayEndHour: 18,
    });
    expect(slots).toEqual([]);
  });
});
