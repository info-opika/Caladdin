import { DateTime } from 'luxon';
import type { CandidateSlot } from '../core/adts.js';
import { migratePolicy } from '../core/adts.js';
import {
  mergeBusyIntervals,
  generateCandidateSlots,
  pickTwoDiverseSlots,
  freeBusyToIntervals,
  offeredSlotsToBusy,
  intervalsOverlap,
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

export type SlotConflict = { start: string; end: string; party: 'host' | 'invitee' };

export type CheckSpecificSlotResult = {
  available: boolean;
  scope: 'host_only' | 'mutual';
  conflicts: SlotConflict[];
  reason?: string;
};

export function checkSpecificSlot(params: {
  candidateStart: string;
  candidateEnd: string;
  hostBusy: BusyInterval[];
  inviteeBusy?: BusyInterval[];
  timezone: string;
}): CheckSpecificSlotResult {
  const { candidateStart, candidateEnd, hostBusy, inviteeBusy } = params;
  const scope: CheckSpecificSlotResult['scope'] = inviteeBusy !== undefined ? 'mutual' : 'host_only';

  const startMs = new Date(candidateStart).getTime();
  const endMs = new Date(candidateEnd).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return {
      available: false,
      scope,
      conflicts: [],
      reason: 'invalid_time_range',
    };
  }

  const candidate: BusyInterval = { start: candidateStart, end: candidateEnd };
  const conflicts: SlotConflict[] = [];

  for (const block of hostBusy) {
    if (intervalsOverlap(candidate, block)) {
      conflicts.push({ start: block.start, end: block.end, party: 'host' });
    }
  }

  if (inviteeBusy) {
    for (const block of inviteeBusy) {
      if (intervalsOverlap(candidate, block)) {
        conflicts.push({ start: block.start, end: block.end, party: 'invitee' });
      }
    }
  }

  return {
    available: conflicts.length === 0,
    scope,
    conflicts,
  };
}
