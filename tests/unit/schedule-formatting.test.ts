import { describe, it, expect } from 'vitest';
import {
  formatSlotButtonLabel,
  formatTimezoneLabel,
} from '../../src/services/schedule_formatting.js';

describe('schedule_formatting', () => {
  it('formatSlotButtonLabel includes timezone abbreviation', () => {
    const label = formatSlotButtonLabel(
      { start: '2026-06-02T20:30:00-05:00', end: '2026-06-02T21:30:00-05:00' },
      'America/Chicago',
    );
    expect(label).toMatch(/Tue/i);
    expect(label).toMatch(/8:30 PM/i);
    expect(label).toContain(formatTimezoneLabel('America/Chicago'));
  });

  it('formatTimezoneLabel falls back for invalid zones', () => {
    expect(formatTimezoneLabel('Not/A_Zone')).toBe('Not/A Zone');
  });
});
