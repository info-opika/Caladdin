import { describe, it, expect } from 'vitest';
import { checkSpecificSlot } from '../../src/services/mutual_slot_engine.js';

describe('checkSpecificSlot', () => {
  const tz = 'America/Chicago';
  const candidateStart = '2026-06-10T14:00:00-05:00';
  const candidateEnd = '2026-06-10T15:00:00-05:00';

  it('returns available host_only when host calendar is free', () => {
    const result = checkSpecificSlot({
      candidateStart,
      candidateEnd,
      hostBusy: [],
      timezone: tz,
    });
    expect(result).toEqual({
      available: true,
      scope: 'host_only',
      conflicts: [],
    });
  });

  it('reports host conflict in host_only scope', () => {
    const hostBlock = {
      start: '2026-06-10T13:30:00-05:00',
      end: '2026-06-10T14:30:00-05:00',
    };
    const result = checkSpecificSlot({
      candidateStart,
      candidateEnd,
      hostBusy: [hostBlock],
      timezone: tz,
    });
    expect(result.available).toBe(false);
    expect(result.scope).toBe('host_only');
    expect(result.conflicts).toEqual([{ ...hostBlock, party: 'host' }]);
  });

  it('checks both calendars in mutual scope', () => {
    const inviteeBlock = {
      start: '2026-06-10T14:30:00-05:00',
      end: '2026-06-10T15:30:00-05:00',
    };
    const result = checkSpecificSlot({
      candidateStart,
      candidateEnd,
      hostBusy: [],
      inviteeBusy: [inviteeBlock],
      timezone: tz,
    });
    expect(result.available).toBe(false);
    expect(result.scope).toBe('mutual');
    expect(result.conflicts).toEqual([{ ...inviteeBlock, party: 'invitee' }]);
  });

  it('returns available mutual when both calendars are free', () => {
    const result = checkSpecificSlot({
      candidateStart,
      candidateEnd,
      hostBusy: [
        { start: '2026-06-10T09:00:00-05:00', end: '2026-06-10T10:00:00-05:00' },
      ],
      inviteeBusy: [
        { start: '2026-06-10T16:00:00-05:00', end: '2026-06-10T17:00:00-05:00' },
      ],
      timezone: tz,
    });
    expect(result.available).toBe(true);
    expect(result.scope).toBe('mutual');
    expect(result.conflicts).toEqual([]);
  });

  it('rejects invalid time range', () => {
    const result = checkSpecificSlot({
      candidateStart: candidateEnd,
      candidateEnd: candidateStart,
      hostBusy: [],
      timezone: tz,
    });
    expect(result.available).toBe(false);
    expect(result.reason).toBe('invalid_time_range');
  });
});
