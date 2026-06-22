import { describe, it, expect } from 'vitest';
import {
  formatSlotButtonLabel,
  formatSlotButtonLabelForInvitee,
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
    expect(label).not.toMatch(/GMT[+-]/);
    expect(label).toContain(formatTimezoneLabel('America/Chicago'));
  });

  it('formatTimezoneLabel uses region abbreviations not GMT offsets', () => {
    const chicago = formatTimezoneLabel('America/Chicago', new Date('2026-01-15T12:00:00Z'));
    expect(chicago).toMatch(/C[DS]T/);
    expect(chicago).not.toMatch(/GMT[+-]/);

    const india = formatTimezoneLabel('Asia/Kolkata', new Date('2026-06-15T12:00:00Z'));
    expect(india).toBe('IST');
  });

  it('formatSlotButtonLabelForInvitee formats in invitee zone', () => {
    const label = formatSlotButtonLabelForInvitee(
      { start: '2026-06-02T20:30:00-05:00', end: '2026-06-02T21:30:00-05:00' },
      'Asia/Kolkata',
    );
    expect(label).toMatch(/IST/);
    expect(label).not.toMatch(/GMT[+-]/);
  });

  it('formatTimezoneLabel falls back for invalid zones', () => {
    expect(formatTimezoneLabel('Not/A_Zone')).toBe('Not/A Zone');
  });
});
