import { DateTime } from 'luxon';

export type HaikuDateAnchor = {
  isoDate: string;
  isoTimestamp: string;
  timezone: string;
  weekdayName: string;
};

/** Wall-clock anchor for relative date phrases in Haiku prompts (never stale training-year defaults). */
export function buildHaikuDateAnchor(timezone: string, nowMs = Date.now()): HaikuDateAnchor {
  const zone = timezone.trim() || 'America/Chicago';
  const dt = DateTime.fromMillis(nowMs, { zone });
  return {
    isoDate: dt.toISODate()!,
    isoTimestamp: dt.toISO()!,
    timezone: zone,
    weekdayName: dt.weekdayLong ?? 'Unknown',
  };
}

export function formatHaikuDateAnchorBlock(anchor: HaikuDateAnchor): string {
  return [
    'CURRENT DATE ANCHOR (authoritative — all relative dates must resolve from this instant):',
    `- Today's calendar date (${anchor.timezone}): ${anchor.isoDate} (${anchor.weekdayName})`,
    `- Current timestamp (${anchor.timezone}): ${anchor.isoTimestamp}`,
    `- User timezone: ${anchor.timezone}`,
    '- Resolve "today", "tomorrow", "next week", "next Monday", "in two weeks" relative to the timestamp above.',
    '- Never use years from model training; use the anchor year.',
  ].join('\n');
}
