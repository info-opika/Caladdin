import { describe, it, expect } from 'vitest';
import { inferCalendarEventSource } from '../../src/db/events.js';
import type { CalendarEvent } from '../../src/core/adts.js';

function event(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Event',
    start: '2026-06-16T14:00:00.000Z',
    end: '2026-06-16T15:00:00.000Z',
    participants: [],
    tier: 2,
    isRecurring: false,
    status: 'confirmed',
    gcalEventId: 'gcal-1',
    proposedForSession: null,
    description: null,
    ...overrides,
  };
}

describe('inferCalendarEventSource', () => {
  it('classifies protected blocks', () => {
    expect(inferCalendarEventSource(event({ tier: 0, title: 'Meditation' }))).toBe('caladdin_block');
    expect(inferCalendarEventSource(event({ title: '[Protected] Lunch' }))).toBe('caladdin_block');
  });

  it('classifies invite and meeting events', () => {
    expect(inferCalendarEventSource(event({ tier: 3, status: 'proposed' }))).toBe('caladdin_invite');
    expect(inferCalendarEventSource(event({ participants: ['guest@example.com'] }))).toBe('caladdin_invite');
    expect(inferCalendarEventSource(event({ title: '[Proposed] Slot for Alex' }))).toBe('caladdin_invite');
  });

  it('classifies synced external events', () => {
    expect(inferCalendarEventSource(event({ tier: 2, participants: [] }))).toBe('external');
  });
});
