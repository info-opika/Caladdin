import { addDays, addMinutes, parseISO, formatISO, startOfDay, setHours, setMinutes } from './date-utils.js';
import { UserPolicyProfile } from '../core/adts.js';
import { listEvents } from '../db/events.js';

export interface ScoredSlot {
  start: string;
  end: string;
  score: number;
  label?: string;
}

const ENERGY_WEIGHT = 0.5;
const TIER_WEIGHT = 0.3;
const BUFFER_WEIGHT = 0.2;

export function scoreSlot(
  start: Date,
  end: Date,
  policy: UserPolicyProfile,
  busyEvents: Array<{ start: string; end: string; tier?: number }>,
): number {
  const hour = start.getHours();
  let energyScore = hour >= 9 && hour < 12 ? 1 : hour >= 14 && hour < 17 ? 0.7 : 0.5;
  const overlapsTier0 = busyEvents.some((e) => {
    const es = new Date(e.start);
    const ee = new Date(e.end);
    return start < ee && end > es && (e.tier ?? 2) === 0;
  });
  const tierScore = overlapsTier0 ? 0 : 1;
  const bufferScore = 1;
  return ENERGY_WEIGHT * energyScore + TIER_WEIGHT * tierScore + BUFFER_WEIGHT * bufferScore;
}

export async function generateSlots(
  userId: string,
  policy: UserPolicyProfile,
  durationMinutes: number,
  daysAhead = 7,
): Promise<ScoredSlot[]> {
  const now = new Date();
  const rangeEnd = addDays(now, daysAhead);
  const events = await listEvents(userId, now.toISOString(), rangeEnd.toISOString());
  const busy = events.map((e) => ({ start: e.start, end: e.end, tier: e.tier }));

  const slots: ScoredSlot[] = [];
  const [startH, startM] = policy.workingHoursStart.split(':').map(Number);
  const [endH] = policy.workingHoursEnd.split(':').map(Number);

  for (let d = 0; d < daysAhead; d++) {
    const day = addDays(startOfDay(now), d);
    let cursor = setMinutes(setHours(day, startH), startM);
    const dayEnd = setHours(day, endH);

    while (cursor < dayEnd) {
      const slotEnd = addMinutes(cursor, durationMinutes);
      if (slotEnd > dayEnd) break;

      const overlaps = busy.some((b) => {
        const bs = new Date(b.start);
        const be = new Date(b.end);
        return cursor < be && slotEnd > bs;
      });

      if (!overlaps) {
        const score = scoreSlot(cursor, slotEnd, policy, busy);
        slots.push({
          start: formatISO(cursor),
          end: formatISO(slotEnd),
          score,
        });
      }
      cursor = addMinutes(cursor, 30);
    }
  }

  return slots.sort((a, b) => b.score - a.score).slice(0, 2);
}
