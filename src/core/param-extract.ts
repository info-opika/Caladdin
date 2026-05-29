import { addDays, addMinutes, formatISO, startOfDay } from './date-utils.js';
import { ParsedIntent, ParsedIntentSchema } from './adts.js';

/** Pull event title from natural language (Name it X, called "X", etc.) */
export function extractTitle(utterance: string): string | undefined {
  const patterns = [
    /(?:name(?:\s+it)?|named|call(?:\s+it)?|title(?:\s+is)?)\s+['"]([^'"]+)['"]/i,
    /(?:name(?:\s+it)?|named|call(?:\s+it)?|title(?:\s+is)?)\s+(.+?)\.?\s*$/i,
    /['"]([^'"]+)['"]/,
  ];
  for (const re of patterns) {
    const m = utterance.match(re);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return undefined;
}

/** Pull target new title for rename utterances */
export function extractNewTitle(utterance: string): string | undefined {
  const patterns = [
    /(?:rename(?:\s+it)?(?:\s+to)?|retitle(?:\s+to)?|change (?:the )?name to|call it)\s+['"]([^'"]+)['"]/i,
    /(?:rename(?:\s+it)?(?:\s+to)?|retitle(?:\s+to)?|change (?:the )?name to|call it)\s+(.+?)\.?\s*$/i,
  ];
  for (const re of patterns) {
    const m = utterance.match(re);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return extractTitle(utterance);
}

/** Which existing event the user refers to (by title fragment) */
export function extractEventReference(utterance: string): string | undefined {
  const quoted = utterance.match(/['"]([^'"]+)['"]/);
  if (quoted?.[1]?.trim()) return quoted[1].trim();

  const removeMatch = utterance.match(/\b(?:remove|delete|cancel)\s+(?:the\s+)?(.+?)\s+event\b/i);
  if (removeMatch?.[1]?.trim()) return removeMatch[1].trim();

  const m = utterance.match(/(?:the event|event)\s+['"]?([^'".\n]+?)['"]?/i);
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
  const params = enrichFlushParams(enrichModifyParams(parsed.params ?? {}, rawUtterance), rawUtterance);

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
  return /\b(rename|retitle|change the name|call it)\b/i.test(utterance);
}

export function isModifyUtterance(utterance: string): boolean {
  return /\b(update|change|correct|fix|move|reschedule|starting at|ending at|\d+\s*hour|make it|should be)\b/i.test(utterance);
}

const TIME_RE = /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i;

function parseClockMatch(match: RegExpMatchArray, base: Date): Date {
  let hour = parseInt(match[1], 10);
  const minute = match[2] ? parseInt(match[2], 10) : 0;
  const ampm = match[3]?.toLowerCase();

  if (ampm === 'pm' && hour < 12) hour += 12;
  if (ampm === 'am' && hour === 12) hour = 0;
  if (!ampm && hour >= 1 && hour <= 7) hour += 12;

  const d = new Date(base);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function dayBaseFromUtterance(utterance: string, ref: Date): Date {
  const lower = utterance.toLowerCase();
  if (lower.includes('tomorrow')) return startOfDay(addDays(ref, 1));
  if (lower.includes('today')) return startOfDay(ref);
  return startOfDay(ref);
}

/** Parse "starting at 8 AM ... ending at 9 AM" style corrections */
export function parseModifyTimeRange(
  utterance: string,
  ref = new Date(),
): { newStart?: string; newEnd?: string } {
  const base = dayBaseFromUtterance(utterance, ref);
  const startRe = /\bstarting(?:\s+at)?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i;
  const endRe = /\bending(?:\s+at)?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i;

  const sm = utterance.match(startRe);
  const em = utterance.match(endRe);
  const out: { newStart?: string; newEnd?: string } = {};

  if (sm) out.newStart = formatISO(parseClockMatch(sm, base));
  if (em) out.newEnd = formatISO(parseClockMatch(em, base));

  const hourDur = utterance.match(/\b(\d+(?:\.\d+)?)\s*hour(?:\s+event)?\b/i);
  if (hourDur && out.newStart && !out.newEnd) {
    const mins = Math.round(parseFloat(hourDur[1]) * 60);
    out.newEnd = formatISO(addMinutes(new Date(out.newStart), mins));
  }

  if (!out.newStart && !out.newEnd) {
    const single = parseStartEndFromUtterance(utterance, ref);
    if (single) {
      out.newStart = single.start;
      out.newEnd = single.end;
    }
  }

  return out;
}

/** Parse "tomorrow at 8 AM" style phrases into ISO start/end (1h default duration) */
export function parseStartEndFromUtterance(
  utterance: string,
  ref = new Date(),
): { start: string; end: string } | null {
  const lower = utterance.toLowerCase();
  let base = startOfDay(ref);

  if (lower.includes('tomorrow')) {
    base = startOfDay(addDays(ref, 1));
  } else if (lower.includes('today')) {
    base = startOfDay(ref);
  } else if (!lower.includes('tomorrow') && !lower.includes('today')) {
    const startRe = /\bstarting(?:\s+at)?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i;
    if (startRe.test(utterance)) {
      base = startOfDay(ref);
    } else {
      return null;
    }
  }

  const tm = utterance.match(TIME_RE);
  if (!tm) return null;

  const start = parseClockMatch(tm, base);
  const end = addMinutes(start, 60);

  return { start: formatISO(start), end: formatISO(end) };
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
): Record<string, unknown> {
  const out = { ...params };
  if (!out.title) {
    const t = extractTitle(utterance);
    if (t) out.title = t;
  }
  if (!out.start || !out.end) {
    const range = parseStartEndFromUtterance(utterance);
    if (range) {
      if (!out.start) out.start = range.start;
      if (!out.end) out.end = range.end;
    }
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
  return out;
}

export function hasActionableParams(intent: string, params: Record<string, unknown>): boolean {
  switch (intent) {
    case 'CREATE_EVENT':
      return Boolean(params.title || params.start);
    case 'MODIFY_EVENT':
      return Boolean(params.newTitle || params.newStart || params.newEnd || params.eventTitle);
    case 'QUERY_CALENDAR':
    case 'PROTECT_BLOCK':
    case 'OFFER_SPECIFIC':
    case 'FLUSH_RANGE':
      return Boolean(params.eventTitle || params.rangeStart);
    case 'UNDO':
      return true;
    default:
      return false;
  }
}
