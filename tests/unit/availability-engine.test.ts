import { describe, it, expect } from 'vitest';
import {
  expandBusyWithBuffers,
  isAfterMinimumNotice,
  parseAvailabilityRules,
  windowsForDay,
} from '../../src/core/availability.js';
import { addMinutes } from '../../src/core/date-utils.js';

describe('availability engine', () => {
  it('parses buffer and minimum notice from event type rules', () => {
    const parsed = parseAvailabilityRules({
      bufferBeforeMinutes: 10,
      bufferAfterMinutes: 5,
      minimumNoticeMinutes: 120,
      workingHoursStart: '10:00',
      workingHoursEnd: '16:00',
    });
    expect(parsed.bufferBeforeMinutes).toBe(10);
    expect(parsed.bufferAfterMinutes).toBe(5);
    expect(parsed.minimumNoticeMinutes).toBe(120);
    expect(parsed.workingHoursStart).toBe('10:00');
  });

  it('applies bufferMinutes shorthand to both sides', () => {
    const parsed = parseAvailabilityRules({ bufferMinutes: 15 });
    expect(parsed.bufferBeforeMinutes).toBe(15);
    expect(parsed.bufferAfterMinutes).toBe(15);
  });

  it('expands busy intervals by configured buffers', () => {
    const start = '2026-06-10T14:00:00.000Z';
    const end = '2026-06-10T15:00:00.000Z';
    const expanded = expandBusyWithBuffers([{ start, end }], 15, 10);
    expect(new Date(expanded[0]!.start).getTime()).toBe(addMinutes(new Date(start), -15).getTime());
    expect(new Date(expanded[0]!.end).getTime()).toBe(addMinutes(new Date(end), 10).getTime());
  });

  it('uses weekly schedule windows instead of default hours', () => {
    const parsed = parseAvailabilityRules({
      weeklySchedule: [{ day: 1, start: '11:00', end: '13:00' }],
    });
    const monday = new Date('2026-06-08T12:00:00.000Z'); // Monday UTC context — use local day
    const windows = windowsForDay(monday, parsed);
    expect(windows.length).toBeGreaterThan(0);
  });

  it('returns no windows for days absent from weekly schedule', () => {
    const parsed = parseAvailabilityRules({
      weeklySchedule: [{ day: 1, start: '09:00', end: '17:00' }],
    });
    const sunday = new Date('2026-06-07T12:00:00.000Z');
    expect(windowsForDay(sunday, parsed)).toEqual([]);
  });

  it('enforces minimum notice before slot start', () => {
    const now = new Date('2026-06-10T12:00:00.000Z');
    const tooSoon = new Date('2026-06-10T12:30:00.000Z');
    const ok = new Date('2026-06-10T15:00:00.000Z');
    expect(isAfterMinimumNotice(tooSoon, now, 120)).toBe(false);
    expect(isAfterMinimumNotice(ok, now, 120)).toBe(true);
  });
});
