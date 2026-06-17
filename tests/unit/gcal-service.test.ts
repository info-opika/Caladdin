import { describe, it, expect, vi } from 'vitest';

const insertMock = vi.fn().mockResolvedValue({ data: { id: 'evt-1' } });

vi.mock('../../src/services/calendar_api.js', () => ({
  listBusyFromGCal: vi.fn().mockResolvedValue([{ start: 'a', end: 'b' }]),
}));

vi.mock('../../src/pilot/pilot_controls.js', () => ({
  isKillSwitchActive: vi.fn().mockReturnValue(false),
}));

vi.mock('googleapis', () => ({
  google: {
    calendar: vi.fn(() => ({
      events: { insert: insertMock },
    })),
  },
}));

import { gcalDeleteEvent, gcalCreateRecurringEvent } from '../../src/services/gcal.js';
import { listBusyFromGCal } from '../../src/services/calendar_api.js';

describe('gcal service', () => {
  it('gcalDeleteEvent calls calendar delete', async () => {
    const del = vi.fn().mockResolvedValue({});
    const cal = { events: { delete: del } } as unknown as import('googleapis').calendar_v3.Calendar;
    await gcalDeleteEvent(cal, 'evt-1');
    expect(del).toHaveBeenCalledWith({ calendarId: 'primary', eventId: 'evt-1' });
  });

  it('re-exports listBusyFromGCal', async () => {
    const cal = {} as import('googleapis').calendar_v3.Calendar;
    const busy = await listBusyFromGCal(cal, '2026-06-01', '2026-06-30');
    expect(busy).toHaveLength(1);
  });

  it('gcalCreateRecurringEvent sets caladdin_source=block extended property', async () => {
    insertMock.mockClear();
    const auth = {} as import('google-auth-library').OAuth2Client;
    await gcalCreateRecurringEvent(auth, {
      title: 'Focus',
      startDateTimeIso: '2026-06-09T14:00:00-05:00',
      endDateTimeIso: '2026-06-09T15:00:00-05:00',
      daysOfWeek: [2],
      timezone: 'America/Chicago',
      untilUtcRfc: '20261231T235959Z',
    });

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({
          extendedProperties: { private: { caladdin_source: 'block' } },
        }),
      }),
    );
  });
});
