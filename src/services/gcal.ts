import type { OAuth2Client } from 'google-auth-library';
import { listBusyFromGCal } from './calendar_api.js';

export { listBusyFromGCal, listEventsFromGCal } from './calendar_api.js';

export async function gcalGetFreeBusy(
  oauthClient: OAuth2Client,
  timeMin: string,
  timeMax: string,
): Promise<Array<{ start: string; end: string }>> {
  const { google } = await import('googleapis');
  const cal = google.calendar({ version: 'v3', auth: oauthClient });
  return listBusyFromGCal(cal, timeMin, timeMax);
}

export async function gcalDeleteEvent(
  cal: import('googleapis').calendar_v3.Calendar,
  eventId: string,
): Promise<void> {
  await cal.events.delete({ calendarId: 'primary', eventId });
}
