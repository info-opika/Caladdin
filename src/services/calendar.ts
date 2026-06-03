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

export type { CandidateSlot };
