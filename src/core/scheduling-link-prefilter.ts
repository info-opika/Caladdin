import { extractEmailFromText } from '../utils/email.js';
import { normalizeCalendarQueryText, stripLeadFiller } from './query-prefilter.js';
import { DateTime } from 'luxon';

export type SchedulingLinkPrefilterParams = { inviteeEmail: string; inviteeLabel?: string };
export type SchedulingDateRange = { start: string; end: string };

/**
 * Transactional “share/create a scheduling or invite link” phrasing without an explicit calendar day.
 * When true alongside a matched invitee email, the parser may emit SCHEDULING_LINK and let the
 * handler apply the default rolling search window (see `scheduling-link` intent).
 */
export function transactionalSchedulingLinkAllowsImplicitSearchSpan(utterance: string): boolean {
  const u = utterance.toLowerCase();
  if (
    /\b(?:send|email|forward|share)\b[\s\S]{0,220}\b(?:scheduling\s+link|invite\s+link|booking\s+link)\b/.test(u)
  ) {
    return true;
  }
  if (/\b(?:create|make|generate)\b[\s\S]{0,220}\b(?:scheduling\s+link|booking\s+link)\b/.test(u)) {
    return true;
  }
  return false;
}

/** e.g. "afternoon or evening" — need a numeric window end, not a hidden default. */
const VAGUE_DAYPART_OR_DAYPART =
  /\b(?:morning|afternoon|evening)\s+or\s+(?:morning|afternoon|evening)\b/i;

function hourFromAmpm(h: number, ap: string): number {
  const low = ap.toLowerCase();
  let hh = h;
  if (low === 'pm' && hh < 12) hh += 12;
  if (low === 'am' && hh === 12) hh = 0;
  return Math.min(23, Math.max(0, hh));
}

/**
 * Parses an explicit **local** same-day search window (start hour, end hour in 0–23) when the user
 * gives concrete clock bounds (e.g. "9am to 5pm", "between 2pm and 6pm"). No silent 5pm/9pm/11pm —
 * if this returns null, do not invent a grid.
 */
export function extractSchedulingSearchWindowHours(utterance: string): {
  startHour: number;
  endHour: number;
} | null {
  const u = utterance
    .trim()
    .replace(/\b(\d{1,2})\s*noon\b/gi, (_, hour) => `${hour}pm`)
    .replace(/\bnoon\b/gi, '12pm');
  const tries: RegExp[] = [
    /\b(?:from\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*(?:to|through|[-–])\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i,
    /\bbetween\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s+and\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i,
  ];
  for (const re of tries) {
    const m = u.match(re);
    if (!m) continue;
    const h1 = parseInt(m[1]!, 10);
    const ap1 = m[3]!;
    const h2 = parseInt(m[4]!, 10);
    const ap2 = m[6]!;
    const startHour = hourFromAmpm(h1, ap1);
    const endHour = hourFromAmpm(h2, ap2);
    if (startHour < endHour) return { startHour, endHour };
  }
  return null;
}

const WEEKDAY_NAME_TO_LUXON: Record<string, number> = {
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
  sunday: 7,
  sun: 7,
};

function sameIsoWeek(a: DateTime, b: DateTime): boolean {
  return a.isValid && b.isValid && a.weekYear === b.weekYear && a.weekNumber === b.weekNumber;
}

/** Resolve a named weekday anchor in the user's TZ; `prefixedNext` matches "next Friday" style wording. */
export function resolveSchedulingWeekdayDate(
  nowDay: DateTime,
  weekdayNameToken: keyof typeof WEEKDAY_NAME_TO_LUXON,
  prefixedNext: boolean
): DateTime {
  const key = weekdayNameToken.toLowerCase() as keyof typeof WEEKDAY_NAME_TO_LUXON;
  const tgt = WEEKDAY_NAME_TO_LUXON[key];
  if (tgt === undefined) {
    return nowDay.startOf('day');
  }
  const today = nowDay.startOf('day');
  const dowToday = today.weekday;
  let delta = (tgt - dowToday + 7) % 7;
  let cand = today.plus({ days: delta });

  if (prefixedNext) {
    if (delta === 0) {
      return today.plus({ days: 7 });
    }
    if (sameIsoWeek(cand, today)) {
      return cand.plus({ days: 7 });
    }
    return cand;
  }

  if (delta === 0) {
    return cand;
  }
  return cand;
}

function captureFirstSchedulingWeekday(utterance: string): {
  token: keyof typeof WEEKDAY_NAME_TO_LUXON;
  prefixedNext: boolean;
} | null {
  const re =
    /\b(next)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\b/i;
  let m = utterance.match(re);
  if (m) {
    return { token: m[2]!.toLowerCase() as keyof typeof WEEKDAY_NAME_TO_LUXON, prefixedNext: Boolean(m[1]) };
  }
  const plain =
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\b/i.exec(
      utterance
    );
  if (!plain) return null;
  return { token: plain[1]!.toLowerCase() as keyof typeof WEEKDAY_NAME_TO_LUXON, prefixedNext: false };
}

export function extractSchedulingDateRange(
  utterance: string,
  timezone: string,
  nowOverride?: DateTime
): SchedulingDateRange | null {
  const n = utterance.toLowerCase();
  const now = (nowOverride ? nowOverride.setZone(timezone) : DateTime.now().setZone(timezone)).startOf('day');

  const wd = captureFirstSchedulingWeekday(utterance);
  if (wd) {
    const day = resolveSchedulingWeekdayDate(now, wd.token, wd.prefixedNext);
    if (day.isValid) {
      const d = day.toISODate()!;
      return { start: d, end: d };
    }
  }

  if (/\bthis\s+week\b/.test(n)) {
    const start = now.startOf('week');
    const end = now.endOf('week');
    return { start: start.toISODate()!, end: end.toISODate()! };
  }
  if (/\bnext\s+week\b/.test(n)) {
    const start = now.plus({ weeks: 1 }).startOf('week');
    const end = start.endOf('week');
    return { start: start.toISODate()!, end: end.toISODate()! };
  }
  if (/\bnext\s+month\b/.test(n)) {
    const start = now.plus({ months: 1 }).startOf('month');
    const end = start.endOf('month');
    return { start: start.toISODate()!, end: end.toISODate()! };
  }
  if (/\btomorrow\b|\btmrw\b/.test(n)) {
    const day = now.plus({ days: 1 });
    return { start: day.toISODate()!, end: day.toISODate()! };
  }
  if (/\btoday\b/.test(n)) {
    return { start: now.toISODate()!, end: now.toISODate()! };
  }
  return null;
}

/** Parsed duration when the utterance mentions minutes or common meeting lengths — default null (handler uses 30). */
export function extractDurationMinutes(utterance: string): number | null {
  const u = utterance.toLowerCase();
  if (/\bhalf\s+(?:an?\s+)?hour\b|\bhalf\s*-?\s*hour\b/.test(u)) return 30;
  if (/\b90\s*-?\s*min(?:utes?)?\b|\ban?\s+hour\s+and\s+a\s+half\b|\bone\s+and\s+(?:a\s+)?half\s+hours\b/.test(u))
    return 90;
  if (/\b45\s*-?\s*min(?:utes?)?\b/.test(u)) return 45;
  if (/(\b|^)120\s*-?\s*min(?:utes?)?\b/.test(u)) return 120;
  if (/\bone\s*-?\s*hour\b|\b60\s*-?\s*min(?:utes?)?\b|\b(?:an?\s+)?single\s+hour\b|\ba\s+full\s+hour\b/.test(u))
    return 60;

  let m = u.match(/\b(\d+)\s*-?\s*min(?:utes?)?\b/);
  if (m) {
    const n = parseInt(m[1]!, 10);
    if (Number.isFinite(n) && n >= 15 && n <= 480) return n;
  }
  m = u.match(/\b(\d+)\s*h(?:ours?)?\b/);
  if (m) {
    const h = parseInt(m[1]!, 10);
    if (Number.isFinite(h) && h >= 1 && h <= 8) return h * 60;
  }

  const oneOnOne =
    /\b1\s*[:\.]?\s*1\b|\bone\s*-?\s*on\s*-?\s*one\b|\b1\s*-?\s*on\s*-?\s*1\b|\bone\s*-?\s*to\s*-?\s*one\b|\bo\s*-?\s*o\s*-?\s*o\b|\booh\s*-?\s*ooh\b/;
  if (oneOnOne.test(utterance.replace(/\u2019/g, "'"))) {
    return 30;
  }

  return null;
}

/** After explicit AMPM ranges and vagueness rejection, infer a bounded local hour grid (risk-tagged downstream). */
export function inferImplicitSchedulingSearchWindowHours(utterance: string): {
  startHour: number;
  endHour: number;
  schedulingParseRisk:
    | 'explicit_clock_window'
    | 'daypart_window'
    | 'default_business_window';
} | null {
  const explicit = extractSchedulingSearchWindowHours(utterance);
  if (explicit) {
    return { ...explicit, schedulingParseRisk: 'explicit_clock_window' };
  }
  if (schedulingLinkNeedsLatestEndClarification(utterance)) {
    return null;
  }

  const n = utterance.toLowerCase();

  let hitMorning = /\bmorning\b/.test(n);
  let hitAfternoon = /\bafternoon\b/.test(n);
  let hitEvening = /\bevening\b/.test(n);
  const hitNight = /\bnight\b/.test(n) && !/\blast\s+night\b/.test(n);

  const daypartHits = [hitMorning, hitAfternoon, hitEvening, hitNight].filter(Boolean).length;
  if (daypartHits >= 2) {
    return null;
  }

  if (hitMorning) {
    return { startHour: 8, endHour: 12, schedulingParseRisk: 'daypart_window' };
  }
  if (hitAfternoon) {
    return { startHour: 12, endHour: 17, schedulingParseRisk: 'daypart_window' };
  }
  if (hitEvening) {
    return { startHour: 17, endHour: 21, schedulingParseRisk: 'daypart_window' };
  }
  if (hitNight) {
    return { startHour: 20, endHour: 23, schedulingParseRisk: 'daypart_window' };
  }

  // No silent 9–17 business-day grid: missing when → clarify (scheduling_when_needed).
  return null;
}

export function detectUnsupportedSchedulingConstraints(utterance: string): string[] {
  const n = utterance.toLowerCase();
  const constraints: string[] = [];
  if (/\bdo\s+not\s+book\s+over\b|\bdon'?t\s+book\s+over\b|\bavoid\b.*\bstandup/.test(n)) {
    constraints.push('avoid_existing_standups');
  }
  if (/\bafter\s+lunch\b/.test(n)) {
    constraints.push('after_lunch');
  }
  return constraints;
}

/** Must clarify latest end before issuing a scheduling link (partial daypart hints, no numeric window). */
export function schedulingLinkNeedsLatestEndClarification(utterance: string): boolean {
  if (extractSchedulingSearchWindowHours(utterance)) return false;
  return VAGUE_DAYPART_OR_DAYPART.test(utterance);
}

/**
 * Obvious "share a scheduling / pick-a-time link" phrasing with a concrete @… address.
 * Used by scheduling-link contract finalization and constraint detection (not pre-Haiku intent authority on /voice).
 */
export function tryMatchSchedulingLink(utterance: string): SchedulingLinkPrefilterParams | null {
  const email = extractEmailFromText(utterance);
  if (!email) return null;

  const n = stripLeadFiller(normalizeCalendarQueryText(utterance));
  if (!n) return null;

  if (looksLikeCalendarLookupWithEmail(n)) {
    return null;
  }

  if (hasSchedulingLinkSignal(utterance, n)) {
    return { inviteeEmail: email };
  }
  return null;
}

function looksLikeCalendarLookupWithEmail(n: string): boolean {
  if (
    /^\s*(what|when|where|which|who)\b.*\b(have|on my calendar|meetings?|events?|calls?|on my cal|my cal|do i|show|list|free|available|busy|conflict)\b/i.test(
      n
    )
  ) {
    return true;
  }
  if (/^\s*(do i have|am i (free|available|open))\b/i.test(n)) {
    return true;
  }
  if (/^\s*tell me\b.*\b(calendar|schedule|meetings?)\b/i.test(n)) {
    return true;
  }
  return false;
}

function hasSchedulingLinkSignal(raw: string, n: string): boolean {
  const t = n.toLowerCase();
  const r = raw.toLowerCase();
  if (/\bfind\s+time\s+(with|for)\b/.test(t)) return true;
  if (/\bfind\s+\d+\s+slots?\s+(?:for|with)\b/.test(t)) return true;
  if (/\bfind\s+(?:two|2)\s+slots?\s+(?:for|with)\b/.test(t)) return true;
  if (/\bfind\s+(?:an?\s+)?opening\s+(?:with|for)\b/.test(t)) return true;
  if (/\bwhen\s+can\s+i\s+meet\b/.test(t)) return true;
  if (
    /\b(?:line|lining)\s+up\b.*\b(with|for)\b/.test(t) || /\blining\s+(?:them\s+|me\s+|us\s+)?up\s+(?:with|for)\b/.test(t)
  )
    return true;
  if (/\b(coordinate|arrang(?:e|ing)|facilitat(?:e|ing))\b/.test(t) && /\b(with|for)\b/.test(t))
    return true;
  if (/\bpencil\s+(?:me\s+)?in\b/.test(t)) return true;
  if (/\bopen\s+a\s+(?:time\s+)?window\s+for\b/.test(t)) return true;
  if (/\bshare\s+(?:my\s+)?(?:calendar|availab(?:ility)?)\s+with\b/.test(t)) return true;
  if (/\bset\s+up\s+availab(?:ility)?\b/.test(t)) return true;
  if (/\bhelp\s+me\s+(?:to\s+)?(?:book|schedule)\b/.test(t)) return true;
  if (/\bget\s+\S+@\S+\s+on\s+my\s+calendar\b/i.test(raw)) return true;
  if (/\bpick\s+a\s+(?:time\s+)?slot\s+(?:with|for)\b/.test(t)) return true;
  if (/\bneed\s+to\s+meet\b/.test(t)) return true;
  if (/\bbook\s+a\s+slot\b/.test(t)) return true;
  if (/\bsend\s+\S+@\S+.*\btimes\b/i.test(raw)) return true;
  if (/\bfind\s+time\s+to\s+(meet|book|schedule)\b/.test(t)) return true;
  if (/\bfind\s+time\s+next\s+week\b/.test(t)) return true;
  if (/\bfind\s+a\s+meeting\s+with\b/.test(t)) return true;
  if (/\bset\s+up\s+(?:a\s+)?meeting\s+with\b/.test(t)) return true;
  if (/\bget\s+(?:me\s+)?(?:on\s+)?the\s+calendar\s+with\b/.test(t)) return true;
  if (/\bcan\s+you\s+book\s+time\s+with\b/.test(t)) return true;
  if (/\boffer\b.*\btwo\s+slots\b/i.test(raw) && /@\S+/.test(raw)) return true;
  if (/\bschedule\b.*\b(with|for)\b.*@\S+/i.test(raw)) return true;
  if (/\bschedule\s+time\s+with\b/.test(t)) return true;
  if (/\bschedule\b.*\d+\s*-?\s*min\b/i.test(raw)) return true;
  if (/\bbook\s+a\s+meeting\s+with\b/.test(t)) return true;
  if (/\bbook\s+a\s+time\s+with\b/.test(t) || /\bbook\s+time\s+with\b/.test(t)) return true;
  if (/\bremind:\s*book\s+time\s+with\b/.test(t)) return true;
  if (/\bbook\s+with\b/.test(t)) return true;
  if (/@\S+\s*[—-]\s*find\s+time\b/.test(r)) return true;
  if (/\bbook\s+\S+@\S+/i.test(r)) return true;
  if (/\bneed\s+to\s+book\s+time\s+with\b/.test(t)) return true;
  if (/\bneed\s+find\s+time\b/.test(t)) return true;
  if (/\bi need find time to meet\b/.test(t)) return true;
  if (/\bi need a meeting with\b/.test(t) && /\b(pick|share\s+link|scheduling)\b/.test(t)) return true;
  if (/\bschedule\s+with\s+\S+@\S+/i.test(r)) return true;
  if (/\bschedule\s+a\s+meeting\s+to\s+meet\b/.test(t)) return true;
  if (/\bschedule\s+a\s+link\s+and\s+find\s+time\b/.test(t)) return true;
  if (/\bcan we do find\s+time\s+with\b/.test(t)) return true;
  if (/\bsend\s+.*\b(link|scheduling)\b/.test(t)) return true;
  if (/\bsend\s+scheduling\s+options\b/.test(t)) return true;
  if (/\bsend\s+.*\bscheduling\s+page\b/.test(t)) return true;
  if (/\bcreate\s+.*\bscheduling\s+link\b/.test(t)) return true;
  if (/\bcreate\s+scheduling\s+thing\b/.test(t)) return true;
  if (/\bset\s+up\s+.*\b(link|calendly|calendly-?style|scheduling)\b/.test(t)) return true;
  if (/\bset\s+up\s+a\s+meeting\s+request\s+for\b/.test(t)) return true;
  if (/\bset\s+up\s+scheduling\s+with\b(?:.*\bfor\s+external\s+pick\b)?/.test(t)) return true;
  if (/\bopen\s+scheduling\s+for\b/.test(t)) return true;
  if (/\bin\s+the\s+find\s+time\s+flow\b/.test(t)) return true;
  if (/\bfor\s+a\s+booking\s+link\b/.test(t)) return true;
  if (/\bhook\s+me\s+up\b/.test(t) && /\bschedul/.test(t)) return true;
  if (/\bplz\s+find\s+time\s+for\b/.test(t)) return true;
  if (/\bgive\b.+\@\S+.+\b(slots?|time\s+slots)\b/i.test(r)) return true;
  if (/\b(today|tomorrow|next\s+week)\b/.test(t) && /\b(morning|afternoon|evening)\b/.test(t)) return true;
  return false;
}
