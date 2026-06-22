import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ParsedIntentSchema } from '../../../src/core/adts.js';

const mockListEvents = vi.fn();
const mockCancelEventWithSync = vi.fn();
const mockDeleteEventByTitle = vi.fn();

vi.mock('../../../src/db/events.js', () => ({
  listEvents: (...a: unknown[]) => mockListEvents(...a),
}));

vi.mock('../../../src/services/calendar_api.js', () => ({
  cancelEventWithSync: (...a: unknown[]) => mockCancelEventWithSync(...a),
  deleteEventByTitle: (...a: unknown[]) => mockDeleteEventByTitle(...a),
}));

import { handleFlushRange } from '../../../src/handlers/flush-range.js';

const ctx = { userId: 'user-1', timezone: 'America/Chicago' };
const cal = {} as import('googleapis').calendar_v3.Calendar;

describe('handleFlushRange', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCancelEventWithSync.mockResolvedValue(undefined);
  });

  it('deletes single event by title when utterance is delete', async () => {
    mockDeleteEventByTitle.mockResolvedValue({
      deleted: true,
      message: 'Removed "Dentist".',
    });
    const parsed = ParsedIntentSchema.parse({
      intent: 'FLUSH_RANGE',
      confidence: 0.9,
      params: { eventTitle: 'Dentist' },
      mappingMethod: 'direct',
      rawUtterance: 'delete my dentist appointment',
    });
    const result = await handleFlushRange(parsed, ctx, cal);
    expect(result.success).toBe(true);
    expect(result.messageToUser).toMatch(/Dentist/i);
    expect(mockDeleteEventByTitle).toHaveBeenCalled();
  });

  it('deletes from database when Google client is unavailable', async () => {
    mockDeleteEventByTitle.mockResolvedValue({
      deleted: true,
      title: 'Dentist',
      message: 'Removed "Dentist" from your calendar.',
    });
    const parsed = ParsedIntentSchema.parse({
      intent: 'FLUSH_RANGE',
      confidence: 0.9,
      params: { eventTitle: 'Dentist' },
      mappingMethod: 'direct',
      rawUtterance: 'delete dentist',
    });
    const result = await handleFlushRange(parsed, ctx, null);
    expect(result.success).toBe(true);
    expect(result.messageToUser).toMatch(/Dentist/i);
    expect(mockDeleteEventByTitle).toHaveBeenCalledWith(null, 'user-1', 'Dentist', 'delete dentist');
  });

  it('cancels tier>0 events in range', async () => {
    mockListEvents.mockResolvedValue([
      { id: 'e1', status: 'confirmed', tier: 2, title: 'A' },
      { id: 'e2', status: 'confirmed', tier: 0, title: 'Sacred' },
      { id: 'e3', status: 'cancelled', tier: 2, title: 'Old' },
    ]);
    const parsed = ParsedIntentSchema.parse({
      intent: 'FLUSH_RANGE',
      confidence: 0.9,
      params: {
        rangeStart: '2026-06-01T00:00:00.000Z',
        rangeEnd: '2026-06-07T00:00:00.000Z',
      },
      mappingMethod: 'direct',
      rawUtterance: 'clear my calendar tomorrow',
    });
    const result = await handleFlushRange(parsed, ctx, cal);
    expect(result.success).toBe(true);
    expect(result.eventsAffected).toBe(1);
    expect(mockCancelEventWithSync).toHaveBeenCalledTimes(1);
  });

  it('reports when no events in range', async () => {
    mockListEvents.mockResolvedValue([]);
    const parsed = ParsedIntentSchema.parse({
      intent: 'FLUSH_RANGE',
      confidence: 0.9,
      params: {
        rangeStart: '2026-06-01T00:00:00.000Z',
        rangeEnd: '2026-06-07T00:00:00.000Z',
      },
      mappingMethod: 'direct',
      rawUtterance: 'clear week',
    });
    const result = await handleFlushRange(parsed, ctx, cal);
    expect(result.messageToUser).toMatch(/No events to cancel/i);
  });
});
