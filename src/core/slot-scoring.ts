import { addDays, addMinutes, parseISO, formatISO, startOfDay, setHours, setMinutes } from './date-utils.js';
import { UserPolicyProfile, CandidateSlot } from './adts.js';
import { listEvents } from '../db/events.js';
import { selectTopSlots, computeEnergyScore } from './intents/offer-specific.js';
import { DateTime } from 'luxon';
import type { calendar_v3 } from 'googleapis';
import { listBusyFromGCal } from '../services/calendar_api.js';
import { getUserByEmail } from '../db/users.js';
import { getOAuthClientForUser } from '../services/auth_service.js';

export interface ScoredSlot {
  start: string;
  end: string;
  score: number;
  label?: string;
}

function slotOverlapsProtectedBlock(
  cursor: Date,
  slotEnd: Date,
  block: { daysOfWeek: number[]; startTime: string; endTime: string },
): boolean {
  const day = cursor.getDay();
  if (!block.daysOfWeek.includes(day)) return false;
  const [sh, sm] = block.startTime.split(':').map(Number);
  const [eh, em] = block.endTime.split(':').map(Number);
  const blockStart = new Date(cursor);
  blockStart.setHours(sh, sm, 0, 0);
  const blockEnd = new Date(cursor);
  blockEnd.setHours(eh, em, 0, 0);
  return cursor < blockEnd && slotEnd > blockStart;
}
export async function generateSlots(
  userId: string,
  policy: UserPolicyProfile,
  durationMinutes: number,
  daysAhead = 7,
  options?: {
    recipientEmail?: string;
    cal?: calendar_v3.Calendar | null;
  },
): Promise<ScoredSlot[]> {
  const now = new Date();
  const rangeEnd = addDays(now, daysAhead);
  const events = await listEvents(userId, now.toISOString(), rangeEnd.toISOString());
  let busy = events
    .filter((e) => e.status !== 'cancelled')
    .map((e) => ({ start: e.start, end: e.end, tier: e.tier, title: e.title }));

  if (options?.cal) {
    const gcalBusy = await listBusyFromGCal(options.cal, now.toISOString(), rangeEnd.toISOString());
    busy = [...busy, ...gcalBusy.map((b) => ({ start: b.start, end: b.end, tier: 2, title: 'Busy' }))];
  }

  if (options?.recipientEmail) {
    const recipient = await getUserByEmail(options.recipientEmail);
    if (recipient) {
      const recipientCal = await getOAuthClientForUser(recipient.id);
      if (recipientCal) {
        const rb = await listBusyFromGCal(recipientCal, now.toISOString(), rangeEnd.toISOString());
        busy = [...busy, ...rb.map((b) => ({ start: b.start, end: b.end, tier: 2, title: 'Guest busy' }))];
      }
    }
  }

  const candidates: CandidateSlot[] = [];
  const [startH, startM] = policy.workingHoursStart.split(':').map(Number);
  const [endH] = policy.workingHoursEnd.split(':').map(Number);
  const tz = policy.timezone ?? 'America/Chicago';
  const chronotype = policy.chronotype ?? 'morning';

  for (let d = 0; d < daysAhead; d++) {
    const day = addDays(startOfDay(now), d);
    let cursor = setMinutes(setHours(day, startH), startM);
    const dayEnd = setHours(day, endH);

    while (cursor < dayEnd) {
      const slotEnd = addMinutes(cursor, durationMinutes);
      if (slotEnd > dayEnd) break;

      const overlapsBusy = busy.some((b) => {
        const bs = new Date(b.start);
        const be = new Date(b.end);
        return cursor < be && slotEnd > bs;
      });

      const overlapsProtected = policy.protectedBlocks.some((block) =>
        slotOverlapsProtectedBlock(cursor, slotEnd, block),
      );

      if (!overlapsBusy && !overlapsProtected) {
        const dt = DateTime.fromJSDate(cursor, { zone: tz });
        candidates.push({
          start: formatISO(cursor),
          end: formatISO(slotEnd),
          adjacentEventCount: busy.filter((b) => {
            const bs = new Date(b.start);
            const be = new Date(b.end);
            const gap = Math.min(Math.abs(cursor.getTime() - be.getTime()), Math.abs(bs.getTime() - slotEnd.getTime()));
            return gap <= 30 * 60 * 1000;
          }).length,
          energyScore: computeEnergyScore(dt, chronotype),
          createsFragment: false,
        });
      }
      cursor = addMinutes(cursor, 30);
    }
  }

  const top = selectTopSlots(candidates, policy, 2);
  return top.map((s, i) => ({
    start: s.start,
    end: s.end,
    score: i === 0 ? 1 : 0.8,
    label: i === 0 ? 'Option 1' : 'Option 2',
  }));
}
