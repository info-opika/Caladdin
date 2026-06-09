import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ParsedIntentSchema } from '../../../src/core/adts.js';

const mockCreateEventWithSync = vi.fn();
const mockRecordLastEvent = vi.fn();

vi.mock('../../../src/services/calendar_api.js', () => ({
  createEventWithSync: (...a: unknown[]) => mockCreateEventWithSync(...a),
}));

vi.mock('../../../src/db/conversation-context.js', () => ({
  recordLastEvent: (...a: unknown[]) => mockRecordLastEvent(...a),
}));

import { handleCreateEvent } from '../../../src/handlers/create-event.js';

const ctx = { userId: 'user-1', timezone: 'America/Chicago' };
const cal = {} as import('googleapis').calendar_v3.Calendar;

describe('handleCreateEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateEventWithSync.mockResolvedValue({
      id: 'ev-1',
      title: 'Team sync',
      start: '2026-06-10T19:00:00.000Z',
      end: '2026-06-10T20:00:00.000Z',
      gcalEventId: 'gcal-1',
      participants: ['alex@example.com'],
    });
    mockRecordLastEvent.mockResolvedValue(undefined);
  });

  it('creates event with provided params and records context', async () => {
    const parsed = ParsedIntentSchema.parse({
      intent: 'CREATE_EVENT',
      confidence: 0.95,
      params: {
        title: 'Team sync',
        start: '2026-06-10T19:00:00.000Z',
        end: '2026-06-10T20:00:00.000Z',
        participants: ['alex@example.com'],
        description: 'Weekly check-in',
      },
      mappingMethod: 'direct',
      rawUtterance: 'schedule team sync',
    });

    const result = await handleCreateEvent(parsed, ctx, cal);
    expect(result.success).toBe(true);
    expect(result.messageToUser).toMatch(/Team sync/i);
    expect(result.messageToUser).toMatch(/alex@example.com/i);
    expect(mockCreateEventWithSync).toHaveBeenCalledWith(
      cal,
      'user-1',
      expect.objectContaining({ title: 'Team sync', description: 'Weekly check-in' }),
    );
    expect(mockRecordLastEvent).toHaveBeenCalledWith(
      'user-1',
      'CREATE_EVENT',
      'schedule team sync',
      expect.objectContaining({ id: 'ev-1' }),
    );
  });

  it('creates recurring weekday event with timezone and invitee', async () => {
    const parsed = ParsedIntentSchema.parse({
      intent: 'CREATE_EVENT',
      confidence: 0.95,
      params: {
        title: 'Vibecoding',
        start: '2026-06-09T20:00:00.000Z',
        end: '2026-06-09T21:00:00.000Z',
        participants: ['aniket@opika.co'],
        isRecurring: true,
        recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'],
        timeZone: 'America/Chicago',
      },
      mappingMethod: 'direct',
      rawUtterance: 'send invite recurring weekdays',
    });

    const result = await handleCreateEvent(parsed, ctx, cal);
    expect(result.success).toBe(true);
    expect(result.messageToUser).toMatch(/repeats/i);
    expect(mockCreateEventWithSync).toHaveBeenCalledWith(
      cal,
      'user-1',
      expect.objectContaining({
        title: 'Vibecoding',
        isRecurring: true,
        recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'],
        timeZone: 'America/Chicago',
        participants: ['aniket@opika.co'],
      }),
    );
  });

  it('lists all invitees in success message', async () => {
    mockCreateEventWithSync.mockResolvedValue({
      id: 'ev-2',
      title: 'Vibecoding',
      start: '2026-06-09T20:00:00.000Z',
      end: '2026-06-09T20:30:00.000Z',
      gcalEventId: 'gcal-2',
      participants: ['aniket@opika.co', 'kanth@opika.co'],
    });
    const parsed = ParsedIntentSchema.parse({
      intent: 'CREATE_EVENT',
      confidence: 0.95,
      params: {
        title: 'Vibecoding',
        start: '2026-06-09T20:00:00.000Z',
        end: '2026-06-09T20:30:00.000Z',
        participants: ['aniket@opika.co', 'kanth@opika.co'],
        description: 'Invited by Caladdin',
        isRecurring: true,
        recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'],
        timeZone: 'America/Chicago',
      },
      mappingMethod: 'direct',
      rawUtterance: 'send invite to two people',
    });

    const result = await handleCreateEvent(parsed, ctx, cal);
    expect(result.messageToUser).toMatch(/aniket@opika\.co/);
    expect(result.messageToUser).toMatch(/kanth@opika\.co/);
  });

  it('defaults start/end when missing', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-08T12:00:00.000Z'));
    try {
      const parsed = ParsedIntentSchema.parse({
        intent: 'CREATE_EVENT',
        confidence: 0.9,
        params: { title: 'Dinner' },
        mappingMethod: 'direct',
        rawUtterance: 'book dinner',
      });
      await handleCreateEvent(parsed, ctx, cal);
      expect(mockCreateEventWithSync).toHaveBeenCalledWith(
        cal,
        'user-1',
        expect.objectContaining({ title: 'Dinner', start: expect.any(String), end: expect.any(String) }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
