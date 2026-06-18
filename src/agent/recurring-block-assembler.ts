import { DateTime } from 'luxon';
import { parseSpokenClock } from '../core/protect-block-prefilter.js';
import { DEFAULT_INFERRED_RANGE_WEEKS } from '../core/protect-block-prefilter.js';
import {
  extractInferredRangeWeeks,
  inferBlockLabelFromTurns,
  isCalendarQueryTurn,
  isDurationOrRangeTurn,
} from './agent-label-inference.js';

export type AssembledRecurringBlock = {
  label: string;
  startTime: string;
  endTime: string;
  daysOfWeek: number[];
  rangeEnd: string;
};

function padTime(hh: number, mm: number): string {
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function extractTimeRange(text: string): { start: string; end: string } | null {
  const m = text.match(
    /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b[\s\S]*?\bto\b[\s\S]*?\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i,
  );
  if (!m) return null;
  const startClock = parseSpokenClock(
    's',
    `${m[1]}${m[2] ? `:${m[2]}` : ''} ${m[3]}`.trim(),
  );
  const endClock = parseSpokenClock(
    'e',
    `${m[4]}${m[5] ? `:${m[5]}` : ''} ${m[6]}`.trim(),
  );
  if (!startClock || !endClock) return null;
  const start = padTime(startClock.hh, startClock.mm);
  const end = padTime(endClock.hh, endClock.mm);
  if (start >= end) return null;
  return { start, end };
}

function inferDaysOfWeek(text: string): number[] {
  const lower = text.toLowerCase();
  if (/\bevery\s*day\b|\beveryday\b|\bdaily\b|\beach\s+day\b/.test(lower)) {
    return [0, 1, 2, 3, 4, 5, 6];
  }
  if (/\bweekdays?\b|\bmon(?:day)?\s*(?:to|through|-)\s*fri(?:day)?\b/.test(lower)) {
    return [1, 2, 3, 4, 5];
  }
  return [1, 2, 3, 4, 5];
}

/**
 * Deterministic merge of multi-turn user messages into a recurring block when the
 * conversation clearly specifies daily times + label (common voice follow-up pattern).
 */
export function tryAssembleRecurringBlockFromTurns(
  userTurns: string[],
  timezone: string,
): AssembledRecurringBlock | null {
  const combined = userTurns.join(' ').trim();
  if (!combined) return null;

  const latestTurn = userTurns[userTurns.length - 1]?.trim() ?? '';
  if (isCalendarQueryTurn(latestTurn)) return null;
  if (userTurns.length > 1 && isDurationOrRangeTurn(latestTurn) && !extractTimeRange(latestTurn)) {
    return null;
  }

  const wantsRecurring =
    /\b(block|protect|shield|hold|reserve)\b/i.test(combined) ||
    /\b(every\s*day|everyday|daily|recurring|weekdays?)\b/i.test(combined);
  if (!wantsRecurring) return null;

  const range = extractTimeRange(combined);
  if (!range) return null;

  const label = inferBlockLabelFromTurns(userTurns);
  if (!label) return null;

  const zone = timezone.trim() || 'America/Chicago';
  const rangeWeeks = extractInferredRangeWeeks(combined) ?? DEFAULT_INFERRED_RANGE_WEEKS;
  const rangeEnd =
    DateTime.now().setZone(zone).plus({ weeks: rangeWeeks }).toISODate() ?? '';

  return {
    label,
    startTime: range.start,
    endTime: range.end,
    daysOfWeek: inferDaysOfWeek(combined),
    rangeEnd,
  };
}
