import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockCancel = vi.fn();
const mockEnqueue = vi.fn();
const mockListEvents = vi.fn();

vi.mock('../../src/db/events.js', () => ({
  insertEvent: (...a: unknown[]) => mockInsert(...a),
  updateEvent: (...a: unknown[]) => mockUpdate(...a),
  cancelEvent: (...a: unknown[]) => mockCancel(...a),
  listEvents: (...a: unknown[]) => mockListEvents(...a),
}));

vi.mock('../../src/db/compensation_queue.js', () => ({
  enqueueCompensation: (...a: unknown[]) => mockEnqueue(...a),
}));

import {
  createEventWithSync,
  listEventsFromGCalSafe,
  cancelEventWithSync,
} from '../../src/services/calendar_api.js';

const baseEvent = {
  id: 'ev-1',
  userId: 'user-1',
  title: 'Sync',
  start: '2026-06-10T15:00:00.000Z',
  end: '2026-06-10T16:00:00.000Z',
  participants: [],
  tier: 2,
  isRecurring: false,
  status: 'confirmed' as const,
  gcalEventId: null,
  proposedForSession: null,
  description: null,
};

function mockCal(over: { insertId?: string; listItems?: unknown[]; fail?: boolean } = {}) {
  return {
    events: {
      insert: vi.fn().mockImplementation(async () => {
        if (over.fail) throw new Error('gcal down');
        return { data: { id: over.insertId ?? 'gcal-new-1' } };
      }),
      patch: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
      list: vi.fn().mockResolvedValue({
        data: { items: over.listItems ?? [] },
      }),
    },
  } as unknown as import('googleapis').calendar_v3.Calendar;
}

describe('calendar_api service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsert.mockResolvedValue({ ...baseEvent, gcalEventId: null });
    mockUpdate.mockImplementation(async (_id, patch) => ({ ...baseEvent, ...patch }));
    mockCancel.mockResolvedValue(undefined);
    mockEnqueue.mockResolvedValue(undefined);
  });

  it('createEventWithSync inserts locally then syncs GCal id', async () => {
    const cal = mockCal({ insertId: 'gcal-99' });
    mockUpdate.mockResolvedValue({ ...baseEvent, gcalEventId: 'gcal-99' });
    const result = await createEventWithSync(cal, 'user-1', {
      title: 'Sync',
      start: baseEvent.start,
      end: baseEvent.end,
      tier: 2,
      status: 'confirmed',
      participants: [],
      isRecurring: false,
    });
    expect(mockInsert).toHaveBeenCalled();
    expect(result.gcalEventId).toBe('gcal-99');
  });

  it('createEventWithSync works without calendar client', async () => {
    const result = await createEventWithSync(null, 'user-1', {
      title: 'Local only',
      start: baseEvent.start,
      end: baseEvent.end,
      tier: 2,
      status: 'confirmed',
      participants: [],
      isRecurring: false,
    });
    expect(result.title).toBe('Sync');
  });

  it('listEventsFromGCalSafe maps API items', async () => {
    const cal = mockCal({
      listItems: [
        {
          id: 'g1',
          summary: 'Dentist',
          start: { dateTime: '2026-06-10T15:00:00Z' },
          end: { dateTime: '2026-06-10T16:00:00Z' },
        },
      ],
    });
    const { events, error } = await listEventsFromGCalSafe(cal, '2026-06-01', '2026-06-30');
    expect(error).toBeUndefined();
    expect(events[0].title).toBe('Dentist');
  });

  it('cancelEventWithSync cancels db and deletes from GCal', async () => {
    const cal = mockCal();
    await cancelEventWithSync(cal, 'user-1', { ...baseEvent, gcalEventId: 'gcal-1' });
    expect(mockCancel).toHaveBeenCalledWith('ev-1');
    expect(cal.events.delete).toHaveBeenCalled();
  });

  it('deleteEventByTitle removes matching GCal event', async () => {
    const cal = mockCal({
      listItems: [
        {
          id: 'gcal-dentist',
          summary: 'Dentist',
          start: { dateTime: '2026-06-10T15:00:00Z' },
          end: { dateTime: '2026-06-10T16:00:00Z' },
        },
      ],
    });
    mockListEvents.mockResolvedValue([
      { id: 'ev-2', title: 'Dentist', gcalEventId: 'gcal-dentist', status: 'confirmed' },
    ]);
    const { deleteEventByTitle } = await import('../../src/services/calendar_api.js');
    const result = await deleteEventByTitle(cal, 'user-1', 'Dentist');
    expect(result.deleted).toBe(true);
    expect(result.message).toMatch(/Dentist/i);
  });

  it('addInviteesToGCalEvent merges attendees', async () => {
    const get = vi.fn().mockResolvedValue({
      data: { attendees: [{ email: 'existing@example.com' }] },
    });
    const patch = vi.fn().mockResolvedValue({});
    const cal = { events: { get, patch } } as unknown as import('googleapis').calendar_v3.Calendar;
    const { addInviteesToGCalEvent } = await import('../../src/services/calendar_api.js');
    const result = await addInviteesToGCalEvent(cal, 'gcal-1', ['new@example.com']);
    expect(result.added).toContain('new@example.com');
    expect(patch).toHaveBeenCalled();
  });

  it('listBusyFromGCal returns busy blocks', async () => {
    const query = vi.fn().mockResolvedValue({
      data: { calendars: { primary: { busy: [{ start: '2026-06-10T15:00:00Z', end: '2026-06-10T16:00:00Z' }] } } },
    });
    const cal = { freebusy: { query } } as unknown as import('googleapis').calendar_v3.Calendar;
    const { listBusyFromGCal, importEventsFromGCal } = await import('../../src/services/calendar_api.js');
    const busy = await listBusyFromGCal(cal, '2026-06-01', '2026-06-30');
    expect(busy).toHaveLength(1);

    mockListEvents.mockResolvedValue([]);
    const cal2 = mockCal({
      listItems: [
        {
          id: 'g1',
          summary: 'Import me',
          start: { dateTime: '2026-06-10T15:00:00Z' },
          end: { dateTime: '2026-06-10T16:00:00Z' },
        },
      ],
    });
    const count = await importEventsFromGCal(cal2, 'user-1', '2026-06-01', '2026-06-30');
    expect(count).toBe(1);
  });
});
