import { addDays, addMinutes, formatISO, startOfDay } from './date-utils.js';

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
  const m = utterance.match(/(?:the event|event)\s+['"]?([^'".\n]+?)['"]?/i);
  if (m?.[1]?.trim()) return m[1].trim();
  return undefined;
}

export function isRenameUtterance(utterance: string): boolean {
  return /\b(rename|retitle|change the name|call it)\b/i.test(utterance);
}

const TIME_RE = /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i;

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
    return null;
  }

  const tm = utterance.match(TIME_RE);
  if (!tm) return null;

  let hour = parseInt(tm[1], 10);
  const minute = tm[2] ? parseInt(tm[2], 10) : 0;
  const ampm = tm[3]?.toLowerCase();

  if (ampm === 'pm' && hour < 12) hour += 12;
  if (ampm === 'am' && hour === 12) hour = 0;
  if (!ampm && hour <= 7) hour += 12; // bare "8" in scheduling context → morning if small

  const start = new Date(base);
  start.setHours(hour, minute, 0, 0);
  const end = addMinutes(start, 60);

  return { start: formatISO(start), end: formatISO(end) };
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
  return out;
}
