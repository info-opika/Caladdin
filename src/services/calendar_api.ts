import { calendar_v3 } from 'googleapis';
import { enqueueCompensation } from '../db/compensation_queue.js';
import { insertEvent, updateEvent, listEvents, cancelEvent as dbCancelEvent } from '../db/events.js';
import { CalendarEvent } from '../core/adts.js';
import { formatZonedDateTime, gcalErrorMessage, normalizeGCalRange } from '../core/date-utils.js';
import { logger } from '../logger.js';
import { getAccessTokenForUser } from './auth_service.js';
import type { OAuth2Client } from 'google-auth-library';
import { listGCalEventsViaHttps, queryFreeBusyViaHttps, type GCalEventItem } from './google_https.js';

type GCalEventRow = { title: string; start: string; end: string; gcalEventId: string };

function accessTokenFromCalendar(cal: calendar_v3.Calendar): string | null {
  const auth = (cal as unknown as { context?: { _options?: { auth?: OAuth2Client } } }).context?._options
    ?.auth;
  const token = auth?.credentials?.access_token;
  return typeof token === 'string' && token.trim() ? token.trim() : null;
}

async function resolveGCalAccessToken(
  cal: calendar_v3.Calendar,
  userId?: string,
): Promise<string | null> {
  if (userId) {
    try {
      const token = await getAccessTokenForUser(userId);
      if (token) return token;
    } catch (e) {
      logger.warn('GCal access token lookup failed; falling back to client credentials', {
        userId,
        error: String(e),
      });
    }
  }
  return accessTokenFromCalendar(cal);
}

function mapGCalItemsToEventRows(items: GCalEventItem[]): GCalEventRow[] {
  return items
    .filter((item) => item.status !== 'cancelled')
    .map((item) => {
      const start = item.start?.dateTime ?? (item.start?.date ? `${item.start.date}T00:00:00.000Z` : null);
      const end = item.end?.dateTime ?? (item.end?.date ? `${item.end.date}T00:00:00.000Z` : null);
      if (!start || !end) return null;
      return {
        title: item.summary ?? 'Busy',
        start,
        end,
        gcalEventId: item.id ?? '',
      };
    })
    .filter((e): e is GCalEventRow => e !== null);
}

function gcalAttendees(participants: string[] | undefined) {
  return (participants ?? []).map((email) => ({ email }));
}

function eventDateTime(iso: string, timeZone?: string) {
  if (timeZone) {
    return { dateTime: formatZonedDateTime(iso, timeZone), timeZone };
  }
  return { dateTime: iso };
}

function eventRequestBody(event: CalendarEvent) {
  return {
    summary: event.title,
    start: eventDateTime(event.start, event.timeZone),
    end: eventDateTime(event.end, event.timeZone),
    ...(event.description ? { description: event.description } : {}),
    ...(event.participants?.length ? { attendees: gcalAttendees(event.participants) } : {}),
    ...(event.recurrence?.length ? { recurrence: event.recurrence } : {}),
  };
}

export async function syncEventToGCal(
  cal: calendar_v3.Calendar,
  userId: string,
  event: CalendarEvent,
  operation: 'create' | 'update' | 'delete',
  options?: { sendUpdates?: 'all' | 'externalOnly' | 'none' },
): Promise<string | null> {
  try {
    if (operation === 'create') {
      const res = await cal.events.insert({
        calendarId: 'primary',
        sendUpdates: options?.sendUpdates ?? (event.participants?.length ? 'all' : 'none'),
        requestBody: eventRequestBody(event),
      });
      return res.data.id ?? null;
    }
    if (operation === 'update' && event.gcalEventId) {
      await cal.events.patch({
        calendarId: 'primary',
        eventId: event.gcalEventId,
        sendUpdates: options?.sendUpdates ?? (event.participants?.length ? 'all' : 'none'),
        requestBody: eventRequestBody(event),
      });
      return event.gcalEventId;
    }
    if (operation === 'delete' && event.gcalEventId) {
      await cal.events.delete({ calendarId: 'primary', eventId: event.gcalEventId });
      return null;
    }
    return event.gcalEventId ?? null;
  } catch (e) {
    logger.warn('GCal sync failed', { userId, operation, error: String(e) });
    await enqueueCompensation({
      userId,
      operation: `gcal_${operation}`,
      payload: { eventId: event.id, gcalEventId: event.gcalEventId, event },
    });
    return null;
  }
}

export async function createEventWithSync(
  cal: calendar_v3.Calendar | null,
  userId: string,
  event: Omit<CalendarEvent, 'id' | 'userId'>,
): Promise<CalendarEvent> {
  const inserted = await insertEvent(userId, event);
  if (cal) {
    const toSync: CalendarEvent = {
      ...inserted,
      recurrence: event.recurrence ?? inserted.recurrence,
      timeZone: event.timeZone ?? inserted.timeZone,
    };
    const gcalId = await syncEventToGCal(cal, userId, toSync, 'create');
    if (gcalId && gcalId !== inserted.gcalEventId) {
      return updateEvent(inserted.id, { gcalEventId: gcalId });
    }
  }
  return inserted;
}

export async function cancelEventWithSync(
  cal: calendar_v3.Calendar | null,
  userId: string,
  event: CalendarEvent,
): Promise<void> {
  if (event.status === 'cancelled') return;
  await dbCancelEvent(event.id);
  if (cal && event.gcalEventId) {
    await syncEventToGCal(cal, userId, { ...event, status: 'cancelled' }, 'delete');
  }
}

export async function deleteEventByTitle(
  cal: calendar_v3.Calendar | null,
  userId: string,
  titleNeedle: string,
  utterance?: string,
): Promise<{ deleted: boolean; title?: string; message: string }> {
  const needle = normalizeTitleNeedle(titleNeedle);

  if (cal) {
    const { timeMin, timeMax } = normalizeGCalRange(undefined, undefined, 90);
    const { events, error } = await listEventsFromGCalSafe(cal, timeMin, timeMax, userId);

    if (error) {
      return {
        deleted: false,
        message: 'I could not read your Google Calendar. Try signing out and signing in again.',
      };
    }

    const match = findGCalTitleMatch(events, needle, utterance);
    if (match?.gcalEventId) {
      try {
        await cal.events.delete({ calendarId: 'primary', eventId: match.gcalEventId });
      } catch (e) {
        logger.warn('GCal delete failed', { error: String(e), gcalEventId: match.gcalEventId });
        return {
          deleted: false,
          message: gcalErrorMessage(e),
        };
      }

      const dbEvents = await listEvents(userId);
      const dbMatch = dbEvents.find(
        (e) => e.gcalEventId === match.gcalEventId || titlesMatch(e.title, needle),
      );
      if (dbMatch) {
        await dbCancelEvent(dbMatch.id);
      }

      return {
        deleted: true,
        title: match.title,
        message: `Removed "${match.title}" from your calendar.`,
      };
    }
  }

  const dbEvents = await listEvents(userId);
  const dbMatch = dbEvents.find((e) => titlesMatch(e.title, needle));
  if (dbMatch) {
    await cancelEventWithSync(cal, userId, dbMatch);
    return {
      deleted: true,
      title: dbMatch.title,
      message: `Removed "${dbMatch.title}" from your calendar.`,
    };
  }

  return {
    deleted: false,
    message: `I couldn't find "${titleNeedle}" on your calendar.`,
  };
}

function normalizeTitleNeedle(title: string): string {
  return title.replace(/^\[(Protected|Proposed)\]\s*/i, '').toLowerCase().trim();
}

function titlesMatch(eventTitle: string, needle: string): boolean {
  const normalized = normalizeTitleNeedle(eventTitle);
  if (!needle) return false;
  if (normalized.includes(needle) || needle.includes(normalized)) return true;
  const words = needle.split(/\s+/).filter((w) => w.length > 2);
  return words.length > 0 && words.every((w) => normalized.includes(w));
}

function findGCalTitleMatch(
  events: Array<{ title: string; gcalEventId: string }>,
  needle: string,
  utterance?: string,
): { title: string; gcalEventId: string } | undefined {
  let match = events.find((e) => titlesMatch(e.title, needle));
  if (!match && utterance) {
    match = events.find((e) => utterance.toLowerCase().includes(e.title.toLowerCase()));
  }
  return match;
}

export async function addInviteesToGCalEvent(
  cal: calendar_v3.Calendar,
  gcalEventId: string,
  emails: string[],
): Promise<{ participants: string[]; added: string[] }> {
  const existing = await cal.events.get({ calendarId: 'primary', eventId: gcalEventId });
  const current = (existing.data.attendees ?? [])
    .map((a) => a.email?.toLowerCase())
    .filter((e): e is string => Boolean(e));
  const toAdd = emails.filter((e) => !current.includes(e.toLowerCase()));
  const merged = [...new Set([...current, ...emails.map((e) => e.toLowerCase())])];

  if (toAdd.length > 0) {
    await cal.events.patch({
      calendarId: 'primary',
      eventId: gcalEventId,
      sendUpdates: 'all',
      requestBody: {
        attendees: merged.map((email) => ({ email })),
      },
    });
  }

  return { participants: merged, added: toAdd };
}

export async function listBusyFromGCal(
  cal: calendar_v3.Calendar,
  timeMin: string,
  timeMax: string,
  userId?: string,
): Promise<Array<{ start: string; end: string }>> {
  try {
    const accessToken = await resolveGCalAccessToken(cal, userId);
    if (accessToken) {
      return await queryFreeBusyViaHttps(accessToken, timeMin, timeMax);
    }

    const res = await cal.freebusy.query({
      requestBody: {
        timeMin,
        timeMax,
        items: [{ id: 'primary' }],
      },
    });
    const busy = res.data.calendars?.primary?.busy ?? [];
    return busy.map((b) => ({ start: b.start!, end: b.end! }));
  } catch (e) {
    logger.warn('freebusy query failed', { error: String(e) });
    return [];
  }
}

export async function listEventsFromGCal(
  cal: calendar_v3.Calendar,
  timeMin: string,
  timeMax: string,
  userId?: string,
  maxResults = 50,
): Promise<GCalEventRow[]> {
  const accessToken = await resolveGCalAccessToken(cal, userId);
  if (accessToken) {
    const items = await listGCalEventsViaHttps(accessToken, timeMin, timeMax, maxResults);
    return mapGCalItemsToEventRows(items);
  }

  const res = await cal.events.list({
    calendarId: 'primary',
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: 'startTime',
    maxResults,
  });

  return mapGCalItemsToEventRows((res.data.items ?? []) as GCalEventItem[]);
}

export async function listEventsFromGCalSafe(
  cal: calendar_v3.Calendar,
  timeMin: string,
  timeMax: string,
  userId?: string,
): Promise<{ events: GCalEventRow[]; error?: string }> {
  try {
    const events = await listEventsFromGCal(cal, timeMin, timeMax, userId);
    return { events };
  } catch (e) {
    const error = gcalErrorMessage(e);
    logger.warn('GCal list failed', { error, timeMin, timeMax });
    return { events: [], error };
  }
}

export async function importEventsFromGCal(
  cal: calendar_v3.Calendar,
  userId: string,
  timeMin: string,
  timeMax: string,
): Promise<number> {
  const res = await cal.events.list({
    calendarId: 'primary',
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: 'startTime',
  });
  return persistImportedGCalItems(userId, res.data.items ?? []);
}

/** Sign-in import via node:https (avoids gaxios premature-close on Render). */
export async function importEventsFromGCalWithToken(
  accessToken: string,
  userId: string,
  timeMin: string,
  timeMax: string,
): Promise<number> {
  const items = await listGCalEventsViaHttps(accessToken, timeMin, timeMax);
  return persistImportedGCalItems(userId, items);
}

async function persistImportedGCalItems(
  userId: string,
  items: Array<{
    id?: string | null;
    summary?: string | null;
    start?: { dateTime?: string | null } | null;
    end?: { dateTime?: string | null } | null;
  }>,
): Promise<number> {
  let count = 0;
  for (const item of items) {
    if (!item.start?.dateTime || !item.end?.dateTime) continue;
    await insertEvent(userId, {
      title: item.summary ?? 'Busy',
      start: item.start.dateTime,
      end: item.end.dateTime,
      tier: 2,
      status: 'confirmed',
      gcalEventId: item.id ?? undefined,
    });
    count++;
  }
  return count;
}
