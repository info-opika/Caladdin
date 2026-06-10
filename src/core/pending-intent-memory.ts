import { DateTime } from 'luxon';
import { ProtectBlockParamsSchema, type ParsedIntent, ParsedIntentSchema } from './adts.js';
import { parseSpokenClock } from './protect-block-prefilter.js';
import { extractSchedulingSearchWindowHours } from './scheduling-link-prefilter.js';
import { logger } from '../logger.js';
import {
  PENDING_FRAME_TTL_MS,
  clearPendingFrame,
  getPendingFrame,
  upsertPendingFrame,
  _setPendingFrameStorageForTests,
  SharedInMemoryPendingFrameStorage,
  type PendingIntentTemplate,
} from '../db/conversation-context.js';

export type { PendingIntentTemplate };

export async function clearPendingIntent(userId: string): Promise<void> {
  await clearPendingFrame(userId);
}

export async function getPendingIntent(userId: string): Promise<PendingIntentTemplate | null> {
  return getPendingFrame(userId);
}

export async function savePendingIntent(
  userId: string,
  template: Omit<PendingIntentTemplate, 'createdAt' | 'expiresAt'>,
): Promise<void> {
  const createdAt = DateTime.utc().toISO()!;
  const expiresAt = DateTime.utc().plus({ milliseconds: PENDING_FRAME_TTL_MS }).toISO()!;
  await upsertPendingFrame(userId, { ...template, createdAt, expiresAt });
}

const SCHEDULING_KNOWN_PARAM_KEYS = [
  'inviteeEmail',
  'inviteeLabel',
  'parsedSchedulingDateRange',
  'schedulingUnsupportedConstraints',
  'schedulingDefaultSearchWindow',
  'durationMinutes',
  'schedulingParseRisk',
] as const;

export function extractSchedulingKnownFieldsFromIntent(intent: ParsedIntent): Record<string, unknown> {
  const p = intent.params as Record<string, unknown>;
  const known: Record<string, unknown> = {};
  for (const k of SCHEDULING_KNOWN_PARAM_KEYS) {
    if (p[k] !== undefined) known[k] = p[k];
  }
  if (!Array.isArray(known['schedulingUnsupportedConstraints'])) {
    known['schedulingUnsupportedConstraints'] = [];
  }
  return known;
}

function schedulingKnownFieldsStructurallyComplete(known: Record<string, unknown>): boolean {
  if (!Array.isArray(known['schedulingUnsupportedConstraints'])) return false;
  const pr = known['parsedSchedulingDateRange'];
  const hasRange =
    typeof pr === 'object' &&
    pr !== null &&
    typeof (pr as { start?: unknown }).start === 'string' &&
    typeof (pr as { end?: unknown }).end === 'string' &&
    (pr as { start: string }).start.length >= 8 &&
    (pr as { end: string }).end.length >= 8;
  if (!hasRange && known['schedulingDefaultSearchWindow'] !== true) return false;
  const email = typeof known['inviteeEmail'] === 'string' ? known['inviteeEmail'].trim() : '';
  if (!email.includes('@') || !/\S+@\S+\.\S+/.test(email)) return false;
  return true;
}

function buildSchedulingFromPending(
  template: PendingIntentTemplate,
  window: { startHour: number; endHour: number },
): ParsedIntent | null {
  const merged: Record<string, unknown> = {
    ...template.knownFields,
    windowStartHourLocal: window.startHour,
    windowEndHourLocal: window.endHour,
  };
  if (!schedulingKnownFieldsStructurallyComplete(merged)) {
    logger.warn('Pending scheduling merge incomplete', { knownKeys: Object.keys(merged) });
    return null;
  }
  if (window.startHour >= window.endHour) return null;
  return ParsedIntentSchema.parse({
    intent: 'SCHEDULING_LINK',
    rawUtterance: template.originalUtterance,
    confidence: 0.92,
    params: merged,
    mappingMethod: 'direct',
  });
}

export async function storePendingSchedulingWindowClarification(
  userId: string,
  intent: ParsedIntent,
): Promise<void> {
  const knownFields = extractSchedulingKnownFieldsFromIntent(intent);
  const risk =
    typeof knownFields['schedulingParseRisk'] === 'string'
      ? knownFields['schedulingParseRisk']
      : undefined;
  await storePendingForClarification(
    userId,
    ParsedIntentSchema.parse({
      intent: 'SCHEDULING_LINK',
      rawUtterance: intent.rawUtterance,
      confidence: intent.confidence,
      params: knownFields,
      mappingMethod: intent.mappingMethod,
    }),
    ['windowStartHourLocal', 'windowEndHourLocal'],
    knownFields,
    risk,
  );
}

let testMemoryStorage: SharedInMemoryPendingFrameStorage | null = null;

export function _resetPendingIntentStoreForTests(): void {
  testMemoryStorage = new SharedInMemoryPendingFrameStorage();
  _setPendingFrameStorageForTests(testMemoryStorage);
}

export function _clearPendingFrameStorageOverrideForTests(): void {
  testMemoryStorage = null;
  _setPendingFrameStorageForTests(null);
}

const NUMERIC_RANGE = /\b(\d{1,2})\s*(?::(\d{2}))?\s*(am|pm)?\s*(?:to|[-–])\s*(\d{1,2})\s*(?::(\d{2}))?\s*(am|pm)?\b/i;

function padTime(h: number, m: number): string {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export type FollowUpHourRangeResult =
  | { status: 'resolved'; startTime: string; endTime: string }
  | { status: 'ambiguous'; hourStart: number; hourEnd: number }
  | { status: 'no_match' };

function tryContextSafeHourInference(
  pendingContextUtterance: string,
  h1: number,
  h2: number,
  m1: number,
  m2: number,
): { startTime: string; endTime: string } | null {
  if (!(h1 < h2 && h1 >= 1 && h2 <= 12)) return null;
  const ctx = pendingContextUtterance.toLowerCase();

  if (/\blunch(?:\s+time)?\b/.test(ctx)) {
    if (h1 === 1 && h2 === 2) return { startTime: '13:00', endTime: '14:00' };
    if (h1 >= 1 && h2 <= 3) {
      const sh = h1 === 12 ? 12 : h1 + 12;
      const eh = h2 === 12 ? 12 : h2 + 12;
      if (sh < eh) return { startTime: padTime(sh, m1), endTime: padTime(eh, m2) };
    }
  }

  if (/\b(evenings?|dinners?)\b/.test(ctx)) {
    if (h1 >= 5 && h1 <= 11 && h2 >= 5 && h2 <= 11) {
      const sh = h1 < 12 ? h1 + 12 : h1;
      const eh = h2 < 12 ? h2 + 12 : h2;
      if (sh < eh) return { startTime: padTime(sh, m1), endTime: padTime(eh, m2) };
    }
  }

  if (/\bmornings?\b/.test(ctx)) {
    if (h1 >= 6 && h2 <= 12) {
      return { startTime: padTime(h1, m1), endTime: padTime(h2, m2) };
    }
  }

  if (/\bafternoons?\b/.test(ctx)) {
    const toPm = (h: number) => (h === 12 ? 12 : h < 12 ? h + 12 : h);
    if ((h1 === 12 || (h1 >= 1 && h1 <= 4)) && h2 >= 1 && h2 <= 6) {
      const sh = toPm(h1);
      const eh = toPm(h2);
      if (sh < eh) return { startTime: padTime(sh, m1), endTime: padTime(eh, m2) };
    }
  }

  return null;
}

export function parseFollowUpHourRange(
  utterance: string,
  pendingContextUtterance: string,
): FollowUpHourRangeResult {
  const t = utterance.trim();
  const m = t.match(NUMERIC_RANGE);
  if (!m) return { status: 'no_match' };

  const h1 = parseInt(m[1]!, 10);
  const h2 = parseInt(m[4]!, 10);
  const m1 = m[2] ? parseInt(m[2], 10) : 0;
  const m2 = m[5] ? parseInt(m[5], 10) : 0;

  if (m[3] || m[6]) {
    const startCtx = `${m[1]}${m[2] ? `:${m[2]}` : ''}${m[3] ? ` ${m[3]}` : ''}`.trim();
    const endCtx = `${m[4]}${m[5] ? `:${m[5]}` : ''}${m[6] ? ` ${m[6]}` : ''}`.trim();
    const start = parseSpokenClock('start', startCtx);
    const end = parseSpokenClock('end', endCtx);
    if (!start || !end) return { status: 'no_match' };
    const startTime = padTime(start.hh, start.mm);
    const endTime = padTime(end.hh, end.mm);
    if (startTime >= endTime) return { status: 'no_match' };
    return { status: 'resolved', startTime, endTime };
  }

  if (h1 >= 13 || h2 > 12) {
    if (h1 < h2 && h1 >= 1 && h2 <= 23) {
      return { status: 'resolved', startTime: padTime(h1, m1), endTime: padTime(h2, m2) };
    }
    return { status: 'no_match' };
  }

  const inferred = tryContextSafeHourInference(pendingContextUtterance, h1, h2, m1, m2);
  if (inferred) return { status: 'resolved', ...inferred };

  if (h1 < h2 && h1 >= 1 && h2 <= 12) {
    return { status: 'ambiguous', hourStart: h1, hourEnd: h2 };
  }

  return { status: 'no_match' };
}

const DAY_NAME: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};

export function extractProtectKnownFieldsFromUtterance(
  utterance: string,
  timezone: string,
): Record<string, unknown> {
  const raw = utterance.trim();
  const lower = raw.toLowerCase();
  const zone = timezone.trim() || 'UTC';
  const now = DateTime.now().setZone(zone).startOf('day');

  const known: Record<string, unknown> = { timezone: zone, tier: 1 };

  const called = raw.match(/\bcalled\s+([^,.]+)/i) ?? raw.match(/\bnamed\s+([^,.]+)/i);
  if (called?.[1]) known['label'] = called[1].trim().slice(0, 140);

  let daysOfWeek: number[] = [];
  if (/\bweekdays?\b|\bweek\s+days?\b/i.test(lower)) {
    daysOfWeek = [1, 2, 3, 4, 5];
  } else {
    for (const [name, dow] of Object.entries(DAY_NAME)) {
      if (new RegExp(`\\b${name}\\b`, 'i').test(lower)) daysOfWeek.push(dow);
    }
  }

  let startDate = now.toISODate()!;
  if (/\btomorrow\b|\btmrw\b/i.test(lower)) {
    startDate = now.plus({ days: 1 }).toISODate()!;
    if (daysOfWeek.length === 0) daysOfWeek = [now.plus({ days: 1 }).weekday % 7];
  } else if (/\btoday\b/i.test(lower)) {
    startDate = now.toISODate()!;
    if (daysOfWeek.length === 0) daysOfWeek = [now.weekday % 7];
  }

  if (daysOfWeek.length === 0) daysOfWeek = [now.weekday % 7];

  const weeksMatch = lower.match(/\bfor\s+(\d+)\s+weeks?\b/);
  known['daysOfWeek'] = [...new Set(daysOfWeek)].sort((a, b) => a - b);
  known['startDate'] = startDate;
  if (weeksMatch) {
    known['rangeEnd'] = now.plus({ weeks: parseInt(weeksMatch[1]!, 10) }).toISODate()!;
  } else if (/\btomorrow\b|\btoday\b/i.test(lower)) {
    known['rangeEnd'] = startDate;
  }

  return known;
}

function buildProtectFromPending(
  template: PendingIntentTemplate,
  timeRange: { startTime: string; endTime: string },
  timezone: string,
): ParsedIntent | null {
  const merged: Record<string, unknown> = {
    ...template.knownFields,
    startTime: timeRange.startTime,
    endTime: timeRange.endTime,
    timezone: template.knownFields['timezone'] ?? timezone,
    rawUtterance: template.originalUtterance,
  };
  if (typeof merged['label'] !== 'string' || !String(merged['label']).trim()) {
    merged['label'] = template.originalUtterance.trim().slice(0, 140) || 'Block';
  }
  if (typeof merged['rangeEnd'] !== 'string' && typeof merged['startDate'] === 'string') {
    merged['rangeEnd'] = merged['startDate'];
  }
  const z = ProtectBlockParamsSchema.safeParse(merged);
  if (!z.success) {
    logger.warn('Pending protect merge failed schema', { issues: z.error.issues });
    return null;
  }
  return ParsedIntentSchema.parse({
    intent: 'PROTECT_BLOCK',
    rawUtterance: template.originalUtterance,
    confidence: 0.92,
    params: { ...z.data, rawUtterance: template.originalUtterance },
    mappingMethod: 'direct',
  });
}

export async function tryCompletePendingIntent(
  userId: string,
  utterance: string,
  timezone: string,
): Promise<ParsedIntent | null> {
  const pending = await getPendingIntent(userId);
  if (!pending) return null;

  if (pending.pendingIntent === 'SCHEDULING_LINK') {
    const window = extractSchedulingSearchWindowHours(utterance);
    if (!window) return null;
    const completed = buildSchedulingFromPending(pending, window);
    if (completed) {
      await clearPendingIntent(userId);
      return completed;
    }
    return null;
  }

  if (pending.pendingIntent === 'PROTECT_BLOCK') {
    const outcome = parseFollowUpHourRange(utterance, pending.originalUtterance);
    if (outcome.status === 'no_match') return null;
    if (outcome.status === 'ambiguous') {
      return ParsedIntentSchema.parse({
        intent: 'RESOLVE_MANUAL',
        rawUtterance: pending.originalUtterance,
        confidence: 0.5,
        params: {
          reason: 'protect_followup_time_ambiguous',
          clarifyHourStart: outcome.hourStart,
          clarifyHourEnd: outcome.hourEnd,
          followUpUtterance: utterance.trim(),
        },
        mappingMethod: 'resolve_manual',
      });
    }
    const completed = buildProtectFromPending(
      pending,
      { startTime: outcome.startTime, endTime: outcome.endTime },
      timezone,
    );
    if (completed) {
      await clearPendingIntent(userId);
      return completed;
    }
    return null;
  }

  return null;
}

export async function storePendingForClarification(
  userId: string,
  draft: ParsedIntent,
  missingFields: string[],
  knownFields: Record<string, unknown>,
  parseRisk?: string,
): Promise<void> {
  await savePendingIntent(userId, {
    pendingIntent: draft.intent,
    knownFields,
    missingFields,
    originalUtterance: draft.rawUtterance,
    ...(parseRisk ? { parseRisk } : {}),
  });
}

export async function _setExpiredPendingForTests(
  userId: string,
  template: Omit<PendingIntentTemplate, 'createdAt' | 'expiresAt'>,
): Promise<void> {
  if (!testMemoryStorage) _resetPendingIntentStoreForTests();
  const createdAt = DateTime.utc().minus({ minutes: 20 }).toISO()!;
  const expiresAt = DateTime.utc().minus({ minutes: 1 }).toISO()!;
  await testMemoryStorage!.upsertRawRow!(userId, {
    type: 'pending_intent',
    ...template,
    createdAt,
    expiresAt,
  });
}
