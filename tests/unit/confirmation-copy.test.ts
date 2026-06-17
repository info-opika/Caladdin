import { describe, it, expect } from 'vitest';
import { generateConfirmationCopy } from '../../src/core/confirmation-copy.js';
import type { ParsedIntent } from '../../src/core/adts.js';

describe('generateConfirmationCopy', () => {
  it('PROTECT_BLOCK uses plain language with times', () => {
    const parsed: ParsedIntent = {
      intent: 'PROTECT_BLOCK',
      confidence: 1,
      rawUtterance: 'block meditation daily 7am for 10 days',
      mappingMethod: 'direct',
      params: {
        label: 'meditation',
        startTime: '07:00',
        endTime: '07:30',
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        startDate: '2026-06-01',
        rangeEnd: '2026-06-10',
      },
    };
    const copy = generateConfirmationCopy(parsed, 'America/Chicago');
    expect(copy).toMatch(/meditation/i);
    expect(copy).toMatch(/7:00 AM/i);
    expect(copy).not.toMatch(/PROTECT_BLOCK/);
    expect(copy).toMatch(/\?$/);
  });

  it('OFFER_SPECIFIC mentions invitee and duration', () => {
    const parsed: ParsedIntent = {
      intent: 'OFFER_SPECIFIC',
      confidence: 1,
      rawUtterance: 'invite info@topicart.co',
      mappingMethod: 'direct',
      params: {
        recipientEmail: 'info@topicart.co',
        durationMinutes: 30,
      },
    };
    const copy = generateConfirmationCopy(parsed, 'America/Chicago');
    expect(copy).toContain('info@topicart.co');
    expect(copy).toMatch(/30-minute/i);
    expect(copy).toMatch(/two time options/i);
  });

  it('MODIFY_EVENT restates move target', () => {
    const parsed: ParsedIntent = {
      intent: 'MODIFY_EVENT',
      confidence: 1,
      rawUtterance: 'move team sync to friday 2pm',
      mappingMethod: 'direct',
      params: {
        eventTitle: 'Team sync',
        newStart: '2026-06-12T19:00:00.000Z',
      },
    };
    const copy = generateConfirmationCopy(parsed, 'America/Chicago');
    expect(copy).toMatch(/Team sync/i);
    expect(copy).toMatch(/Move/i);
    expect(copy).not.toMatch(/MODIFY_EVENT/);
  });

  it('FLUSH_RANGE uses delete wording for single event', () => {
    const parsed: ParsedIntent = {
      intent: 'FLUSH_RANGE',
      confidence: 1,
      rawUtterance: 'delete dentist appointment',
      mappingMethod: 'direct',
      params: { eventTitle: 'Dentist' },
    };
    const copy = generateConfirmationCopy(parsed, 'America/Chicago');
    expect(copy).toMatch(/Delete "Dentist"/i);
  });
});
