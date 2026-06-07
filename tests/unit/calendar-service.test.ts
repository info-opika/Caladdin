import { describe, it, expect, vi } from 'vitest';

describe('calendar service', () => {
  it('createCalendarEvent inserts event and returns id', async () => {
    vi.resetModules();
    const insert = vi.fn().mockResolvedValue({ data: { id: 'gcal-evt-1' } });
    const cal = { events: { insert } } as unknown as import('googleapis').calendar_v3.Calendar;

    const { createCalendarEvent, updateCalendarEvent } = await import('../../src/services/calendar.js');

    const created = await createCalendarEvent(cal, {
      summary: 'Meet',
      start: '2026-06-10T15:00:00-05:00',
      end: '2026-06-10T16:00:00-05:00',
      attendees: ['guest@example.com'],
    });
    expect(created.id).toBe('gcal-evt-1');
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarId: 'primary',
        sendUpdates: 'all',
      }),
    );

    const patch = vi.fn().mockResolvedValue({});
    const cal2 = { events: { patch } } as unknown as import('googleapis').calendar_v3.Calendar;
    await updateCalendarEvent(cal2, 'gcal-evt-1', {
      summary: 'Updated',
      start: '2026-06-10T16:00:00-05:00',
      end: '2026-06-10T17:00:00-05:00',
    });
    expect(patch).toHaveBeenCalled();
  });
});
