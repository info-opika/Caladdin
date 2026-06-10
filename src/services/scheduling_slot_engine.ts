import { DateTime } from 'luxon';
import type { CalendarEvent, CandidateSlot, UserPolicyProfile } from '../core/adts.js';
import { computeEnergyScore, selectTopSlots } from '../core/intents/offer-specific.js';

export type BusyInterval = { start: string; end: string };
export type SlotIso = { start: string; end: string };

const LUNCH_START = 12;
const LUNCH_END = 13;
const SLOT_STEP_MIN = 30;
/** Public for tests — scheduling invite slots must not inherit wall-clock “random” minutes from (now + notice). */
export const SLOT_START_MINUTE_MOD = 15;

/**
 * Next allowed start boundary (:00, :15, :30, :45) in the wall clock of `dt`’s zone.
 * Rounds up so minimum-notice and search windows never start at e.g. :47.
 */
export function alignWindowStartToQuarterHour(dt: DateTime): DateTime {
  const t = dt.set({ second: 0, millisecond: 0 });
  const r = t.minute % SLOT_START_MINUTE_MOD;
  if (r === 0) return t;
  return t.plus({ minutes: SLOT_START_MINUTE_MOD - r });
}

export function mergeBusyIntervals(intervals: BusyInterval[]): BusyInterval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.start.localeCompare(b.start));
  const out: BusyInterval[] = [];
  let cur = { ...sorted[0]! };
  for (let i = 1; i < sorted.length; i++) {
    const n = sorted[i]!;
    if (new Date(n.start).getTime() <= new Date(cur.end).getTime()) {
      if (new Date(n.end).getTime() > new Date(cur.end).getTime()) cur = { start: cur.start, end: n.end };
    } else {
      out.push(cur);
      cur = { ...n };
    }
  }
  out.push(cur);
  return out;
}

export function intervalsOverlap(a: BusyInterval, b: BusyInterval): boolean {
  return new Date(a.start).getTime() < new Date(b.end).getTime() && new Date(a.end).getTime() > new Date(b.start).getTime();
}

function overlapsAny(slot: BusyInterval, list: BusyInterval[]): boolean {
  return list.some((b) => intervalsOverlap(slot, b));
}

/** Build CandidateSlot list in [windowStart, windowEnd] excluding merged busy + lunch. */
export function generateCandidateSlots(params: {
  profile: UserPolicyProfile;
  durationMinutes: number;
  windowStart: DateTime;
  windowEnd: DateTime;
  busy: BusyInterval[];
  existingEvents: CalendarEvent[];
  /**
   * When true (default), the first search tick aligns to the next :00 / :15 / :30 / :45 so “now+notice”
   * does not produce :07 / :47 / :17 style starts. Set false only if a caller needs exact-minute anchors.
   */
  snapSlotStartsToQuarterHour?: boolean;
  /**
   * Local hour (0–23) inclusive — first slot **start** boundary each calendar day for the search grid.
   * Caller must supply (e.g. from user text). No engine default for “workday start”.
   */
  slotDayStartHour: number;
  /**
   * Local hour (0–23) — iteration stops before this wall time; slots must fit so the last start keeps
   * the event ending on or before this boundary. Caller supplies; no hidden 5pm/9pm/11pm fallback.
   */
  slotDayEndHour: number;
}): CandidateSlot[] {
  const {
    profile,
    durationMinutes,
    windowStart,
    windowEnd,
    busy,
    existingEvents,
    snapSlotStartsToQuarterHour = true,
    slotDayStartHour,
    slotDayEndHour,
  } = params;
  const dayStartHour = slotDayStartHour;
  const dayEndHour = slotDayEndHour;
  const zone = profile.timezone;
  const lunchBusy: BusyInterval[] = [];
  let d = windowStart.startOf('day');
  const endDay = windowEnd.endOf('day');
  while (d <= endDay) {
    const ls = d.set({ hour: LUNCH_START, minute: 0, second: 0, millisecond: 0 });
    const le = d.set({ hour: LUNCH_END, minute: 0, second: 0, millisecond: 0 });
    lunchBusy.push({ start: ls.toISO()!, end: le.toISO()! });
    d = d.plus({ days: 1 });
  }
  const merged = mergeBusyIntervals(mergeBusyIntervals([...busy, ...lunchBusy]));

  const candidates: CandidateSlot[] = [];
  let t = snapSlotStartsToQuarterHour ? alignWindowStartToQuarterHour(windowStart) : windowStart;
  while (t < windowEnd) {
    const dayStart = t.set({ hour: dayStartHour, minute: 0, second: 0, millisecond: 0 });
    const dayEnd = t.set({ hour: dayEndHour, minute: 0, second: 0, millisecond: 0 });
    if (t < dayStart) t = dayStart;
    if (t >= dayEnd) {
      t = t.plus({ days: 1 }).set({ hour: dayStartHour, minute: 0, second: 0, millisecond: 0 });
      continue;
    }
    const slotEnd = t.plus({ minutes: durationMinutes });
    if (slotEnd > dayEnd) {
      t = t.plus({ days: 1 }).set({ hour: dayStartHour, minute: 0, second: 0, millisecond: 0 });
      continue;
    }
    const isoS = t.toISO()!;
    const isoE = slotEnd.toISO()!;
    if (overlapsAny({ start: isoS, end: isoE }, merged)) {
      t = t.plus({ minutes: SLOT_STEP_MIN });
      continue;
    }

    let adjacent = 0;
    for (const ev of existingEvents) {
      const es = DateTime.fromISO(ev.start, { zone });
      const ee = DateTime.fromISO(ev.end, { zone });
      const gapBefore = Math.abs(t.diff(es, 'minutes').minutes);
      const gapAfter = Math.abs(slotEnd.diff(ee, 'minutes').minutes);
      if (gapBefore <= 30 || gapAfter <= 30) adjacent++;
    }

    const energyScore = computeEnergyScore(t, profile.chronotype);

    let createsFragment = false;
    const nextBusy = merged.find((b) => new Date(b.start).getTime() >= slotEnd.toMillis());
    if (nextBusy) {
      const gapMin = (new Date(nextBusy.start).getTime() - slotEnd.toMillis()) / 60000;
      if (gapMin > 0 && gapMin < 30) createsFragment = true;
    }
    const prevBusy = [...merged].reverse().find((b) => new Date(b.end).getTime() <= t.toMillis());
    if (prevBusy) {
      const gapMin = (t.toMillis() - new Date(prevBusy.end).getTime()) / 60000;
      if (gapMin > 0 && gapMin < 30) createsFragment = true;
    }

    candidates.push({
      start: isoS,
      end: isoE,
      adjacentEventCount: adjacent,
      energyScore,
      createsFragment,
    });
    t = t.plus({ minutes: SLOT_STEP_MIN });
  }
  return candidates;
}

/** Pick top two with Fax scoring, enforcing minimum separation when alternatives exist. */
export function pickTwoDiverseSlots(
  scoredOrdered: CandidateSlot[],
  timezone: string,
  minMinutesApart: number
): CandidateSlot[] {
  if (scoredOrdered.length === 0) return [];
  const first = scoredOrdered[0]!;
  const t0 = DateTime.fromISO(first.start, { zone: timezone });
  const second =
    scoredOrdered.slice(1).find((s) => {
      const t1 = DateTime.fromISO(s.start, { zone: timezone });
      return Math.abs(t1.diff(t0, 'minutes').minutes) >= minMinutesApart;
    }) ?? scoredOrdered[1];
  if (!second) return [first];
  return [first, second];
}

export function eventsToBusyIntervals(events: CalendarEvent[]): BusyInterval[] {
  return events.map((e) => ({ start: e.start, end: e.end }));
}

export function freeBusyToIntervals(
  busy: Array<{ start?: string | null; end?: string | null }>
): BusyInterval[] {
  return busy
    .filter((b) => b.start && b.end)
    .map((b) => ({ start: b.start!, end: b.end! }));
}

export function offeredSlotsToBusy(offered: SlotIso[]): BusyInterval[] {
  return offered.map((o) => ({ start: o.start, end: o.end }));
}

/** Score, sort, return up to two diverse curated slots. */
export function curateTwoSchedulingSlots(
  candidates: CandidateSlot[],
  profile: UserPolicyProfile
): CandidateSlot[] {
  const ranked = selectTopSlots(candidates, profile, Math.max(8, candidates.length));
  if (ranked.length <= 2) return ranked;
  return pickTwoDiverseSlots(ranked, profile.timezone, 90);
}
