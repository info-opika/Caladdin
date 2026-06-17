import { DateTime } from 'luxon';
import type { ParsedIntent } from './adts.js';
import { ParsedIntentSchema, ProtectBlockParamsSchema } from './adts.js';

const DAY_NAME: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

/** When the phrase does not name an end date, cap recurrence (bounded, not forever). */
export const DEFAULT_INFERRED_RANGE_WEEKS = 4;

function padTime(hh: number, mm: number): string {
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** Parse trailing am/pm time: "7 am", "730 pm", "7:30 pm". */
export function parseSpokenClock(_label: string, ctx: string): { hh: number; mm: number } | null {
  const t = ctx.trim().toLowerCase().replace(/\s+/g, ' ');
  // H:MM am/pm
  const hm = t.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/);
  if (hm) {
    let h = parseInt(hm[1]!, 10);
    const m = parseInt(hm[2]!, 10);
    const ap = hm[3]!;
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    return { hh: h, mm: m };
  }
  // Compact Hmm pm e.g. 730 pm → 19:30
  const hmm = t.match(/^(\d{3,4})\s*(am|pm)$/);
  if (hmm) {
    const digits = hmm[1]!;
    const ap = hmm[2]!;
    let h = 0;
    let m = 0;
    if (digits.length === 3) {
      h = parseInt(digits[0]!, 10);
      m = parseInt(digits.slice(1), 10);
    } else if (digits.length === 4) {
      h = parseInt(digits.slice(0, 2), 10);
      m = parseInt(digits.slice(2), 10);
      if (h > 12) {
        h = parseInt(digits[0]!, 10);
        m = parseInt(digits.slice(1), 10);
      }
    }
    if (m >= 60) return null;
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    return { hh: h, mm: m };
  }
  const hourAmpm = t.match(/^(\d{1,2})\s*(am|pm)$/);
  if (hourAmpm) {
    let h = parseInt(hourAmpm[1]!, 10);
    const ap = hourAmpm[2]!;
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    return { hh: h, mm: 0 };
  }
  const jamPacked = t.match(/^(\d{1,2})(am|pm)$/);
  if (jamPacked) {
    let h = parseInt(jamPacked[1]!, 10);
    const ap = jamPacked[2]!;
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    return { hh: h, mm: 0 };
  }
  return null;
}

function spanFocusRangeEnd(zone: string): string {
  return DateTime.now().setZone(zone).plus({ weeks: 1 }).toISODate()!;
}

function defaultRangeEndYmd(zone: string): string {
  return DateTime.now().setZone(zone).plus({ weeks: DEFAULT_INFERRED_RANGE_WEEKS }).toISODate()!;
}

function dateForWeekdayRequest(zone: string, dayName: string, explicitNextWeek: boolean): DateTime | null {
  const dow = DAY_NAME[dayName.toLowerCase()];
  if (dow === undefined) return null;
  let d = DateTime.now().setZone(zone).startOf('day');
  const targetLuxon = dow === 0 ? 7 : dow;
  let delta = (targetLuxon - d.weekday + 7) % 7;
  if (delta === 0) delta = 7;
  if (explicitNextWeek) delta += 7;
  return d.plus({ days: delta });
}

const VAGUE_SLOT_WORD =
  /\b(mornings?|afternoons?|evenings?|lunch(?:\s+time)?|dinners?|deep\s+work|family\b)\b/i;

/** Explicit clocks or numeric hour spans (no cultural default applied). */
const EXPLICIT_TIME_OR_NUMERIC_RANGE = new RegExp(
  [
    String.raw`\b\d{1,2}\s*(?::\d{2})?\s*(am|pm)\b`,
    String.raw`\b\d{3,4}\s*(am|pm)\b`,
    String.raw`\b\d{1,2}:\d{2}\b`,
    String.raw`\b\d{1,2}\s*(?:to|[-–])\s*\d{1,2}\b`,
  ].join('|'),
  'i'
);

/**
 * Recurring block with explicit start/end from spoken times, title in quotes, "all weekdays", and
 * "for next N weeks" — before LLM.
 */
export function tryMatchProtectBlockStrict(utterance: string, profileTimezone: string): ParsedIntent | null {
  const raw = utterance.trim();
  const lower = raw.toLowerCase();

  const titleMq = raw.match(/name\s+(?:the\s+)?event\s+['"]([^'"]+)['"]/i);
  const titleAlt = raw.match(/['"]([^'"]+)['"]\s*$/);
  const title = (titleMq?.[1] ?? titleAlt?.[1])?.trim();
  if (!title) return null;

  if (!/\bblock\b/i.test(lower) || !/\ball\s+weekdays?\b/i.test(lower)) return null;

  const timeMatch = raw.match(/\bblock\s+(.+?)\s+to\s+(.+?)\s+all\s+weekdays\b/i);
  if (!timeMatch) return null;

  const a = parseSpokenClock('start', timeMatch[1]!.trim());
  const b = parseSpokenClock('end', timeMatch[2]!.trim());
  if (!a || !b) return null;

  let rangeWeeks = 0;
  if (/\bnext\s+(?:four|4)\s+weeks\b/i.test(raw)) rangeWeeks = 4;
  else if (/\bnext\s+(\d+)\s+weeks\b/i.exec(raw)?.[1])
    rangeWeeks = parseInt(/\bnext\s+(\d+)\s+weeks\b/i.exec(raw)![1]!, 10);
  else return null;

  const zone = profileTimezone?.trim() || 'UTC';
  const rangeEnd = DateTime.now().setZone(zone).plus({ weeks: rangeWeeks }).toISODate()!;

  const startTime = padTime(a.hh, a.mm);
  const endTime = padTime(b.hh, b.mm);

  return ParsedIntentSchema.parse({
    intent: 'PROTECT_BLOCK',
    confidence: 1,
    rawUtterance: raw,
    params: {
      label: title,
      startTime,
      endTime,
      daysOfWeek: [1, 2, 3, 4, 5],
      rangeEnd,
      timezone: zone,
      tier: 1,
      rawUtterance: raw,
      source: 'protect_block_strict_prefilter',
    },
    mappingMethod: 'direct',
  });
}

/**
 * `block weekdays START to END for (next) N weeks [named …]` — explicit times only; requires event
 * title via named/called/titled (no fabricated title).
 */
export function tryMatchProtectBlockWeekdaysForWeeks(utterance: string, profileTimezone: string): ParsedIntent | null {
  const raw = utterance.trim();
  const m = raw.match(
    /\bblock\s+weekdays?\s+(.+?)\s+to\s+(.+?)\s+for\s+(?:next\s+)?(?:four|4|\d+)\s+weeks\s*(?:(?:named|called|titled)\s+(.+))?$/i
  );
  /** e.g. `block 7am to 7:30pm weekdays for 4 weeks called "Title"` — times before `weekdays`. */
  const mReorder = !m
    ? raw.match(
        /\bblock\s+(.+?)\s+to\s+(.+?)\s+weekdays\s+for\s+(?:next\s+)?(?:four|4|\d+)\s+weeks\s+(?:called|named|titled)\s+"([^"]+)"\s*$/i
      )
    : null;

  if (!m && !mReorder) return null;

  const clockA = m ? m[1]!.trim() : mReorder![1]!.trim();
  const clockB = m ? m[2]!.trim() : mReorder![2]!.trim();

  const a = parseSpokenClock('a', clockA);
  const b = parseSpokenClock('b', clockB);
  if (!a || !b) return null;

  const wcMatch = raw.match(/\bfor\s+(?:next\s+)?(four|4|\d+)\s+weeks\b/i);
  const wcs = wcMatch?.[1]?.toLowerCase() ?? '4';
  const rangeWeeks = wcs === 'four' ? 4 : parseInt(wcs, 10);
  if (!Number.isFinite(rangeWeeks) || rangeWeeks < 1) return null;

  const zone = profileTimezone?.trim() || 'UTC';
  const rangeEnd = DateTime.now().setZone(zone).plus({ weeks: rangeWeeks }).toISODate()!;
  const titleRaw = (m?.[3] ?? mReorder?.[3])?.trim();
  if (!titleRaw) {
    return ParsedIntentSchema.parse({
      intent: 'RESOLVE_MANUAL',
      confidence: 0.55,
      rawUtterance: raw,
      params: { reason: 'protect_block_needs_title' },
      mappingMethod: 'resolve_manual',
    });
  }

  const title =
    /^["'].*["']$/.test(titleRaw) ? titleRaw.replace(/^["']|["']$/g, '').trim() : titleRaw;

  return ParsedIntentSchema.parse({
    intent: 'PROTECT_BLOCK',
    confidence: 1,
    rawUtterance: raw,
    params: {
      label: title.slice(0, 200),
      startTime: padTime(a.hh, a.mm),
      endTime: padTime(b.hh, b.mm),
      daysOfWeek: [1, 2, 3, 4, 5],
      rangeEnd,
      timezone: zone,
      tier: 1,
      rawUtterance: raw,
      source: 'protect_block_weekdays_for_weeks',
    },
    mappingMethod: 'direct',
  });
}

/** `block lunch H to H every weekday` — hours from utterance; 1–2 treated as 13:00–14:00. */
export function tryMatchProtectBlockLunchNumeric(utterance: string, profileTimezone: string): ParsedIntent | null {
  const raw = utterance.trim();
  const m = raw.match(
    /\bblock\s+lunch\s+(\d{1,2})\s*(?:to|[-–])\s*(\d{1,2})\s+every\s+weekday\b/i
  );
  if (!m) return null;
  let h1 = parseInt(m[1]!, 10);
  let h2 = parseInt(m[2]!, 10);
  let startTime: string;
  let endTime: string;
  if (h1 === 1 && h2 === 2) {
    startTime = '13:00';
    endTime = '14:00';
  } else {
    startTime = padTime(h1, 0);
    endTime = padTime(h2, 0);
  }
  const zone = profileTimezone?.trim() || 'UTC';
  return ParsedIntentSchema.parse({
    intent: 'PROTECT_BLOCK',
    confidence: 1,
    rawUtterance: raw,
    params: {
      label: 'Lunch',
      startTime,
      endTime,
      daysOfWeek: [1, 2, 3, 4, 5],
      rangeEnd: defaultRangeEndYmd(zone),
      timezone: zone,
      tier: 1,
      rawUtterance: raw,
      source: 'protect_block_lunch_numeric',
    },
    mappingMethod: 'direct',
  });
}

/**
 * Block/protect request with vague time-of-day words and no explicit clock or hour span — clarify
 * before any calendar mutation.
 */
export function tryMatchVagueProtectTiming(utterance: string): ParsedIntent | null {
  const t = utterance.trim();
  /** "Add a block …" / "set up … block …" — likely create-event phrasing, not protect-time. */
  if (/\b(create|add|set\s+up|book|schedule)\b/i.test(t) && /\bblock\b/i.test(t)) return null;
  if (/\ball\s+day\b/i.test(t)) return null;
  if (!/\b(block|protect|shield|reserve)\b/i.test(t)) return null;
  if (!VAGUE_SLOT_WORD.test(t)) return null;
  if (EXPLICIT_TIME_OR_NUMERIC_RANGE.test(t)) return null;
  return ParsedIntentSchema.parse({
    intent: 'RESOLVE_MANUAL',
    confidence: 0.5,
    rawUtterance: t,
    params: { reason: 'vague_protect_timing' },
    mappingMethod: 'resolve_manual',
  });
}

/**
 * Only fills params from patterns with explicit numeric/agreed times in the utterance (merge before
 * schema check). Never invents schedule from words like “morning” or “lunch”.
 */
export function inferProtectBlockParams(utterance: string, profileTimezone: string): Record<string, unknown> | null {
  const raw = utterance.trim();
  const zone = profileTimezone?.trim() || 'UTC';

  const DAY_WORD = `(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)`;

  /** "Block Tuesday morning from 9 AM Texas Time to 9:30 AM" */
  const blockWeekdayFromTo = raw.match(
    new RegExp(
      `\\bblock\\s+(?:(?:on\\s+)?(?:next\\s+)?(${DAY_WORD}))\\b[\\s\\S]*?\\bfrom\\s+(\\d{1,2}(?::\\d{2})?\\s*(?:am|pm))(?:\\s+(?:(?:\\w+)\\s+)*time)?\\s+to\\s+(\\d{1,2}(?::\\d{2})?\\s*(?:am|pm))`,
      'i',
    ),
  );
  if (blockWeekdayFromTo) {
    const dayName = blockWeekdayFromTo[1]!.toLowerCase();
    const dow = DAY_NAME[dayName];
    if (dow !== undefined) {
      const a = parseSpokenClock('start', blockWeekdayFromTo[2]!.trim());
      const b = parseSpokenClock('end', blockWeekdayFromTo[3]!.trim());
      if (a && b && a.hh * 60 + a.mm < b.hh * 60 + b.mm) {
        const explicitNextWeek = /\bnext\s+week\b/i.test(raw);
        const targetDate = dateForWeekdayRequest(zone, dayName, explicitNextWeek);
        const labelMatch = raw.match(/\b(?:called|named)\s+([^,.]+)/i);
        const label = (labelMatch?.[1]?.trim() || 'Personal time').slice(0, 140);
        return {
          label,
          startTime: padTime(a.hh, a.mm),
          endTime: padTime(b.hh, b.mm),
          daysOfWeek: [dow],
          startDate: targetDate?.toISODate() ?? DateTime.now().setZone(zone).toISODate()!,
          rangeEnd: defaultRangeEndYmd(zone),
          timezone: zone,
          tier: 1,
          rawUtterance: raw,
          source: 'infer_block_weekday_from_to',
        };
      }
    }
  }

  const lastBlockDay = [...raw.matchAll(new RegExp(`\\bblock\\s+(\\d{1,2})\\s*[-–]\\s*(\\d{1,2})\\s+(?:(next\\s+week)\\s+)?(${DAY_WORD})\\b`, 'gi'))].pop();
  if (lastBlockDay) {
    let h1 = parseInt(lastBlockDay[1]!, 10);
    let h2 = parseInt(lastBlockDay[2]!, 10);
    if (h2 > h1 && h1 <= 12 && h2 <= 12) {
      const dayName = String(lastBlockDay[4]).toLowerCase();
      const targetDate = dateForWeekdayRequest(zone, dayName, Boolean(lastBlockDay[3]));
      const dow = DAY_NAME[dayName];
      if (dow === undefined || !targetDate) return null;
      const before = raw.slice(0, lastBlockDay.index ?? 0).trim();
      const after = raw.slice((lastBlockDay.index ?? 0) + lastBlockDay[0].length).trim();
      const titleFromBefore = before
        .replace(/\b(?:reserve|protect|shield|hold)\b/gi, '')
        .replace(/\b(?:morning|mornings|afternoon|afternoons|evening|evenings)\b/gi, '')
        .replace(/^[\s,.-]+|[\s,.-]+$/g, '')
        .trim();
      let label = titleFromBefore || after.replace(/^[,.]\s*/, '').replace(/^for\s+/i, '').split(/\s+next\b/i)[0]!.trim();
      label = (label || 'Focus time').slice(0, 140);
      return {
        label,
        startTime: padTime(h1, 0),
        endTime: padTime(h2, 0),
        daysOfWeek: [dow],
        startDate: targetDate.toISODate()!,
        rangeEnd: targetDate.toISODate()!,
        timezone: zone,
        tier: 1,
        rawUtterance: raw,
        source: 'infer_block_named_weekday',
      };
    }
  }

  /** "add a block called deep work tmrw 1-3pm" */
  const namedTomorrow = raw.match(
    /\badd\s+a\s+block\s+called\s+(.+?)\s+(?:tmrw|tomorrow)\s+(\d{1,2})\s*[-–]\s*(\d{1,2})\s*(am|pm)\b/i
  );
  if (namedTomorrow) {
    const title = namedTomorrow[1]!.trim().replace(/\s+/g, ' ').slice(0, 140);
    const a = parseSpokenClock('a', `${namedTomorrow[2]!.trim()} ${namedTomorrow[4]}`);
    const b = parseSpokenClock('b', `${namedTomorrow[3]!.trim()} ${namedTomorrow[4]}`);
    if (a && b && title && a.hh * 60 + a.mm < b.hh * 60 + b.mm) {
      const t0 = DateTime.now().setZone(zone).plus({ days: 1 }).startOf('day');
      const luxW = t0.weekday;
      const dow = luxW === 7 ? 0 : luxW;
      return {
        label: title,
        startTime: padTime(a.hh, a.mm),
        endTime: padTime(b.hh, b.mm),
        daysOfWeek: [dow],
        startDate: t0.toISODate()!,
        rangeEnd: t0.toISODate()!,
        timezone: zone,
        tier: 1,
        rawUtterance: raw,
        source: 'infer_add_block_named_tomorrow',
      };
    }
  }

  /** "I need a no-meeting block 1-3pm tmrw" — shared am/pm on the numeric span */
  const noMeetingBlockTomorrow = raw.match(
    /\b(?:need\s+(?:an?\s+)?)?(?:no[-\s]?meeting\s+)?block\s+(\d{1,2})\s*[-–]\s*(\d{1,2})\s*(am|pm)\s*(?:tmrw|tomorrow)\b/i
  );
  if (noMeetingBlockTomorrow) {
    const ap = noMeetingBlockTomorrow[3]!.toLowerCase();
    const a = parseSpokenClock('a', `${noMeetingBlockTomorrow[1]!.trim()} ${ap}`);
    const b = parseSpokenClock('b', `${noMeetingBlockTomorrow[2]!.trim()} ${ap}`);
    if (a && b && a.hh * 60 + a.mm < b.hh * 60 + b.mm) {
      const t0 = DateTime.now().setZone(zone).plus({ days: 1 }).startOf('day');
      const luxW = t0.weekday;
      const dow = luxW === 7 ? 0 : luxW;
      return {
        label: 'No meetings',
        startTime: padTime(a.hh, a.mm),
        endTime: padTime(b.hh, b.mm),
        daysOfWeek: [dow],
        startDate: t0.toISODate()!,
        rangeEnd: t0.toISODate()!,
        timezone: zone,
        tier: 1,
        rawUtterance: raw,
        source: 'infer_no_meeting_block_tomorrow',
      };
    }
  }

  /** "block 9-10 for focus time …" — hour numbers only from user text */
  let blockSpan = raw.match(/\bblock\s+(\d{1,2})\s*[-–]\s*(\d{1,2})\s+(?:for|hrs?|hours?)\b(.*)/i);
  if (blockSpan) {
    let h1 = parseInt(blockSpan[1]!, 10);
    let h2 = parseInt(blockSpan[2]!, 10);
    if (!(h2 > h1)) {
      // fall through
    } else {
      /** 13–17 style same-day blocks, or legacy 9–12 “small hour” spans. */
      const twentyFourHrStyle = h1 >= 9 && h2 <= 23 && (h2 > 12 || h1 >= 13);
      const smallHourStyle = h1 <= 12 && h2 <= 12;
      if (!(twentyFourHrStyle || smallHourStyle)) {
        // ambiguous / unsafe — skip inference
      } else {
        const startTime = padTime(h1, 0);
        const endTime = padTime(h2, 0);
        const forPart = blockSpan[3]!.trim();
        let label = forPart.replace(/^for\s+/i, '').split(/\s+next\b/i)[0]!.trim().replace(/\s+/g, ' ');
        label = label ? label.slice(0, 140) : '';
        if (!label.trim()) return null;
        const dayInTail = forPart.match(new RegExp(`\\b${DAY_WORD}\\b`, 'i'))?.[0]?.toLowerCase();
        const explicitNextWeek = /\bnext\s+week\b/i.test(forPart);
        const nextWeekStart = explicitNextWeek
          ? DateTime.now().setZone(zone).plus({ weeks: 1 }).startOf('week')
          : null;
        const nextWeekEnd = nextWeekStart ? nextWeekStart.endOf('week') : null;
        const targetDate = dayInTail ? dateForWeekdayRequest(zone, dayInTail, explicitNextWeek) : null;
        const dayDow = dayInTail ? DAY_NAME[dayInTail] : undefined;
        const startDate = explicitNextWeek ? nextWeekStart!.toISODate()! : undefined;
        return {
          label,
          startTime,
          endTime,
          daysOfWeek: dayDow === undefined ? [1, 2, 3, 4, 5] : [dayDow],
          startDate: targetDate?.toISODate() ?? startDate,
          rangeEnd: targetDate?.toISODate() ?? (nextWeekEnd?.toISODate() ?? spanFocusRangeEnd(zone)),
          timezone: zone,
          tier: 1,
          rawUtterance: raw,
          source: 'infer_block_hour_span_explicit',
        };
      }
    }
  }
  return null;
}

/**
 * When infer fills PROTECT_BLOCK params, build a validated intent — used before LLM misclass guards.
 */
export function tryProtectBlockFromInfer(utterance: string, profileTimezone: string): ParsedIntent | null {
  const inferred = inferProtectBlockParams(utterance, profileTimezone);
  if (!inferred) return null;
  const z = ProtectBlockParamsSchema.safeParse(inferred);
  if (!z.success) return null;
  return ParsedIntentSchema.parse({
    intent: 'PROTECT_BLOCK',
    confidence: 1,
    rawUtterance: utterance,
    params: { ...z.data, rawUtterance: utterance },
    mappingMethod: 'direct',
  });
}
