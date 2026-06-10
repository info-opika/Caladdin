import { DateTime } from 'luxon';

/**
 * Parse invitee free-text date + window into a concrete start (ISO) in `timeZone`.
 * Returns null if we cannot derive a reliable start time (host should clarify).
 */
export function parseProposalToStartEnd(
  proposedDate: string,
  proposedTimeWindow: string,
  durationMinutes: number,
  timeZone: string
): { start: string; end: string } | null {
  const date = parseDateOnly(proposedDate, timeZone);
  if (!date) return null;
  const start = parseTimeWindowStart(date, proposedTimeWindow, timeZone);
  if (!start) return null;
  const end = start.plus({ minutes: durationMinutes });
  return { start: start.toISO()!, end: end.toISO()! };
}

function parseDateOnly(raw: string, timeZone: string): DateTime | null {
  const t = raw.trim();
  if (!t) return null;
  let dt = DateTime.fromISO(t, { zone: timeZone });
  if (dt.isValid) return dt.startOf('day');
  dt = DateTime.fromFormat(t, 'yyyy-MM-dd', { zone: timeZone });
  if (dt.isValid) return dt.startOf('day');
  dt = DateTime.fromFormat(t, 'M/d/yyyy', { zone: timeZone });
  if (dt.isValid) return dt.startOf('day');
  dt = DateTime.fromFormat(t, 'MMMM d, yyyy', { zone: timeZone });
  if (dt.isValid) return dt.startOf('day');
  dt = DateTime.fromFormat(t, 'MMM d yyyy', { zone: timeZone });
  if (dt.isValid) return dt.startOf('day');
  return null;
}

function parseTimeWindowStart(day: DateTime, windowRaw: string, timeZone: string): DateTime | null {
  const w = windowRaw.toLowerCase().trim();
  if (!w) return null;

  const rangeEndMeridian = w.match(
    /^(\d{1,2})(?::(\d{2}))?\s*[-–]\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*$/i
  );
  if (rangeEndMeridian) {
    let h = parseInt(rangeEndMeridian[1]!, 10);
    const m = rangeEndMeridian[2] ? parseInt(rangeEndMeridian[2], 10) : 0;
    const ap = rangeEndMeridian[5]!.toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    return day.set({ hour: h, minute: m, second: 0, millisecond: 0 });
  }

  const range = w.match(/(\d{1,2})\s*(?::(\d{2}))?\s*(am|pm)?\s*[-–]\s*(\d{1,2})\s*(?::(\d{2}))?\s*(am|pm)?/i);
  if (range) {
    let h = parseInt(range[1]!, 10);
    const m = range[2] ? parseInt(range[2], 10) : 0;
    let ap = range[3]?.toLowerCase() ?? range[6]?.toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    return day.set({ hour: h, minute: m, second: 0, millisecond: 0 });
  }

  const single = w.match(/^(\d{1,2})\s*(?::(\d{2}))?\s*(am|pm)\s*$/i);
  if (single) {
    let h = parseInt(single[1]!, 10);
    const m = single[2] ? parseInt(single[2], 10) : 0;
    const ap = single[3]!.toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    return day.set({ hour: h, minute: m, second: 0, millisecond: 0 });
  }

  const h24 = w.match(/^(\d{1,2}):(\d{2})$/);
  if (h24) {
    return day.set({
      hour: parseInt(h24[1]!, 10),
      minute: parseInt(h24[2]!, 10),
      second: 0,
      millisecond: 0,
    });
  }

  return null;
}
