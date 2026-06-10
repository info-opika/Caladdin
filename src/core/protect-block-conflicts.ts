import { DateTime } from 'luxon';
import type { calendar_v3 } from 'googleapis';
import type { ProtectBlockParams } from './adts.js';

/** Matches protect-block weekday encoding: Sun=0 … Sat=6 (Luxon weekday Mon–Sat 1–6, Sun 7→0). */
export function luxonWeekdayToOur(dt: DateTime): number {
  const w = dt.weekday;
  return w === 7 ? 0 : w;
}

export type ConflictBullet = {
  eventId?: string | null;
  title: string;
  /** Single-line label for bullets */
  rangeLabel: string;
};

/** One calendar event overlaps at least one recurrence instance of the proposed block window. */
function parseEventBounds(ev: calendar_v3.Schema$Event, profileZone: string): { start: DateTime; end: DateTime } | null {
  const st = ev.start;
  const en = ev.end;
  if (st?.dateTime && en?.dateTime) {
    const s = DateTime.fromISO(st.dateTime, { setZone: true });
    const e = DateTime.fromISO(en.dateTime, { setZone: true });
    if (!s.isValid || !e.isValid) return null;
    return { start: s, end: e };
  }
  if (st?.date && en?.date) {
    const zs = `${st.date}T00:00:00`;
    const ze = `${en.date}T23:59:59`;
    return {
      start: DateTime.fromISO(zs, { zone: profileZone }),
      end: DateTime.fromISO(ze, { zone: profileZone }),
    };
  }
  return null;
}

/** Recurrence instances (wall clock in `zone`) for each matching weekday through `rangeEnd`. */
export function enumerateProtectOccurrences(
  params: ProtectBlockParams,
  zone: string
): Array<{ start: DateTime; end: DateTime }> {
  const ss = params.startTime.split(':');
  const ee = params.endTime.split(':');
  if (ss.length < 2 || ee.length < 2) return [];
  const sh = Number(ss[0]);
  const sm = Number(ss[1]);
  const eh = Number(ee[0]);
  const em = Number(ee[1]);
  const endDay = DateTime.fromISO(`${params.rangeEnd}T12:00:00`, { zone }).endOf('day');
  const out: Array<{ start: DateTime; end: DateTime }> = [];

  let d = params.startDate
    ? DateTime.fromISO(params.startDate, { zone }).startOf('day')
    : DateTime.now().setZone(zone).startOf('day');
  while (d <= endDay) {
    if (params.daysOfWeek.includes(luxonWeekdayToOur(d))) {
      const iso = d.toISODate()!;
      const hhmm = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      const os = DateTime.fromISO(`${iso}T${hhmm(sh, sm)}:00`, { zone });
      const oe = DateTime.fromISO(`${iso}T${hhmm(eh, em)}:00`, { zone });
      if (os.isValid && oe.isValid && oe > os) out.push({ start: os, end: oe });
    }
    d = d.plus({ days: 1 });
  }
  return out;
}

function intervalsOverlap(a0: DateTime, a1: DateTime, b0: DateTime, b1: DateTime): boolean {
  return a0 < b1 && b0 < a1;
}

/**
 * Finds calendar events overlapping any occurrence interval of the proposed recurring block.
 * Read-only classification — callers must never delete/move conflicts from results here.
 */
export function collectOverlapsForProtectBlock(
  events: calendar_v3.Schema$Event[],
  occurrencePairs: Array<{ start: DateTime; end: DateTime }>,
  profileZone: string,
  opts: { limit?: number } = {}
): ConflictBullet[] {
  const limit = opts.limit ?? 12;
  const hits: ConflictBullet[] = [];
  const seenIds = new Set<string>();

  for (const { start: bs, end: be } of occurrencePairs) {
    for (const ev of events) {
      const bounds = parseEventBounds(ev, profileZone);
      if (!bounds) continue;
      if (!intervalsOverlap(bs, be, bounds.start, bounds.end)) continue;
      const id = ev.id ?? `${ev.summary ?? ''}|${bounds.start.toISO()}`;
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      const title = ev.summary?.trim() || '(untitled event)';
      const rangeLabel = `${bounds.start.toFormat('EEE MMM d')}, ${bounds.start.toFormat(
        'h:mm a'
      )}–${bounds.end.toFormat('h:mm a')} — ${title}`;
      hits.push({
        eventId: ev.id,
        title,
        rangeLabel,
      });
      if (hits.length >= limit) return hits;
    }
  }

  return hits;
}

export function formatProtectBlockConflictBullets(lines: ConflictBullet[]): string {
  if (lines.length === 0) return '';
  const capped = lines.slice(0, 8);
  const block = capped.map((x) => `- ${x.rangeLabel}`).join('\n');
  const more = lines.length > 8 ? `\n…and ${lines.length - 8} more` : '';
  return `${block}${more}`;
}
