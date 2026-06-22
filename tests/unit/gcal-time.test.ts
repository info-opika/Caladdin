import { describe, it, expect } from 'vitest';
import {
  formatWeekStartDate,
  normalizeGCalRange,
  parseOptionalIso,
  parseWeekStartParam,
  startOfWeek,
} from '../../src/core/date-utils.js';

describe('gcal-time', () => {
  it('rejects empty LLM range strings', () => {
    const { timeMin, timeMax } = normalizeGCalRange('', '');
    expect(new Date(timeMax).getTime()).toBeGreaterThan(new Date(timeMin).getTime());
  });

  it('parses valid ISO', () => {
    expect(parseOptionalIso('2026-05-29T00:00:00.000Z')?.toISOString()).toBe('2026-05-29T00:00:00.000Z');
    expect(parseOptionalIso('')).toBeNull();
    expect(parseOptionalIso('not-a-date')).toBeNull();
  });

  it('parseWeekStartParam treats YYYY-MM-DD as local Monday anchor', () => {
    const monday = parseWeekStartParam('2026-06-22');
    expect(monday.getDay()).toBe(1);
    expect(formatWeekStartDate(monday)).toBe('2026-06-22');
  });

  it('startOfWeek snaps mid-week dates to Monday', () => {
    const wed = new Date(2026, 5, 25, 15, 0, 0);
    const monday = startOfWeek(wed);
    expect(monday.getDay()).toBe(1);
    expect(monday.getDate()).toBe(22);
  });
});
