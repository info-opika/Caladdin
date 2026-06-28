import type { QueryCalendarParams } from './intents/query-calendar.js';
import { extractEmailFromText } from '../utils/email.js';

function matchWeekMeetingListUtterance(utterance: string): QueryCalendarParams | null {
  const low = utterance.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!/what\s+meetings?\s+do\s+i\s+have\b/.test(low)) return null;
  if (!/\b(this|next)\s+week\b/.test(low)) return null;
  const weekKind = /\bnext\s+week\b/.test(low) ? 'next_week' : 'this_week';
  const email = extractEmailFromText(utterance);
  return {
    queryType: 'week_range',
    weekRangeKind: weekKind,
    attendeeEmailSubstring: email ? email.toLowerCase() : undefined,
  };
}
import { normalizeSpacedAmPm } from './time-parse.js';

/** For availability: parse from raw utterance — normalizeCalendarQueryText turns `10:30` into `10 30`. */
function extractTimeTextFromRaw(raw: string): string | null {
  const s = normalizeSpacedAmPm(
    raw
      .toLowerCase()
      .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
  ).trim();
  const colon = s.match(/\b(\d{1,2}:\d{2})\s*(am|pm)?\b/);
  if (colon) {
    return colon[1]! + (colon[2] || '').toLowerCase();
  }
  const hourSpace = s.match(/\b(\d{1,2}\s*(?:am|pm))\b/);
  if (hourSpace) return hourSpace[1]!.toLowerCase().replace(/\s/g, '');
  const hourCompact = s.match(/\b(\d{1,2}(?:am|pm))\b/);
  if (hourCompact) return hourCompact[1]!.toLowerCase();
  const atHour = s.match(/\bat\s+(\d{1,2})(?:\s*(am|pm))?(?=\b|[?.!,\s]|$)/i);
  if (atHour) {
    if (atHour[2]) return `${atHour[1]}${atHour[2].toLowerCase()}`;
    return atHour[1]!;
  }
  
  // P0 FIX: Recognize time-of-day phrases (morning/afternoon/evening/night)
  // These should be deterministic, not LLM-dependent
  if (/\bmorning\b/.test(s)) return 'morning';
  if (/\bafternoon\b/.test(s)) return 'afternoon';
  if (/\bevening\b/.test(s)) return 'evening';
  if (/\bnight\b/.test(s) && !/\blast night\b/.test(s)) return 'night';
  
  return null;
}

/** "with Priya", "w/ Morgan" for next-meeting filters. */
export function extractPersonFilterFromUtterance(raw: string): string | null {
  const m = raw.match(/\b(?:with|w\/)\s+([A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*)?)\b/);
  if (!m) return null;
  const name = m[1]!.trim();
  if (/^(the|my|your|our|a|an)$/i.test(name)) return null;
  return name;
}

const CANONICAL: Record<string, QueryCalendarParams> = {
  // Today agenda
  'whats on my calendar today': { queryType: 'today', day: 'today' },
  'whats on my cal today': { queryType: 'today', day: 'today' },
  'agenda for today': { queryType: 'today', day: 'today' },
  'what is on my calendar tommorrow': { queryType: 'tomorrow', day: 'tomorrow' },
  'what do i have on my calendar tommorow': { queryType: 'tomorrow', day: 'tomorrow' },
  'whats the plan tomorrow morning': { queryType: 'tomorrow', day: 'tomorrow' },
  'whats on my cal tomorrow question mark': { queryType: 'tomorrow', day: 'tomorrow' },
  'what is on my calendar today': { queryType: 'today', day: 'today' },
  // Follow-up phrasing (same-day / next-day) without repeating full sentence
  'what about tomorrow': { queryType: 'tomorrow', day: 'tomorrow' },
  'what do i have today': { queryType: 'today', day: 'today' },
  'what have i got today': { queryType: 'today', day: 'today' },
  'show my calendar today': { queryType: 'today', day: 'today' },
  'show my meetings today': { queryType: 'today', day: 'today' },
  'what meetings do i have today': { queryType: 'today', day: 'today' },
  'what is on my calendar': { queryType: 'today', day: 'today' },
  'whats on my calendar': { queryType: 'today', day: 'today' },
  'how many meetings today': { queryType: 'count', day: 'today' },
  'how many meetings do i have today': { queryType: 'count', day: 'today' },
  // Tomorrow / schedule wording
  'whats on my calendar tomorrow': { queryType: 'tomorrow', day: 'tomorrow' },
  'what is on my calendar tomorrow': { queryType: 'tomorrow', day: 'tomorrow' },
  'what do i have tomorrow': { queryType: 'tomorrow', day: 'tomorrow' },
  'tomorrow schedule': { queryType: 'tomorrow', day: 'tomorrow' },
  'my schedule tomorrow': { queryType: 'tomorrow', day: 'tomorrow' },
  'whats on tomorrow': { queryType: 'tomorrow', day: 'tomorrow' },
  // This week / next week agenda
  'what is on my calendar this week': { queryType: 'week_range', weekRangeKind: 'this_week' },
  'whats on my calendar this week': { queryType: 'week_range', weekRangeKind: 'this_week' },
  'whats on my cal this week': { queryType: 'week_range', weekRangeKind: 'this_week' },
  'what do i have this week': { queryType: 'week_range', weekRangeKind: 'this_week' },
  'show my calendar this week': { queryType: 'week_range', weekRangeKind: 'this_week' },
  'show my meetings this week': { queryType: 'week_range', weekRangeKind: 'this_week' },
  'what is on my calendar next week': { queryType: 'week_range', weekRangeKind: 'next_week' },
  'whats on my calendar next week': { queryType: 'week_range', weekRangeKind: 'next_week' },
  'whats on my cal next week': { queryType: 'week_range', weekRangeKind: 'next_week' },
  'what do i have next week': { queryType: 'week_range', weekRangeKind: 'next_week' },
  // Next
  'whats next': { queryType: 'next' },
  'whats the next': { queryType: 'next' },
  'what is next': { queryType: 'next' },
  'what is my next meeting': { queryType: 'next' },
  'whats my next meeting': { queryType: 'next' },
  'next meeting': { queryType: 'next' },
  // Availability
  'am i free at 3': { queryType: 'availability', timeText: '3' },
  'am i available at 3': { queryType: 'availability', timeText: '3' },
  'am i free at 3pm': { queryType: 'availability', timeText: '3pm' },
  'am i available at 3pm': { queryType: 'availability', timeText: '3pm' },
  'do i have anything at 3pm': { queryType: 'availability', timeText: '3pm' },
};

/**
 * Lowercase, normalize apostrophes, strip punctuation, collapse spaces — for exact phrase keys only.
 */
export function normalizeCalendarQueryText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
    .replace(/'/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\btodays\b/g, 'today')
    .replace(/\btomorrows\b/g, 'tomorrow')
    .trim();
}

const NEXT_THING = /\b(meeting|event|call|appointment)\b/;
const NEXT_TIME_CHUNK =
  /\bnext\s+(?:week|month|year|day|winter|spring|summer|fall|autumn|quarter|mon|tue|tues|wed|thu|thur|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)\b/;

const NEXT_NON_USER = /\bnext\s+(?:apple|google|nfl|nba|nhl|keynote|i\/o|wwdc)\b|\b(apple|google)\b.*\b(event|keynote|stream)\b.*\b(cupertino|california|online|livestream)\b/i;

/** `next` + calendar noun, or “when do i meet next” (not “meet with X next week”, “next president”, or sports / product keynotes). */
function matchNextFamily(n: string): boolean {
  if (!/\bnext\b/.test(n)) return false;
  if (NEXT_TIME_CHUNK.test(n)) return false;
  if (NEXT_NON_USER.test(n)) return false;
  if (NEXT_THING.test(n)) return true;
  if (/\bmeet\b.*\bnext\b/.test(n) || /\bnext\b.*\bmeet\b/.test(n)) return true;
  return false;
}

const TODAY_TRAIL = (n: string) =>
  /\bcalendar\b/.test(n) ||
  /\bschedule\b/.test(n) ||
  /\bmeetings\b/.test(n) ||
  /\bevents\b/.test(n) ||
  /\bappointments\b/.test(n) ||
  n.includes('on my cal') ||
  n.includes('what do i have') ||
  n.includes('what have i got');

function matchTodayFamily(n: string): boolean {
  if (/\bhow many\b/.test(n) && /\b(meetings?|events?|appointments?|calls?)\b/.test(n) && /\btoday\b/.test(n)) {
    return true;
  }
  return /\btoday\b/.test(n) && TODAY_TRAIL(n);
}

function matchGeneralCalendarFamily(n: string): boolean {
  if (/\b(today|tomorrow|this week|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(n)) {
    return false;
  }
  return (
    n === 'what is on my calendar' ||
    n === 'whats on my calendar' ||
    n === 'show my calendar' ||
    n === 'what is on my cal' ||
    n === 'whats on my cal'
  );
}

const TOMORROW_EXTRAS = (n: string) =>
  TODAY_TRAIL(n) ||
  n.includes('what about tomorrow') ||
  /\bplan tomorrow\b/.test(n) ||
  /\bplan for tomorrow\b/.test(n) ||
  n === 'whats on tomorrow' ||
  n.endsWith('whats on tomorrow') ||
  (/\bdo i have\b/.test(n) && /\banything\b/.test(n) && /\btomorrow\b/.test(n));

function matchTomorrowFamily(n: string): boolean {
  return /\btomorrow\b/.test(n) && TOMORROW_EXTRAS(n);
}

/** Block/protect requests must not route to calendar read (e.g. "Texas Time" falsely matches `\btime\b`). */
const PROTECT_BLOCK_SIGNAL = /\b(block|protect|shield|reserve|hold|no-meeting)\b/i;

const AVAIL_SIGNAL =
  /\bfree\b|\bavailable\b|\bopen\b|\banything\b|conflicts?|\bany meetings\b|meetings at|\bbusy\b/;

function matchAvailabilityFamily(utterance: string, n: string): QueryCalendarParams | null {
  if (PROTECT_BLOCK_SIGNAL.test(utterance)) {
    return null;
  }
  if (/\bdon'?t want\b|\bnever want\b|\bshape\b|\brule\b|\bgatekeep\b/i.test(n)) {
    return null;
  }
  // P0 FIX: Exclude scheduling intent phrases (find/need/schedule time)
  // These must route to SCHEDULING_LINK, not QUERY_CALENDAR
  if (/\b(find|need|schedule|book|set\s+up|arrange)\s+(time|meeting|call)\b/.test(n)) {
    return null;
  }
  // P0 FIX: Exclude slot-offering phrases (give slots, show slots, etc.)
  if (/\b(give|show|send|offer)\s+(me\s+)?(slots?|times?|options)\b/.test(n)) {
    return null;
  }
  if (/\b(give|show|send|offer)\b[\s\S]{0,260}\b(?:slots?|time\s+slots|two\s+slots)\b/i.test(utterance)) {
    return null;
  }
  const lu = utterance.toLowerCase();
  if (/@/.test(lu)) {
    const looksInviteOrScheduling =
      /\b(find\s+time|booking\s+link|scheduling\s+link|\bcalendly\b)/i.test(lu) ||
      /\b(send|invite|guest|meet|create|set\s+up|schedule|pick|need|book|use|hook\s+me\s+up)\b[\s\S]{0,260}@\S+/i.test(lu) ||
      /\d{1,2}\s*[ap]m\b[\s\S]{0,140}@\S+|@\S+[\s\S]{0,140}\d{1,2}\s*[ap]m\b/i.test(lu);
    const looksAvailQuestion =
      /\b(am\s+i\s+(free|open|available)|do\s+i\s+have)\b[\s\S]{0,260}@\S+/i.test(lu);
    if (looksInviteOrScheduling && !looksAvailQuestion) {
      return null;
    }
  }
  // P0 FIX: Exclude "between X and Y" time window specification
  if (/\bbetween\s+\d{1,2}/.test(n)) {
    return null;
  }
  // P0 FIX: Exclude non-calendar queries (flights, weather, etc.) from availability matching
  // These should go to WARM_REDIRECT, not QUERY_CALENDAR
  if (/\b(flights?|flying|airline|itinerar)\b/.test(n)) return null;
  if (/\bweather\b/.test(n) && !/\b(calendar|schedule|meeting|appointment)\b/.test(n)) return null;
  
  if (!AVAIL_SIGNAL.test(n)) return null;
  
  // ZETA-B3: Support "next week" as a time window (all-day availability check)
  if (/\bnext\s+week\b/.test(n) && /\btime\b/.test(n)) {
    return { queryType: 'availability', timeText: 'next week' };
  }

  const availabilityDay =
    /\btomorrow\b/.test(n) ? ('tomorrow' as const) : /\btoday\b/.test(n) ? ('today' as const) : undefined;
  
  const timeText = extractTimeTextFromRaw(utterance);
  if (!timeText) return null;
  return { queryType: 'availability', timeText, ...(availabilityDay ? { availabilityDay } : {}) };
}

/** Heuristic: phrase-family matches after exact table — no LLM, no RESOLVE_MANUAL. */
function tryMatchQueryFamilies(utterance: string, n: string): QueryCalendarParams | null {
  // P0 FIX: Check availability FIRST when time-of-day phrase is present
  // "Am I free tomorrow afternoon?" should be availability, not tomorrow agenda
  const availabilityResult = matchAvailabilityFamily(utterance, n);
  if (availabilityResult) return availabilityResult;
  
  if (matchNextFamily(n)) {
    const personFilter = extractPersonFilterFromUtterance(utterance);
    return { queryType: 'next', ...(personFilter ? { personFilter } : {}) };
  }
  if (matchTodayFamily(n)) {
    if (/\bhow many\b/.test(n)) {
      return { queryType: 'count', day: 'today' };
    }
    return { queryType: 'today', day: 'today' };
  }
  if (matchTomorrowFamily(n)) {
    return { queryType: 'tomorrow', day: 'tomorrow' };
  }
  if (matchGeneralCalendarFamily(n)) {
    return { queryType: 'today', day: 'today' };
  }
  return null;
}

/** Deterministic intent for obvious calendar look-ups — no LLM, no RESOLVE_MANUAL. */
/** Strip Wispr / dictation openers so family rules still match. */
export function stripLeadFiller(n: string): string {
  return n
    .replace(/^((um|uh|so|like|well|ok|hey|yo|plz|please|can you|can we)\s+)+/i, '')
    .trim();
}

export function tryMatchQueryCalendar(utterance: string): QueryCalendarParams | null {
  if (PROTECT_BLOCK_SIGNAL.test(utterance)) {
    return null;
  }

  const weekRange = matchWeekMeetingListUtterance(utterance);
  if (weekRange) {
    return { ...weekRange };
  }

  const low = utterance.toLowerCase();
  if (/\bblock\s+\d{1,2}\s*[-–]\s*\d{1,2}\b/.test(low)) return null;

  const key = normalizeCalendarQueryText(utterance);
  const hit = CANONICAL[key];
  if (hit) {
    return { ...hit };
  }
  const forFamilies = stripLeadFiller(key);
  return tryMatchQueryFamilies(utterance, forFamilies);
}
