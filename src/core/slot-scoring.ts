import { addDays, addMinutes, formatISO, startOfDay, setHours, setMinutes } from './date-utils.js';
import { UserPolicyProfile, CandidateSlot } from './adts.js';
import { listEvents } from '../db/events.js';
import { selectTopSlots, computeEnergyScore } from './intents/offer-specific.js';
import {
  applyAvailabilityToPolicy,
  expandBusyWithBuffers,
  isAfterMinimumNotice,
  parseAvailabilityRules,
  windowsForDay,
} from './availability.js';
import { DateTime } from 'luxon';
import type { calendar_v3 } from 'googleapis';
import { getCachedBusyFromGCal } from '../services/freebusy-cache.js';
import { getUserByEmail } from '../db/users.js';
import { getOAuthClientForUser } from '../services/auth_service.js';

export interface ScoredSlot {
  start: string;
  end: string;
  score: number;
  label?: string;
}

export interface PublicBookingSlot {
  start: string;
  end: string;
}

type BusyBlock = { start: string; end: string; tier: number; title: string };

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

async function fetchRecipientBusy(
  recipientEmail: string,
  timeMin: string,
  timeMax: string,
): Promise<BusyBlock[]> {
  const recipient = await getUserByEmail(recipientEmail);
  if (!recipient) return [];

  const recipientCal = await getOAuthClientForUser(recipient.id);
  if (!recipientCal) return [];

  const rb = await getCachedBusyFromGCal(recipientCal, recipient.id, timeMin, timeMax);
  return rb.map((b) => ({ start: b.start, end: b.end, tier: 2, title: 'Guest busy' }));
}

export type SchedulingPosture = 'strict' | 'mutual' | 'flexible';

function shouldIncludeRecipientBusy(
  posture: SchedulingPosture | undefined,
  recipientEmail?: string,
): boolean {
  if (!recipientEmail) return false;
  if (posture === 'flexible') return false;
  return true;
}

async function collectBusyBlocks(
  userId: string,
  timeMin: string,
  timeMax: string,
  options?: {
    cal?: calendar_v3.Calendar | null;
    recipientEmail?: string;
    availabilityRules?: Record<string, unknown>;
    policy: UserPolicyProfile;
    posture?: SchedulingPosture;
  },
): Promise<BusyBlock[]> {
  const availability = parseAvailabilityRules(options?.availabilityRules, options?.policy);
  const includeRecipient = shouldIncludeRecipientBusy(options?.posture, options?.recipientEmail);

  const [events, hostGcalBusy, recipientBusy] = await Promise.all([
    listEvents(userId, timeMin, timeMax),
    options?.cal
      ? getCachedBusyFromGCal(options.cal, userId, timeMin, timeMax).then((b) =>
          b.map((slot) => ({ start: slot.start, end: slot.end, tier: 2, title: 'Busy' })),
        )
      : Promise.resolve([] as BusyBlock[]),
    includeRecipient
      ? fetchRecipientBusy(options!.recipientEmail!, timeMin, timeMax)
      : Promise.resolve([] as BusyBlock[]),
  ]);

  let busy = events
    .filter((e) => e.status !== 'cancelled')
    .map((e) => ({ start: e.start, end: e.end, tier: e.tier, title: e.title }));
  busy = [...busy, ...hostGcalBusy, ...recipientBusy];
  return expandBusyWithBuffers(busy, availability.bufferBeforeMinutes, availability.bufferAfterMinutes);
}

function buildCandidateSlots(
  now: Date,
  daysAhead: number,
  durationMinutes: number,
  busy: BusyBlock[],
  effectivePolicy: UserPolicyProfile,
  availability: ReturnType<typeof parseAvailabilityRules>,
): CandidateSlot[] {
  const candidates: CandidateSlot[] = [];
  const tz = effectivePolicy.timezone ?? 'America/Chicago';
  const chronotype = effectivePolicy.chronotype ?? 'morning';

  for (let d = 0; d < daysAhead; d++) {
    const day = addDays(startOfDay(now), d);
    const dayWindows = windowsForDay(day, availability);
    if (dayWindows.length === 0) continue;

    for (const window of dayWindows) {
      let cursor = setMinutes(setHours(day, window.startH), window.startM);
      const dayEnd = setMinutes(setHours(day, window.endH), window.endM);

      while (cursor < dayEnd) {
        const slotEnd = addMinutes(cursor, durationMinutes);
        if (slotEnd > dayEnd) break;

        if (!isAfterMinimumNotice(cursor, now, availability.minimumNoticeMinutes)) {
          cursor = addMinutes(cursor, 30);
          continue;
        }

        const overlapsBusy = busy.some((b) => {
          const bs = new Date(b.start);
          const be = new Date(b.end);
          return cursor < be && slotEnd > bs;
        });

        const overlapsProtected = effectivePolicy.protectedBlocks.some((block) =>
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
              const gap = Math.min(
                Math.abs(cursor.getTime() - be.getTime()),
                Math.abs(bs.getTime() - slotEnd.getTime()),
              );
              return gap <= 30 * 60 * 1000;
            }).length,
            energyScore: computeEnergyScore(dt, chronotype),
            createsFragment: false,
          });
        }
        cursor = addMinutes(cursor, 30);
      }
    }
  }

  return candidates;
}

export async function generateSlots(
  userId: string,
  policy: UserPolicyProfile,
  durationMinutes: number,
  daysAhead = 7,
  options?: {
    recipientEmail?: string;
    cal?: calendar_v3.Calendar | null;
    availabilityRules?: Record<string, unknown>;
    maxSlots?: number;
    posture?: SchedulingPosture;
  },
): Promise<ScoredSlot[]> {
  const posture = options?.posture ?? 'mutual';
  if (posture === 'strict' && !options?.recipientEmail) {
    return [];
  }

  const effectivePolicy = options?.availabilityRules
    ? applyAvailabilityToPolicy(policy, options.availabilityRules)
    : policy;
  const availability = parseAvailabilityRules(options?.availabilityRules, effectivePolicy);

  const now = new Date();
  const rangeEnd = addDays(now, daysAhead);
  const timeMin = now.toISOString();
  const timeMax = rangeEnd.toISOString();

  const busy = await collectBusyBlocks(userId, timeMin, timeMax, {
    cal: options?.cal,
    recipientEmail: options?.recipientEmail,
    availabilityRules: options?.availabilityRules,
    policy: effectivePolicy,
    posture,
  });

  const candidates = buildCandidateSlots(now, daysAhead, durationMinutes, busy, effectivePolicy, availability);
  const maxSlots = options?.maxSlots ?? 2;
  const top = selectTopSlots(candidates, effectivePolicy, maxSlots);
  return top.map((s, i) => ({
    start: s.start,
    end: s.end,
    score: i === 0 ? 1 : 0.8,
    label: i === 0 ? 'Option 1' : 'Option 2',
  }));
}

/** All bookable slots for public event-type pages (calendar + time grid). */
export async function generatePublicBookingSlots(
  userId: string,
  policy: UserPolicyProfile,
  durationMinutes: number,
  daysAhead = 30,
  options?: {
    cal?: calendar_v3.Calendar | null;
    maxSlots?: number;
    availabilityRules?: Record<string, unknown>;
  },
): Promise<PublicBookingSlot[]> {
  const maxSlots = options?.maxSlots ?? 300;
  const effectivePolicy = options?.availabilityRules
    ? applyAvailabilityToPolicy(policy, options.availabilityRules)
    : policy;
  const availability = parseAvailabilityRules(options?.availabilityRules, effectivePolicy);

  const now = new Date();
  const rangeEnd = addDays(now, daysAhead);
  const timeMin = now.toISOString();
  const timeMax = rangeEnd.toISOString();

  const busy = await collectBusyBlocks(userId, timeMin, timeMax, {
    cal: options?.cal,
    availabilityRules: options?.availabilityRules,
    policy: effectivePolicy,
  });

  const candidates = buildCandidateSlots(now, daysAhead, durationMinutes, busy, effectivePolicy, availability);
  return candidates.slice(0, maxSlots).map((s) => ({ start: s.start, end: s.end }));
}
