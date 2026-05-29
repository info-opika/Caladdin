import { calendar_v3 } from 'googleapis';
import { enqueueCompensation } from '../db/compensation_queue.js';
import { insertEvent, updateEvent, cancelEvent as dbCancelEvent } from '../db/events.js';
import { CalendarEvent } from '../core/adts.js';
import { gcalErrorMessage } from '../core/date-utils.js';
import { logger } from '../logger.js';

export async function syncEventToGCal(
  cal: calendar_v3.Calendar,
  userId: string,
  event: CalendarEvent,
  operation: 'create' | 'update' | 'delete',
): Promise<string | null> {
  try {
    if (operation === 'create') {
      const res = await cal.events.insert({
        calendarId: 'primary',
        requestBody: {
          summary: event.title,
          start: { dateTime: event.start },
          end: { dateTime: event.end },
        },
      });
      return res.data.id ?? null;
    }
    if (operation === 'update' && event.gcalEventId) {
      await cal.events.patch({
        calendarId: 'primary',
        eventId: event.gcalEventId,
        requestBody: {
          summary: event.title,
          start: { dateTime: event.start },
          end: { dateTime: event.end },
        },
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
    const gcalId = await syncEventToGCal(cal, userId, inserted, 'create');
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

export async function listBusyFromGCal(
  cal: calendar_v3.Calendar,
  timeMin: string,
  timeMax: string,
): Promise<Array<{ start: string; end: string }>> {
  try {
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
): Promise<Array<{ title: string; start: string; end: string; gcalEventId: string }>> {
  const res = await cal.events.list({
    calendarId: 'primary',
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 50,
  });

  return (res.data.items ?? [])
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
    .filter((e): e is NonNullable<typeof e> => e !== null);
}

export async function listEventsFromGCalSafe(
  cal: calendar_v3.Calendar,
  timeMin: string,
  timeMax: string,
): Promise<{ events: Array<{ title: string; start: string; end: string; gcalEventId: string }>; error?: string }> {
  try {
    const events = await listEventsFromGCal(cal, timeMin, timeMax);
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
  let count = 0;
  for (const item of res.data.items ?? []) {
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
