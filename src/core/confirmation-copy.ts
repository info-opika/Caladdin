import { DateTime } from 'luxon';
import type { Intent, ParsedIntent } from './adts.js';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function formatClock12(hhmm: string, tz: string): string {
  const parts = hhmm.split(':');
  if (parts.length < 2) return hhmm;
  const dt = DateTime.fromISO(`2020-01-01T${parts[0]}:${parts[1]}:00`, { zone: tz });
  if (!dt.isValid) return hhmm;
  return dt.toFormat('h:mm a');
}

function formatDays(daysOfWeek: number[]): string {
  const unique = [...new Set(daysOfWeek)].sort((a, b) => a - b);
  if (unique.length === 0) return '';
  if (unique.length === 7) return 'every day';
  if (unique.join(',') === '1,2,3,4,5') return 'weekdays';
  if (unique.join(',') === '0,6') return 'weekends';
  return unique.map((d) => DAY_NAMES[d] ?? String(d)).join(', ');
}

function formatIsoFriendly(iso: string, tz: string): string {
  const dt = DateTime.fromISO(iso, { zone: tz });
  if (!dt.isValid) return iso;
  return dt.toFormat('cccc, MMM d \'at\' h:mm a');
}

function daysBetweenInclusive(startYmd: string, endYmd: string, tz: string): number | null {
  const start = DateTime.fromISO(startYmd, { zone: tz }).startOf('day');
  const end = DateTime.fromISO(endYmd, { zone: tz }).startOf('day');
  if (!start.isValid || !end.isValid) return null;
  return Math.max(1, Math.floor(end.diff(start, 'days').days) + 1);
}

function protectBlockCopy(params: Record<string, unknown>, tz: string): string {
  const label = String(params.label ?? 'Protected time');
  const startTime = typeof params.startTime === 'string' ? formatClock12(params.startTime, tz) : '';
  const endTime = typeof params.endTime === 'string' ? formatClock12(params.endTime, tz) : '';
  const days = Array.isArray(params.daysOfWeek)
    ? formatDays(params.daysOfWeek.filter((x): x is number => typeof x === 'number'))
    : '';
  const rangeEnd = typeof params.rangeEnd === 'string' ? params.rangeEnd : '';
  const startDate = typeof params.startDate === 'string' ? params.startDate : undefined;

  const timePhrase =
    startTime && endTime ? `${startTime} to ${endTime}` : startTime || endTime || 'the requested time';

  let schedule = days ? `${days} at ${timePhrase}` : timePhrase;

  if (rangeEnd) {
    const span =
      startDate != null ? daysBetweenInclusive(startDate, rangeEnd, tz) : null;
    if (span != null && span <= 14) {
      schedule = `daily ${label}, ${startTime || timePhrase}, for the next ${span} days`;
    } else {
      const endLabel = DateTime.fromISO(rangeEnd, { zone: tz }).toFormat('MMM d, yyyy');
      schedule = `${schedule} through ${endLabel}`;
    }
  }

  return `Block ${label} — ${schedule}?`;
}

function offerSpecificCopy(params: Record<string, unknown>, tz: string): string {
  const email =
    (typeof params.recipientEmail === 'string' && params.recipientEmail) ||
    (typeof params.inviteeEmail === 'string' && params.inviteeEmail) ||
    (typeof params.email === 'string' && params.email) ||
    'your guest';
  const duration =
    typeof params.durationMinutes === 'number' && params.durationMinutes > 0
      ? params.durationMinutes
      : 30;
  const durationLabel =
    duration % 60 === 0 && duration >= 60
      ? `${duration / 60}-hour`
      : `${duration}-minute`;
  return `Invite ${email} to a ${durationLabel} meeting — I'll send them two time options?`;
}

function modifyEventCopy(params: Record<string, unknown>, tz: string): string {
  const title = String(params.newTitle ?? params.eventTitle ?? 'the event');
  const newStart = typeof params.newStart === 'string' ? formatIsoFriendly(params.newStart, tz) : '';
  if (newStart) {
    return `Move "${title}" to ${newStart}?`;
  }
  return `Update "${title}" as requested?`;
}

function flushRangeCopy(params: Record<string, unknown>, tz: string, utterance: string): string {
  const eventTitle = typeof params.eventTitle === 'string' ? params.eventTitle : '';
  if (eventTitle) {
    return `Delete "${eventTitle}"?`;
  }
  const rangeStart = typeof params.rangeStart === 'string' ? params.rangeStart : '';
  const rangeEnd = typeof params.rangeEnd === 'string' ? params.rangeEnd : '';
  if (rangeStart && rangeEnd) {
    const start = DateTime.fromISO(rangeStart, { zone: tz });
    const end = DateTime.fromISO(rangeEnd, { zone: tz });
    if (start.isValid && end.isValid && start.hasSame(end, 'day')) {
      return `Clear all events on ${start.toFormat('cccc, MMM d')}?`;
    }
    if (start.isValid && end.isValid) {
      return `Clear events from ${start.toFormat('MMM d')} through ${end.toFormat('MMM d')}?`;
    }
  }
  const snippet = utterance.trim().slice(0, 80);
  return snippet ? `Clear calendar events for: ${snippet}?` : 'Clear the selected calendar events?';
}

/**
 * Plain-language confirmation restating the parsed action (not "Confirm: INTENT").
 */
export function generateConfirmationCopy(
  parsed: ParsedIntent,
  timezone: string,
): string {
  const tz = timezone || 'America/Chicago';
  const params = parsed.params ?? {};

  switch (parsed.intent as Intent) {
    case 'PROTECT_BLOCK':
      return protectBlockCopy(params, tz);
    case 'OFFER_SPECIFIC':
    case 'SCHEDULING_LINK':
      return offerSpecificCopy(params, tz);
    case 'MODIFY_EVENT':
      return modifyEventCopy(params, tz);
    case 'FLUSH_RANGE':
      return flushRangeCopy(params, tz, parsed.rawUtterance);
    default:
      return `Go ahead with: ${parsed.rawUtterance.slice(0, 120)}?`;
  }
}
