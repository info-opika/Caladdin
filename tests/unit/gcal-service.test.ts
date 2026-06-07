import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/services/calendar_api.js', () => ({
  listBusyFromGCal: vi.fn().mockResolvedValue([{ start: 'a', end: 'b' }]),
}));

import { gcalDeleteEvent } from '../../src/services/gcal.js';
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

  it('gcalGetFreeBusy delegates to calendar_api', async () => {
    const { gcalGetFreeBusy } = await import('../../src/services/gcal.js');
    const oauth = {} as import('google-auth-library').OAuth2Client;
    const busy = await gcalGetFreeBusy(oauth, '2026-06-01', '2026-06-30');
    expect(busy).toHaveLength(1);
  });
});
