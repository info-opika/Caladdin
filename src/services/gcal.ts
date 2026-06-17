import { google, calendar_v3 } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import { listBusyFromGCal } from './calendar_api.js';
import { logger } from '../logger.js';
import { isKillSwitchActive } from '../pilot/pilot_controls.js';

export { listBusyFromGCal, listEventsFromGCal } from './calendar_api.js';

function safeTz(tz?: string): string {
  return tz && tz.trim() !== '' ? tz : 'UTC';
}

export async function gcalGetFreeBusy(
  oauthClient: OAuth2Client,
  timeMin: string,
  timeMax: string,
): Promise<Array<{ start: string; end: string }>> {
  const cal = google.calendar({ version: 'v3', auth: oauthClient });
  return listBusyFromGCal(cal, timeMin, timeMax);
}

export async function gcalCreateRecurringEvent(
  auth: OAuth2Client,
  config: {
    title: string;
    startDateTimeIso: string;
    endDateTimeIso: string;
    daysOfWeek: number[];
    timezone: string;
    untilUtcRfc: string;
  },
): Promise<void> {
  if (isKillSwitchActive()) {
    logger.error('KILL SWITCH: blocked recurring calendar write', { title: config.title });
    throw new Error('Calendar writes blocked: kill switch active');
  }
  const daysMap: Record<number, string> = { 0: 'SU', 1: 'MO', 2: 'TU', 3: 'WE', 4: 'TH', 5: 'FR', 6: 'SA' };
  const byDay = [...new Set(config.daysOfWeek)].sort((a, b) => a - b).map((d) => daysMap[d]).join(',');
  await google.calendar('v3').events.insert({
    auth,
    calendarId: 'primary',
    requestBody: {
      summary: config.title,
      start: { dateTime: config.startDateTimeIso, timeZone: safeTz(config.timezone) },
      end: { dateTime: config.endDateTimeIso, timeZone: safeTz(config.timezone) },
      recurrence: [`RRULE:FREQ=WEEKLY;BYDAY=${byDay};UNTIL=${config.untilUtcRfc}`],
      extendedProperties: {
        private: {
          caladdin_source: 'block',
        },
      },
    },
  });
}

export async function gcalUpdateEvent(
  auth: OAuth2Client,
  eventId: string,
  patch: { start?: string; end?: string; summary?: string; timezone?: string },
): Promise<void> {
  if (isKillSwitchActive()) {
    throw new Error('Calendar writes blocked: kill switch active');
  }
  const requestBody: calendar_v3.Schema$Event = {};
  if (patch.summary) requestBody.summary = patch.summary;
  if (patch.start) requestBody.start = { dateTime: patch.start, timeZone: safeTz(patch.timezone) };
  if (patch.end) requestBody.end = { dateTime: patch.end, timeZone: safeTz(patch.timezone) };
  await google.calendar('v3').events.patch({
    auth,
    calendarId: 'primary',
    eventId,
    requestBody,
  });
}

export async function gcalListEvents(
  auth: OAuth2Client,
  timeMin: string,
  timeMax: string,
): Promise<calendar_v3.Schema$Event[]> {
  const res = await google.calendar('v3').events.list({
    auth,
    calendarId: 'primary',
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 250,
  });
  return res.data.items || [];
}

export async function gcalDeleteEvent(
  authOrCal: OAuth2Client | calendar_v3.Calendar,
  eventId: string,
): Promise<void> {
  if (isKillSwitchActive()) {
    throw new Error('Calendar writes blocked: kill switch active');
  }
  if ('events' in authOrCal && typeof authOrCal.events?.delete === 'function') {
    await authOrCal.events.delete({ calendarId: 'primary', eventId });
    return;
  }
  try {
    await google.calendar('v3').events.delete({
      auth: authOrCal as OAuth2Client,
      calendarId: 'primary',
      eventId,
    });
  } catch (err: unknown) {
    const code = (err as { code?: number }).code;
    if (code !== 410 && code !== 404) throw err;
  }
}
