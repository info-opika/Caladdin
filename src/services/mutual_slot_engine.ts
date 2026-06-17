import { DateTime } from 'luxon';
import type { CandidateSlot } from '../core/adts.js';
import { migratePolicy } from '../core/adts.js';
import {
  mergeBusyIntervals,
  generateCandidateSlots,
  pickTwoDiverseSlots,
  freeBusyToIntervals,
  offeredSlotsToBusy,
  type BusyInterval,
} from './scheduling_slot_engine.js';

export type MutualSlot = { start: string; end: string };

export function mergeHostAndInviteeBusy(
  hostBusy: BusyInterval[],
  inviteeBusy: BusyInterval[],
): BusyInterval[] {
  return mergeBusyIntervals([...hostBusy, ...inviteeBusy]);
}

export function findMutualSlots(params: {
  hostBusy: BusyInterval[];
  inviteeBusy: BusyInterval[];
  windowStart: string;
  windowEnd: string;
  durationMinutes: number;
  timezone: string;
  dayStartHour: number;
  dayEndHour: number;
  excludeSlots?: MutualSlot[];
}): MutualSlot[] {
  const {
    hostBusy,
    inviteeBusy,
    windowStart,
    windowEnd,
    durationMinutes,
    timezone,
    dayStartHour,
    dayEndHour,
    excludeSlots = [],
  } = params;

  const mergedBusy = mergeHostAndInviteeBusy(hostBusy, inviteeBusy);
  const excludeBusy = offeredSlotsToBusy(excludeSlots);
  const busy = mergeBusyIntervals([...mergedBusy, ...excludeBusy]);

  const winStart = DateTime.fromISO(windowStart, { zone: timezone });
  const winEnd = DateTime.fromISO(windowEnd, { zone: timezone });
  if (!winStart.isValid || !winEnd.isValid || winEnd <= winStart) {
    return [];
  }

  const profile = migratePolicy({
    timezone,
    chronotype: 'flexible',
    workingHoursStart: `${String(dayStartHour).padStart(2, '0')}:00`,
    workingHoursEnd: `${String(dayEndHour).padStart(2, '0')}:00`,
    defaultMeetingLengthMinutes: durationMinutes,
  });

  const candidates = generateCandidateSlots({
    profile,
    durationMinutes,
    windowStart: winStart,
    windowEnd: winEnd,
    busy,
    existingEvents: [],
    slotDayStartHour: dayStartHour,
    slotDayEndHour: dayEndHour,
  });

  if (candidates.length === 0) return [];

  const ranked = [...candidates].sort(
    (a, b) => b.energyScore - a.energyScore || a.start.localeCompare(b.start),
  );
  const picked = pickTwoDiverseSlots(ranked, timezone, 90);
  return picked.map((s) => ({ start: s.start, end: s.end }));
}

export function freeBusyResponseToIntervals(
  busy: Array<{ start?: string | null; end?: string | null }>,
): BusyInterval[] {
  return freeBusyToIntervals(busy);
}

export function candidateSlotsToMutual(slots: CandidateSlot[]): MutualSlot[] {
  return slots.map((s) => ({ start: s.start, end: s.end }));
}
