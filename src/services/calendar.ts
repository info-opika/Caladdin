import { calendar_v3 } from 'googleapis';
import type { CandidateSlot } from '../core/adts.js';

export async function createCalendarEvent(
  cal: calendar_v3.Calendar,
  opts: {
    summary: string;
    start: string;
    end: string;
    attendees?: string[];
    description?: string;
  },
): Promise<{ id: string }> {
  const res = await cal.events.insert({
    calendarId: 'primary',
    sendUpdates: opts.attendees?.length ? 'all' : 'none',
    requestBody: {
      summary: opts.summary,
      start: { dateTime: opts.start },
      end: { dateTime: opts.end },
      description: opts.description,
      attendees: opts.attendees?.map((email) => ({ email })),
    },
  });
  return { id: res.data.id ?? '' };
}

export async function updateCalendarEvent(
  cal: calendar_v3.Calendar,
  eventId: string,
  opts: {
    summary?: string;
    start: string;
    end: string;
    attendees?: string[];
    description?: string;
  },
): Promise<void> {
  await cal.events.patch({
    calendarId: 'primary',
    eventId,
    sendUpdates: opts.attendees?.length ? 'all' : 'none',
    requestBody: {
      summary: opts.summary,
      start: { dateTime: opts.start },
      end: { dateTime: opts.end },
      description: opts.description,
      attendees: opts.attendees?.map((email) => ({ email })),
    },
  });
}

export type { CandidateSlot };
