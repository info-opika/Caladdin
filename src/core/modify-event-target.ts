import { DateTime } from 'luxon';
import type { CalendarEvent, ParsedIntent } from './adts.js';
import { ParsedIntentSchema } from './adts.js';

export type ModifyTargetResolution =
  | { kind: 'ok'; target: CalendarEvent; paramPatch: Record<string, unknown> }
  | { kind: 'ambiguous'; candidates: CalendarEvent[]; userMessage: string }
  | { kind: 'none'; userMessage: string };

/** Deterministic MODIFY targeting hints extracted once at parse boundary (never inside resolve). */
export type ModifyResolveAnchorsExtract = {
  clockMinutesLocal: number | null;
  titleHint: string | null;
  relativeDay: 'today' | 'tomorrow' | null;
  weekdayLuxon: number | null;
  /** True when utterance names no explicit day token; match today-or-tomorrow window. */
  dayLooseTodayOrTomorrow: boolean;
  suggestsDelete: boolean;
  unsupportedMovePilot: boolean;
};

/** Local minutes since midnight [0, 24*60) — internal to extract only */
function clockMinutesFromUtterance(utterance: string): number | null {
  const u = utterance.toLowerCase();
  if (/\bnoon\b/.test(u)) return 12 * 60;
  if (/\b(midnight)\b/.test(u)) return 0;

  let m = utterance.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)\b/i);
  if (m) {
    let h = parseInt(m[1]!, 10);
    const min = parseInt(m[2]!, 10);
    const ap = m[3]!.toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    return h * 60 + min;
  }

  m = utterance.match(/\b(\d{1,2}):(\d{2})\b/i);
  if (m) {
    const h = parseInt(m[1]!, 10);
    const min = parseInt(m[2]!, 10);
    if (h > 12) return h * 60 + min;
    return null;
  }

  m = utterance.match(/\b(\d{1,2})\s*(am|pm)\b/i);
  if (m) {
    let h = parseInt(m[1]!, 10);
    const ap = m[2]!.toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    return h * 60;
  }

  m = utterance.match(/\b(\d{1,2})\s*pm\b/i);
  if (m) {
    let h = parseInt(m[1]!, 10);
    if (h < 12) h += 12;
    return h * 60;
  }

  m = utterance.match(/\b(\d{1,2})\s*am\b/i);
  if (m) {
    let h = parseInt(m[1]!, 10);
    if (h === 12) h = 0;
    return h * 60;
  }

  return null;
}

function titleHintFromUtterance(utterance: string): string | null {
  const junk = /\b(pm|am|minutes?|today|tomorrow)\b/i;
  const patterns: RegExp[] = [
    /\bmy\s+([a-z][a-z0-9]{2,})\s+(?:meeting|call|appointment)\b/i,
    /\b(?:cancel|delete|remove|rename)\s+(?:my\s+)?([a-z][a-z0-9]{2,})\s+(?:meeting|call)\b/i,
    /\b(?:extend|change|make|shorten)\s+(?:my\s+)?([a-z][a-z0-9]{2,})\s+/i,
    /\b(?:the\s+)?([a-z][a-z0-9]{2,})\s+(?:meeting|call)\b/i,
  ];
  for (const p of patterns) {
    const m = utterance.match(p);
    if (m?.[1]) {
      const w = m[1].trim();
      if (w.length >= 2 && !/^\d/.test(w) && !junk.test(w)) return w;
    }
  }
  const myWord = utterance.match(/\b(?:my|the)\s+([a-z][a-z0-9]{2,})\b/i);
  if (myWord?.[1]) {
    const w = myWord[1]!.toLowerCase();
    const stop = new Set([
      'calendar',
      'meeting',
      'appointment',
      'minutes',
      'minute',
      'event',
    ]);
    if (!stop.has(w) && !/^\d/.test(w)) return myWord[1]!;
  }
  return null;
}

/**
 * Single deterministic pass: English → MODIFY anchor params. Call only from parser / hydrate, not from resolve.
 */
export function extractModifyResolveAnchorsFromUtterance(utterance: string): ModifyResolveAnchorsExtract {
  const u = utterance.toLowerCase();
  let relativeDay: 'today' | 'tomorrow' | null = null;
  let weekdayLuxon: number | null = null;

  if (/\btomorrow\b/.test(u)) relativeDay = 'tomorrow';
  else if (/\btoday\b/.test(u)) relativeDay = 'today';
  else {
    const days: Record<string, number> = {
      sunday: 7,
      monday: 1,
      tuesday: 2,
      wednesday: 3,
      thursday: 4,
      friday: 5,
      saturday: 6,
    };
    for (const [name, luxDow] of Object.entries(days)) {
      if (new RegExp(`\\b${name}\\b`, 'i').test(u)) {
        weekdayLuxon = luxDow;
        break;
      }
    }
  }

  const dayLooseTodayOrTomorrow = relativeDay === null && weekdayLuxon === null;

  const suggestsDelete = /\b(delete|cancel|remove)\b/i.test(utterance);
  const unsupportedMovePilot = /\b(move|reschedule|postpone|shift)\b/i.test(utterance);

  return {
    clockMinutesLocal: clockMinutesFromUtterance(utterance),
    titleHint: titleHintFromUtterance(utterance),
    relativeDay,
    weekdayLuxon,
    dayLooseTodayOrTomorrow,
    suggestsDelete,
    unsupportedMovePilot,
  };
}

export function modifyResolveAnchorsToParams(a: ModifyResolveAnchorsExtract): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (a.clockMinutesLocal !== null) o.modifyResolveClockMinutesLocal = a.clockMinutesLocal;
  if (a.titleHint !== null) o.modifyResolveTitleHint = a.titleHint;
  if (a.relativeDay === 'today') o.modifyResolveRelativeDay = 'today';
  if (a.relativeDay === 'tomorrow') o.modifyResolveRelativeDay = 'tomorrow';
  if (a.weekdayLuxon !== null) o.modifyResolveWeekdayLuxon = a.weekdayLuxon;
  if (a.dayLooseTodayOrTomorrow) o.modifyResolveDayLoose = true;
  if (a.unsupportedMovePilot) o.modifyPilotUnsupportedMove = true;
  return o;
}

/**
 * MATERIALIZE MODIFY execution contract once: fill missing anchor keys from English, never overwriting keys
 * the structured parser/classifier already supplied. After this (or equivalent prefilter fill), execution
 * reads `params` only — `rawUtterance` is never reinterpreted inside `resolveModifyEventTarget`.
 */
export function hydrateModifyIntentContract(intent: ParsedIntent): ParsedIntent {
  if (intent.intent !== 'MODIFY_EVENT') return intent;
  const p = { ...(intent.params as Record<string, unknown>) };
  const extracted = extractModifyResolveAnchorsFromUtterance(intent.rawUtterance);
  const patch = modifyResolveAnchorsToParams(extracted);
  for (const [k, v] of Object.entries(patch)) {
    if (p[k] === undefined) p[k] = v;
  }

  const op = typeof p.operation === 'string' ? p.operation.trim().toLowerCase() : '';
  if (
    !op &&
    extracted.suggestsDelete &&
    typeof p.newDurationMinutes !== 'number' &&
    !p.renameFrom
  ) {
    p.operation = 'delete';
  }

  return ParsedIntentSchema.parse({ ...intent, params: p });
}

function eventStartLocal(event: CalendarEvent, zone: string): DateTime | null {
  if (!event.start || !event.start.includes('T')) return null;
  const dt = DateTime.fromISO(event.start, { setZone: true });
  if (!dt.isValid) return null;
  return dt.setZone(zone);
}

/** YYYY-MM-DD all-day or date-only start */
function eventIsAllDayLike(event: CalendarEvent): boolean {
  return Boolean(event.start && !event.start.includes('T'));
}

function dayMatchesStructured(params: Record<string, unknown>, eventStart: DateTime, nowZoned: DateTime): boolean {
  const rd = params.modifyResolveRelativeDay;
  if (rd === 'tomorrow') return eventStart.hasSame(nowZoned.plus({ days: 1 }), 'day');
  if (rd === 'today') return eventStart.hasSame(nowZoned, 'day');
  const wd = params.modifyResolveWeekdayLuxon;
  if (typeof wd === 'number' && wd >= 1 && wd <= 7) return eventStart.weekday === wd;
  if (params.modifyResolveDayLoose === true) {
    return eventStart.hasSame(nowZoned, 'day') || eventStart.hasSame(nowZoned.plus({ days: 1 }), 'day');
  }
  return eventStart.hasSame(nowZoned, 'day') || eventStart.hasSame(nowZoned.plus({ days: 1 }), 'day');
}

function eventMatchesClockStructured(
  event: CalendarEvent,
  zone: string,
  clockM: number,
  params: Record<string, unknown>,
  nowZoned: DateTime
): boolean {
  if (eventIsAllDayLike(event)) return false;
  const local = eventStartLocal(event, zone);
  if (!local) return false;
  if (!dayMatchesStructured(params, local, nowZoned)) return false;
  const evM = local.hour * 60 + local.minute;
  return Math.abs(evM - clockM) <= 30;
}

function titleMatchesRenameFrom(title: string, renameFrom: string): boolean {
  const a = title.toLowerCase();
  const b = renameFrom.toLowerCase().trim();
  return a.includes(b) || b.split(/\s+/).every((tok) => tok.length > 1 && a.includes(tok));
}

function filterByRenameFrom(events: CalendarEvent[], renameFrom: string): CalendarEvent[] {
  return events.filter((e) => titleMatchesRenameFrom(e.title, renameFrom));
}

function filterByClockStructured(
  events: CalendarEvent[],
  params: Record<string, unknown>,
  zone: string,
  nowZoned: DateTime,
  clockM: number
): CalendarEvent[] {
  return events.filter((e) => eventMatchesClockStructured(e, zone, clockM, params, nowZoned));
}

function filterByTitleHint(events: CalendarEvent[], hint: string): CalendarEvent[] {
  const h = hint.toLowerCase();
  return events.filter((e) => e.title.toLowerCase().includes(h));
}

function readClockMinutes(params: Record<string, unknown>): number | null {
  const v = params.modifyResolveClockMinutesLocal;
  return typeof v === 'number' ? v : null;
}

function readTitleHint(params: Record<string, unknown>): string | null {
  const v = params.modifyResolveTitleHint;
  return typeof v === 'string' && v.trim() ? v : null;
}

/**
 * Resolve at most one calendar event for MODIFY_EVENT using **structured params only** (post-hydrate).
 * Never re-derives clock, title hints, delete heuristics, or day tokens from `rawUtterance`.
 */
export function resolveModifyEventTarget(
  intent: ParsedIntent,
  events: CalendarEvent[],
  timezone: string
): ModifyTargetResolution {
  const params = intent.params as Record<string, unknown>;
  const nowZoned = DateTime.now().setZone(timezone);
  const paramPatch: Record<string, unknown> = {};

  const idHint =
    (typeof params.targetEventId === 'string' && params.targetEventId.trim()) ||
    (typeof params.googleEventId === 'string' && params.googleEventId.trim()) ||
    '';
  if (idHint) {
    const byId = events.find((e) => e.id === idHint);
    if (byId) {
      const patch: Record<string, unknown> = {};
      if (typeof params.operation === 'string') patch.operation = params.operation;
      if (typeof params.newTitle === 'string') patch.newTitle = params.newTitle;
      if (typeof params.newDurationMinutes === 'number') patch.newDurationMinutes = params.newDurationMinutes;
      if (typeof params.newStart === 'string') patch.newStart = params.newStart;
      if (typeof params.newEnd === 'string') patch.newEnd = params.newEnd;

      const opLc = typeof params.operation === 'string' ? params.operation.toLowerCase() : '';
      if (opLc === 'delete') {
        return { kind: 'ok', target: byId, paramPatch: { operation: 'delete' } };
      }

      const hasStructuralPatch =
        Boolean(patch.newTitle) ||
        typeof patch.newDurationMinutes === 'number' ||
        typeof patch.newStart === 'string' ||
        typeof patch.newEnd === 'string';
      if (hasStructuralPatch) {
        return { kind: 'ok', target: byId, paramPatch: patch };
      }

      return { kind: 'ok', target: byId, paramPatch: patch };
    }
  }

  const opRaw =
    typeof params.operation === 'string' ? params.operation.trim().toLowerCase() : '';
  const structuredDelete = opRaw === 'delete';

  const renameFrom = typeof params.renameFrom === 'string' ? params.renameFrom : undefined;
  const newTitle = typeof params.newTitle === 'string' ? params.newTitle : undefined;
  if (renameFrom) {
    const found = filterByRenameFrom(events, renameFrom);
    if (found.length === 1) {
      if (newTitle) paramPatch.newTitle = newTitle;
      return { kind: 'ok', target: found[0]!, paramPatch };
    }
    if (found.length > 1) {
      return {
        kind: 'ambiguous',
        candidates: found,
        userMessage: `I found more than one event matching “${renameFrom}”. Which one should I rename?`,
      };
    }
    return {
      kind: 'none',
      userMessage: `I couldn’t find an event matching “${renameFrom}” on your calendar in the next week.`,
    };
  }

  const clockM = readClockMinutes(params);
  const hint = readTitleHint(params);

  let candidates = [...events];

  if (clockM !== null) {
    candidates = filterByClockStructured(candidates, params, timezone, nowZoned, clockM);
  }

  if (hint && candidates.length > 1) {
    const narrowed = filterByTitleHint(candidates, hint);
    if (narrowed.length >= 1) candidates = narrowed;
  }

  if (structuredDelete) {
    if (candidates.length === 1) return { kind: 'ok', target: candidates[0]!, paramPatch };
    if (candidates.length > 1) {
      return {
        kind: 'ambiguous',
        candidates,
        userMessage: 'More than one event matches that time. Try adding the event title or “today” / “tomorrow.”',
      };
    }
    return {
      kind: 'none',
      userMessage:
        'I couldn’t find that event on your calendar in the next week. Try a specific time and day (for example “cancel my 3pm meeting tomorrow”).',
    };
  }

  if (typeof params.newDurationMinutes === 'number') {
    if (candidates.length === 1) {
      paramPatch.newDurationMinutes = params.newDurationMinutes;
      return { kind: 'ok', target: candidates[0]!, paramPatch };
    }
    if (candidates.length > 1) {
      return {
        kind: 'ambiguous',
        candidates,
        userMessage: 'More than one event could match. Say which event (time and title) to change the length of.',
      };
    }
    return {
      kind: 'none',
      userMessage:
        'I couldn’t tell which event to resize. Say something like “make my 3pm meeting 30 minutes” or “change my standup to 15 minutes.”',
    };
  }

  if (newTitle && !renameFrom) {
    return { kind: 'none', userMessage: 'I need more detail to find the event to update.' };
  }

  /** LC4.4 R1: Executable structured reschedule beats raw move/reschedule pilot veto. */
  const hasReschedulePatch =
    (typeof params.newStart === 'string' && params.newStart.trim() !== '') ||
    (typeof params.newEnd === 'string' && params.newEnd.trim() !== '');
  if (hasReschedulePatch) {
    if (candidates.length === 1) {
      const patch: Record<string, unknown> = {};
      if (typeof params.newStart === 'string' && params.newStart.trim()) patch.newStart = params.newStart.trim();
      if (typeof params.newEnd === 'string' && params.newEnd.trim()) patch.newEnd = params.newEnd.trim();
      if (typeof params.operation === 'string' && params.operation.trim()) patch.operation = params.operation.trim();
      return { kind: 'ok', target: candidates[0]!, paramPatch: patch };
    }
    if (candidates.length > 1) {
      return {
        kind: 'ambiguous',
        candidates,
        userMessage:
          'More than one event could match. Say which event to reschedule with a clearer time or title.',
      };
    }
    return {
      kind: 'none',
      userMessage:
        'I couldn’t find that event on your calendar for that reschedule. Try a specific time and title.',
    };
  }

  if (opRaw === '' && params.modifyPilotUnsupportedMove === true) {
    return {
      kind: 'none',
      userMessage:
        'Say a new time to reschedule (for example “move my 3pm to 4pm tomorrow”) — that flow is not supported yet in the pilot build.',
    };
  }

  return {
    kind: 'none',
    userMessage:
      'I wasn’t sure which event you meant. Name the event or give a time (for example “rename lunch to investor call”).',
  };
}
