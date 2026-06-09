import {
  addDays,
  addMinutes,
  extractTimezoneFromUtterance,
  formatISO,
  getLocalPartsInTimezone,
  nextWeekdayOccurrence,
  startOfDay,
  zonedLocalToUtcDate,
} from './date-utils.js';
import { ParsedIntent, ParsedIntentSchema } from './adts.js';

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PLACEHOLDER_TITLE_RE = /^(?:<unknown>|unknown)$/i;

/** LLMs sometimes emit placeholder titles; treat them as missing. */
export function sanitizeTitle(title: string | undefined): string | undefined {
  if (!title?.trim()) return undefined;
  const t = title.trim();
  if (PLACEHOLDER_TITLE_RE.test(t)) return undefined;
  return t;
}

export function extractEmails(utterance: string): string[] {
  return [...new Set((utterance.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase()))];
}

export function isInviteUtterance(utterance: string): boolean {
  if (!utterance) return false;
  const hasEmail = extractEmails(utterance).length > 0;
  if (!hasEmail) return false;
  return /\b(invite|invitee|guest|attendee|add\s+.+@|include\s+.+@|send\s+(?:an?\s+)?invite)\b/i.test(utterance);
}

/** Creating a new calendar event with invitees (not adding to an existing event). */
export function isNewEventInviteUtterance(utterance: string): boolean {
  if (!isInviteUtterance(utterance)) return false;
  if (isRecurringCreateUtterance(utterance)) return true;
  if (/\bsend\s+(?:an?\s+)?invite\b/i.test(utterance)) return true;
  if (/\b(name|call)\s+(?:the\s+)?event\b/i.test(utterance)) return true;
  if (/\b(at|for)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/i.test(utterance)) return true;
  if (/\binvite .+ to (?:the |my )?(?:meeting|event)\b/i.test(utterance)) return false;
  return isCreateEventUtterance(utterance);
}

export function isRecurringCreateUtterance(utterance: string): boolean {
  return /\b(recurring|repeats?|every\s+weekday|weekdays?|monday\s+to\s+friday|mon(?:day)?\s*[-–]\s*fri(?:day)?|every\s+(?:monday|tuesday|wednesday|thursday|friday|mon|tue|wed|thu|fri))\b/i.test(utterance);
}

/** Build Google Calendar RRULE strings from natural language. */
export function extractRecurrenceFromUtterance(utterance: string): string[] | undefined {
  const lower = utterance.toLowerCase();
  if (/\bevery\s+weekday|weekdays?\b|monday\s+to\s+friday|mon(?:day)?\s*[-–]\s*fri(?:day)?\b/.test(lower)) {
    return ['RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'];
  }
  const dayTokenRe = /\b(?:every\s+)?(mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?|mon|tue|wed|thu|fri|sat|sun)\b/g;
  const dayMap: Record<string, string> = {
    monday: 'MO', mon: 'MO', tuesday: 'TU', tue: 'TU', wednesday: 'WE', wed: 'WE',
    thursday: 'TH', thu: 'TH', friday: 'FR', fri: 'FR', saturday: 'SA', sat: 'SA', sunday: 'SU', sun: 'SU',
  };
  const dayMatches = [...lower.matchAll(dayTokenRe)];
  if (dayMatches.length > 0 && /\b(recurring|repeats?|every)\b/.test(lower)) {
    const days = [...new Set(dayMatches.map((m) => dayMap[m[1].replace(/s$/, '')]).filter(Boolean))];
    if (days.length) return [`RRULE:FREQ=WEEKLY;BYDAY=${days.join(',')}`];
  }
  if (/\bevery\s+day\b/.test(lower) || /\bdaily\s+(?:standup|meeting|sync|call)\b/.test(lower)
    || (/\b(daily|every\s+day)\b/.test(lower) && /\b(recurring|repeats?)\b/.test(lower))) {
    return ['RRULE:FREQ=DAILY'];
  }
  if (/\bbiweekly\b/.test(lower) || /\bevery\s+other\s+week\b/.test(lower)) {
    const days = [...new Set(dayMatches.map((m) => dayMap[m[1].replace(/s$/, '')]).filter(Boolean))];
    if (days.length) return [`RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=${days.join(',')}`];
    return ['RRULE:FREQ=WEEKLY;INTERVAL=2'];
  }
  if (/\bweekly\b/.test(lower) && /\b(recurring|repeats?|every)\b/.test(lower)) {
    return ['RRULE:FREQ=WEEKLY'];
  }
  return undefined;
}

export function isReferentialUtterance(utterance: string): boolean {
  return /\b(that event|that meeting|the event|this event|it|that one|the last one|same event)\b/i.test(utterance);
}

export function isCalendarInviteUtterance(utterance: string): boolean {
  return isInviteUtterance(utterance) || (extractEmails(utterance).length > 0 && /\b(invite|guest|attendee|add)\b/i.test(utterance));
}

/** Scheduling / fax-effect link requests (OFFER_SPECIFIC), e.g. "send a booking link to …". */
export function isSchedulingLinkUtterance(utterance: string): boolean {
  if (/\b(booking|scheduling)\s+link\b/i.test(utterance)) return true;
  const hasEmail = extractEmails(utterance).length > 0;
  if (hasEmail && /\b(send|email)\b.*\blink\b/i.test(utterance)) return true;
  if (hasEmail && /\blink\b.*\b(to|for)\b/i.test(utterance)) return true;
  return false;
}

/** User is asking to create/schedule a brand-new event (not modify an existing one). */
export function isCreateEventUtterance(utterance: string): boolean {
  return /\b(create|schedule|book|set up)\s+(?:a\s+)?(?:new\s+)?event\b/i.test(utterance)
    || /\bnew event for\b/i.test(utterance);
}

/** Pull event title from natural language (Name it X, called "X", etc.) */
export function extractTitle(utterance: string): string | undefined {
  const patterns = [
    /(?:name(?:\s+the)?\s+event(?:\s+as)?|name(?:\s+it)?(?:\s+as)?|named|call(?:\s+it)?(?:\s+as)?|title(?:\s+is)?)\s+['"]([^'"]+)['"]/i,
    /(?:name(?:\s+the)?\s+event(?:\s+as)?|name(?:\s+it)?(?:\s+as)?|named|call(?:\s+it)?(?:\s+as)?|title(?:\s+is)?)\s+(.+?)(?:\s+and\s+(?:then\s+)?(?:invite|add|with|description)|\.?\s*$)/i,
  ];
  for (const re of patterns) {
    const m = utterance.match(re);
    if (m?.[1]?.trim()) return sanitizeTitle(m[1].trim());
  }
  if (!/(?:description|notes)\s+['"]/i.test(utterance)) {
    const quoted = utterance.match(/['"]([^'"]+)['"]/);
    if (quoted?.[1]?.trim()) return sanitizeTitle(quoted[1].trim());
  }
  return undefined;
}

/** Pull event description/notes from natural language */
export function extractDescription(utterance: string): string | undefined {
  const tail = utterance.match(
    /(?:please\s+)?(?:add (?:an? )?event description|with (?:an? )?(?:event )?description|(?:set )?(?:the )?event description|description)\s+(.+?)\.?\s*$/i,
  );
  if (tail?.[1]?.trim()) {
    let d = tail[1].trim();
    if ((d.startsWith("'") && d.endsWith("'")) || (d.startsWith('"') && d.endsWith('"'))) {
      d = d.slice(1, -1);
    }
    return d;
  }
  return undefined;
}

/** Pull target new title for rename utterances */
export function extractNewTitle(utterance: string): string | undefined {
  const patterns = [
    /(?:rename(?:\s+(?:it|the event))?|retitle(?:\s+the event)?)\s+to\s+['"]([^'"]+)['"]/i,
    /(?:rename(?:\s+(?:it|the event))?|retitle(?:\s+the event)?)\s+to\s+(.+?)\.?\s*$/i,
    /(?:change (?:the )?(?:event )?name to|call it|name it)\s+['"]([^'"]+)['"]/i,
    /(?:change (?:the )?(?:event )?name to|call it|name it)\s+(.+?)\.?\s*$/i,
  ];
  for (const re of patterns) {
    const m = utterance.match(re);
    if (m?.[1]?.trim()) return sanitizeTitle(m[1].trim());
  }
  return sanitizeTitle(extractTitle(utterance));
}

/** Which existing event the user refers to (by title fragment) */
export function extractEventReference(utterance: string): string | undefined {
  // "rename the event to X" — the phrase after "the event" is the new title, not a lookup key.
  if (/\brename\b.*\bto\b/i.test(utterance) || /\bname it\b/i.test(utterance)) {
    return undefined;
  }

  const quoted = utterance.match(/['"]([^'"]+)['"]/);
  if (quoted?.[1]?.trim()) return quoted[1].trim();

  const removeMatch = utterance.match(/\b(?:remove|delete|cancel)\s+(?:the\s+)?(.+?)\s+event\b/i);
  if (removeMatch?.[1]?.trim()) return removeMatch[1].trim();

  const m = utterance.match(/(?:the event|event)\s+['"]([^'"]+)['"]/i);
  if (m?.[1]?.trim()) return m[1].trim();
  return undefined;
}

export function isDeleteUtterance(utterance: string): boolean {
  if (!utterance) return false;
  if (!/\b(remove|delete|cancel)\b/i.test(utterance)) return false;
  if (/\b(clear|wipe|flush|everything|all day|all my)\b/i.test(utterance)) return false;
  return Boolean(extractEventReference(utterance) || /\b(?:remove|delete|cancel)\s+(?:the\s+)?\S+/i.test(utterance));
}

/** Normalize parsed intent loaded from Supabase JSON (handles snake_case drift). */
export function normalizeStoredParsed(raw: unknown): ParsedIntent {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid stored parsed intent');
  }
  const p = raw as Record<string, unknown>;
  return ParsedIntentSchema.parse({
    intent: p.intent,
    confidence: Number(p.confidence ?? 1),
    params: (p.params ?? {}) as Record<string, unknown>,
    mappingMethod: p.mappingMethod ?? p.mapping_method ?? 'direct',
    rawUtterance: String(p.rawUtterance ?? p.raw_utterance ?? ''),
    _destructivePreFilter: p._destructivePreFilter ?? p._destructive_pre_filter,
    _warmRedirect: p._warmRedirect ?? p._warm_redirect,
    _offTopic: p._offTopic ?? p._off_topic,
  });
}

/** Re-enrich params and force delete utterances onto FLUSH_RANGE before execution. */
export function prepareParsedForExecution(parsed: ParsedIntent): ParsedIntent {
  const rawUtterance = parsed.rawUtterance ?? '';
  const enrichedParams = parsed.intent === 'CREATE_EVENT'
    ? enrichCreateParams(parsed.params ?? {}, rawUtterance)
    : enrichModifyParams(parsed.params ?? {}, rawUtterance);
  const params = enrichFlushParams(enrichedParams, rawUtterance);

  if (isDeleteUtterance(rawUtterance)) {
    return ParsedIntentSchema.parse({
      ...parsed,
      intent: 'FLUSH_RANGE',
      params,
      _destructivePreFilter: true,
    });
  }

  return ParsedIntentSchema.parse({ ...parsed, params });
}

export function isRenameUtterance(utterance: string): boolean {
  return /\b(rename|retitle|change the name|change the event name|call it|name it)\b/i.test(utterance);
}

export function isModifyUtterance(utterance: string): boolean {
  return /\b(update|change|correct|fix|move|reschedule|starting at|ending at|\d+\s*hour|make it|should be)\b/i.test(utterance);
}

const TIME_RE = /\b(?:at|for)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b|\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i;

function parseClockMatch(match: RegExpMatchArray, base: Date, timeZone?: string): Date {
  const hourStr = match[1] ?? match[4];
  const minuteStr = match[2] ?? match[5];
  const ampm = (match[3] ?? match[6])?.toLowerCase();
  let hour = parseInt(hourStr, 10);
  const minute = minuteStr ? parseInt(minuteStr, 10) : 0;

  if (ampm === 'pm' && hour < 12) hour += 12;
  if (ampm === 'am' && hour === 12) hour = 0;
  if (!ampm && hour >= 1 && hour <= 7) hour += 12;

  if (timeZone) {
    const local = getLocalPartsInTimezone(base, timeZone);
    return zonedLocalToUtcDate(local.year, local.month, local.day, hour, minute, timeZone);
  }

  const d = new Date(base);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function dayBaseFromUtterance(utterance: string, ref: Date, timeZone?: string): Date {
  const lower = utterance.toLowerCase();
  if (timeZone) {
    const local = getLocalPartsInTimezone(ref, timeZone);
    let year = local.year;
    let month = local.month;
    let day = local.day;
    if (lower.includes('tomorrow')) {
      const tomorrow = addDays(zonedLocalToUtcDate(year, month, day, 12, 0, timeZone), 1);
      const t = getLocalPartsInTimezone(tomorrow, timeZone);
      year = t.year; month = t.month; day = t.day;
    }
    return zonedLocalToUtcDate(year, month, day, 0, 0, timeZone);
  }
  if (lower.includes('tomorrow')) return startOfDay(addDays(ref, 1));
  if (lower.includes('today')) return startOfDay(ref);
  return startOfDay(ref);
}

/** Parse "starting at 8 AM ... ending at 9 AM" style corrections */
export function parseModifyTimeRange(
  utterance: string,
  ref = new Date(),
  timeZone?: string,
): { newStart?: string; newEnd?: string } {
  const tz = timeZone ?? extractTimezoneFromUtterance(utterance);
  const base = dayBaseFromUtterance(utterance, ref, tz);
  const startRe = /\bstarting(?:\s+at)?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i;
  const endRe = /\bending(?:\s+at)?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i;

  const sm = utterance.match(startRe);
  const em = utterance.match(endRe);
  const out: { newStart?: string; newEnd?: string } = {};

  if (sm) out.newStart = formatISO(parseClockMatch(sm, base, tz));
  if (em) out.newEnd = formatISO(parseClockMatch(em, base, tz));

  const hourDur = utterance.match(/\b(\d+(?:\.\d+)?)\s*hour(?:\s+event)?\b/i);
  if (hourDur && out.newStart && !out.newEnd) {
    const mins = Math.round(parseFloat(hourDur[1]) * 60);
    out.newEnd = formatISO(addMinutes(new Date(out.newStart), mins));
  }

  if (!out.newStart && !out.newEnd) {
    const single = parseStartEndFromUtterance(utterance, ref, 60, tz);
    if (single) {
      out.newStart = single.start;
      out.newEnd = single.end;
    }
  }

  return out;
}

/** Parse duration like "for 30 minutes", "12 minutes duration", or "30 minute event" */
export function extractDurationMinutes(utterance: string): number | undefined {
  const forMin = utterance.match(/\bfor\s+(\d+)\s*(?:minute|min)s?\b/i);
  if (forMin) return parseInt(forMin[1], 10);
  const minDur = utterance.match(/\b(\d+)\s*(?:minute|min)s?\s+duration\b/i);
  if (minDur) return parseInt(minDur[1], 10);
  const andMin = utterance.match(/\band\s+(\d+)\s*(?:minute|min)s?\s+duration\b/i);
  if (andMin) return parseInt(andMin[1], 10);
  const hourDur = utterance.match(/\b(\d+(?:\.\d+)?)\s*hours?\s+duration\b/i);
  if (hourDur) return Math.round(parseFloat(hourDur[1]) * 60);
  return undefined;
}

/** Parse "tomorrow at 8 AM" style phrases into ISO start/end (1h default duration) */
export function parseStartEndFromUtterance(
  utterance: string,
  ref = new Date(),
  durationMinutes = 60,
  timeZone?: string,
): { start: string; end: string; timeZone?: string } | null {
  const tz = timeZone ?? extractTimezoneFromUtterance(utterance);
  const lower = utterance.toLowerCase();
  const base = dayBaseFromUtterance(utterance, ref, tz);

  const tm = utterance.match(TIME_RE);
  if (!tm) return null;

  let hour = parseInt(tm[1] ?? tm[4], 10);
  const minute = tm[2] ?? tm[5] ? parseInt(tm[2] ?? tm[5], 10) : 0;
  const ampm = (tm[3] ?? tm[6])?.toLowerCase();
  if (ampm === 'pm' && hour < 12) hour += 12;
  if (ampm === 'am' && hour === 12) hour = 0;
  if (!ampm && hour >= 1 && hour <= 7) hour += 12;

  let start: Date;
  if (tz && isRecurringCreateUtterance(utterance) && !/\b(tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(lower)) {
    start = nextWeekdayOccurrence(ref, hour, minute, tz);
  } else if (tz) {
    const local = getLocalPartsInTimezone(base, tz);
    start = zonedLocalToUtcDate(local.year, local.month, local.day, hour, minute, tz);
  } else {
    start = parseClockMatch(tm, base, tz);
  }

  const end = addMinutes(start, durationMinutes);
  return { start: formatISO(start), end: formatISO(end), ...(tz ? { timeZone: tz } : {}) };
}

/** Merge parsed clock time onto an existing event's calendar date */
export function mergeTimeOntoEventDate(isoTime: string, eventStartIso: string): string {
  const t = new Date(isoTime);
  const e = new Date(eventStartIso);
  e.setHours(t.getHours(), t.getMinutes(), 0, 0);
  return e.toISOString();
}

/** Merge LLM params with regex fallbacks from the raw utterance */
export function enrichCreateParams(
  params: Record<string, unknown>,
  utterance: string,
  defaultTimezone?: string,
): Record<string, unknown> {
  const out = { ...params };
  out.title = sanitizeTitle(out.title as string | undefined)
    ?? sanitizeTitle(extractTitle(utterance));
  const tz = (out.timeZone as string | undefined)
    ?? extractTimezoneFromUtterance(utterance)
    ?? defaultTimezone;
  if (tz) out.timeZone = tz;

  const durationMinutes = extractDurationMinutes(utterance);
  if (!out.start || !out.end) {
    const range = parseStartEndFromUtterance(utterance, new Date(), durationMinutes ?? 60, tz);
    if (range) {
      if (!out.start) out.start = range.start;
      if (!out.end) out.end = range.end;
      if (range.timeZone && !out.timeZone) out.timeZone = range.timeZone;
    }
  } else if (durationMinutes && out.start) {
    out.end = formatISO(addMinutes(new Date(out.start as string), durationMinutes));
  }

  const recurrence = (out.recurrence as string[] | undefined) ?? extractRecurrenceFromUtterance(utterance);
  if (recurrence?.length) {
    out.recurrence = recurrence;
    out.isRecurring = true;
  } else if (out.isRecurring === undefined && isRecurringCreateUtterance(utterance)) {
    out.isRecurring = true;
  }

  const emails = extractEmails(utterance);
  if (emails.length && (/\b(invite|with|add|include|guest|attendee|send)\b/i.test(utterance) || isInviteUtterance(utterance))) {
    out.participants = [...new Set([...(out.participants as string[] | undefined ?? []), ...emails])];
  }
  if (!out.description) {
    const d = extractDescription(utterance);
    if (d) out.description = d;
  } else if (typeof out.description === 'string') {
    out.description = out.description.trim();
  }
  return out;
}

export function enrichFlushParams(
  params: Record<string, unknown>,
  utterance: string,
): Record<string, unknown> {
  const out = { ...params };
  if (!out.eventTitle && isDeleteUtterance(utterance)) {
    const ref = extractEventReference(utterance);
    if (ref) out.eventTitle = ref;
  }
  return out;
}

export function enrichModifyParams(
  params: Record<string, unknown>,
  utterance: string,
): Record<string, unknown> {
  const out = { ...params };
  out.newTitle = sanitizeTitle(out.newTitle as string | undefined);
  out.eventTitle = sanitizeTitle(out.eventTitle as string | undefined);
  if (!out.newTitle && isRenameUtterance(utterance)) {
    const t = extractNewTitle(utterance);
    if (t) out.newTitle = t;
  }
  if (!out.eventTitle) {
    const ref = extractEventReference(utterance);
    if (ref) out.eventTitle = ref;
  }
  if (!out.newStart && !out.newEnd) {
    const range = parseModifyTimeRange(utterance);
    if (range.newStart) out.newStart = range.newStart;
    if (range.newEnd) out.newEnd = range.newEnd;
  }
  if (isInviteUtterance(utterance)) {
    const emails = (out.addInvitees as string[] | undefined) ?? extractEmails(utterance);
    if (emails.length) out.addInvitees = emails;
  }
  if (!out.newDescription) {
    const d = extractDescription(utterance);
    if (d) out.newDescription = d;
  } else if (typeof out.newDescription === 'string') {
    out.newDescription = out.newDescription.trim();
  }
  return out;
}

export function hasActionableParams(intent: string, params: Record<string, unknown>): boolean {
  switch (intent) {
    case 'CREATE_EVENT':
      return Boolean(params.title || params.start || params.recurrence || params.isRecurring);
    case 'MODIFY_EVENT':
      return Boolean(
        params.newTitle || params.newStart || params.newEnd || params.eventTitle || params.addInvitees || params.newDescription,
      );
    case 'QUERY_CALENDAR':
    case 'PROTECT_BLOCK':
      return Boolean(params.eventTitle || params.rangeStart);
    case 'OFFER_SPECIFIC':
      return Boolean(params.recipientEmail || params.eventTitle || params.rangeStart || params.durationMinutes);
    case 'FLUSH_RANGE':
      return Boolean(params.eventTitle || params.rangeStart);
    case 'UNDO':
      return true;
    default:
      return false;
  }
}
