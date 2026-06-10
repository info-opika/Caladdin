import { DateTime } from 'luxon';
import type { OAuth2Client } from 'google-auth-library';
import {
  type ParsedIntent,
  type UserPolicyProfile,
  type IntentResult,
  type RecurringBlock,
  RecurringBlockSchema,
  ProtectBlockParamsSchema,
  type ProtectBlockParams,
} from '../adts.js';
import { upsertUserPolicy } from '../../db/policies.js';
import { gcalCreateRecurringEvent, gcalListEvents } from '../../services/gcal.js';
import {
  collectOverlapsForProtectBlock,
  enumerateProtectOccurrences,
  formatProtectBlockConflictBullets,
  type ConflictBullet,
} from '../protect-block-conflicts.js';

const MISSING_MSG =
  'I need the title, daily start and end time, weekdays, and an end date for the block before recurring calendar protection.';

/** Map Luxon weekday (Mon=1 … Sun=7) to our BYDAY numbering (Sun=0 … Sat=6). */
function luxonWeekdayToOur(dt: DateTime): number {
  const w = dt.weekday;
  return w === 7 ? 0 : w;
}

function spanHoursBetween(startHHmm: string, endHHmm: string): number {
  const sp = startHHmm.split(':');
  const ep = endHHmm.split(':');
  if (sp.length < 2 || ep.length < 2) return 0;
  const sh = Number(sp[0]);
  const sm = Number(sp[1]);
  const eh = Number(ep[0]);
  const em = Number(ep[1]);
  let a = sh * 60 + sm;
  let b = eh * 60 + em;
  if (b <= a) b += 24 * 60;
  return (b - a) / 60;
}

function countMatchingWeekdaysInclusive(params: ProtectBlockParams, zone: string): number {
  const end = DateTime.fromISO(params.rangeEnd, { zone }).endOf('day');
  let d = params.startDate
    ? DateTime.fromISO(params.startDate, { zone }).startOf('day')
    : DateTime.now().setZone(zone).startOf('day');
  let count = 0;
  while (d <= end) {
    const w = luxonWeekdayToOur(d);
    if (params.daysOfWeek.includes(w)) count += 1;
    d = d.plus({ days: 1 });
  }
  return count;
}

/** Next calendar day matching one of `daysOfWeek` (starting today). */
function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function firstAnchorsForWeekdays(
  daysOfWeek: number[],
  startHHmm: string,
  endHHmm: string,
  zone: string,
  startDate?: string
): { start: DateTime; end: DateTime } {
  const ss = startHHmm.split(':');
  const ee = endHHmm.split(':');
  if (ss.length < 2 || ee.length < 2) throw new Error('could_not_anchor_protect_block');
  const sh = Number(ss[0]);
  const sm = Number(ss[1]);
  const eh = Number(ee[0]);
  const em = Number(ee[1]);
  for (let i = 0; i < 366; i++) {
    const d0 = startDate
      ? DateTime.fromISO(startDate, { zone }).startOf('day')
      : DateTime.now().setZone(zone).startOf('day');
    const d = d0.plus({ days: i });
    if (!daysOfWeek.includes(luxonWeekdayToOur(d))) continue;
    const iso = d.toISODate()!;
    const start = DateTime.fromISO(`${iso}T${pad2(sh)}:${pad2(sm)}:00`, { zone });
    const end = DateTime.fromISO(`${iso}T${pad2(eh)}:${pad2(em)}:00`, { zone });
    if (!start.isValid || !end.isValid) continue;
    if (end <= start) continue;
    return { start, end };
  }
  throw new Error('could_not_anchor_protect_block');
}

function untilRruleFromRangeEnd(rangeEndYmd: string, zone: string): string {
  return DateTime.fromISO(`${rangeEndYmd}T23:59:59`, { zone }).toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");
}

function needsDestructiveRiskConfirmation(params: ProtectBlockParams, zone: string, fromApprovedConfirmation: boolean): boolean {
  if (fromApprovedConfirmation) return false;
  const occurrences = countMatchingWeekdaysInclusive(params, zone);
  const hrs = spanHoursBetween(params.startTime, params.endTime);
  const tierZero = params.tier === 0;
  const bigBlast = occurrences > 5 || hrs > 6;
  const tierPolicy = tierZero || bigBlast;
  return tierPolicy;
}

async function loadOverlapBullets(
  oauthClient: OAuth2Client | null,
  params: ProtectBlockParams,
  zone: string
): Promise<ConflictBullet[]> {
  if (!oauthClient) return [];
  const occurrences = enumerateProtectOccurrences(params, zone);
  if (!occurrences.length) return [];
  const firstStart = occurrences[0]!.start;
  const lastEnd = occurrences[occurrences.length - 1]!.end;
  const timeMin = firstStart.startOf('day').toUTC().toISO()!;
  const timeMax = lastEnd.endOf('day').toUTC().toISO()!;
  const events = await gcalListEvents(oauthClient, timeMin, timeMax);
  return collectOverlapsForProtectBlock(events, occurrences, zone, { limit: 12 });
}

function recurrenceSummary(params: ProtectBlockParams, zone: string): string {
  const occ = enumerateProtectOccurrences(params, zone);
  if (occ.length === 1) {
    return `on ${occ[0]!.start.toFormat('EEE MMM d')}`;
  }
  if (params.daysOfWeek.length === 1) {
    const day = occ[0]?.start.toFormat('cccc') ?? 'that day';
    return `every ${day} through ${params.rangeEnd}`;
  }
  return `on selected weekdays through ${params.rangeEnd}`;
}

function appendConflictFollowUpFromBullets(existing: string, bullets: ConflictBullet[]): string {
  if (bullets.length === 0) return existing;
  const bx = formatProtectBlockConflictBullets(bullets).trimEnd();
  return `${existing.trimEnd()}\n\nHeads-up: overlapping calendar events in that protected window:\n${bx}\n\nSorry — I can't move, cancel, delete, hide, or repair conflicting events yet in this version.\n\nDo you want me to recommend this to the Caladdin tech team as a future feature?`;
}

export async function protectBlock(
  intent: ParsedIntent,
  profile: UserPolicyProfile,
  oauthClient: OAuth2Client | null = null,
  fromApprovedConfirmation = false
): Promise<IntentResult> {
  const parsedParams = ProtectBlockParamsSchema.safeParse(intent.params);

  if (!parsedParams.success) {
    return {
      success: false,
      intent: 'PROTECT_BLOCK',
      atomicOp: 'add_recurring_block',
      eventsAffected: [],
      requiresConfirmation: false,
      failureReason: MISSING_MSG,
    };
  }

  const params = parsedParams.data;
  const zone = params.timezone?.trim() || profile.timezone;

  try {
    const overlapBullets = await loadOverlapBullets(oauthClient, params, zone);

    if (needsDestructiveRiskConfirmation(params, zone, fromApprovedConfirmation)) {
      const occ = countMatchingWeekdaysInclusive(params, zone);
      const hrs = spanHoursBetween(params.startTime, params.endTime);
      const parts: string[] = [];
      if (occ > 5) parts.push(`${occ} occurrences`);
      if (hrs > 6) parts.push(`long blocks (${hrs.toFixed(1)}h each)`);
      if (params.tier === 0) parts.push('Tier 0 (immovable) block');
      let why = parts.length ? `${parts.join('; ')} — approve to apply.` : 'Large change — approve to apply.';
      why = appendConflictFollowUpFromBullets(why, overlapBullets);
      return {
        success: false,
        intent: 'PROTECT_BLOCK',
        atomicOp: 'add_recurring_block',
        eventsAffected: [],
        requiresConfirmation: true,
        failureReason: why,
      };
    }

    const block: RecurringBlock = RecurringBlockSchema.parse({
      label: params.label,
      startTime: params.startTime,
      endTime: params.endTime,
      daysOfWeek: params.daysOfWeek,
      tier: params.tier,
      rangeEnd: params.rangeEnd,
    });
    const updatedProfile = { ...profile, protectedBlocks: [...profile.protectedBlocks, block] };

    if (!profile.userId) {
      return {
        success: false,
        intent: 'PROTECT_BLOCK',
        atomicOp: 'add_recurring_block',
        eventsAffected: [],
        requiresConfirmation: false,
        failureReason: 'User policy missing user id.',
      };
    }
    await upsertUserPolicy(profile.userId, updatedProfile);

    const untilRfc = untilRruleFromRangeEnd(params.rangeEnd, zone);

    let syncNote = '';
    if (oauthClient) {
      try {
        const anchors = firstAnchorsForWeekdays(
          block.daysOfWeek,
          block.startTime,
          block.endTime,
          zone,
          params.startDate
        );
        await gcalCreateRecurringEvent(oauthClient, {
          title: params.label,
          startDateTimeIso: anchors.start.toISO()!,
          endDateTimeIso: anchors.end.toISO()!,
          daysOfWeek: [...new Set(block.daysOfWeek)].sort((a, b) => a - b),
          timezone: zone,
          untilUtcRfc: untilRfc,
        });
      } catch (syncErr: unknown) {
        syncNote = ` Policy saved locally; calendar sync deferred (${syncErr instanceof Error ? syncErr.message : 'unknown error'}).`;
      }
    }

    const recur = recurrenceSummary(params, zone);
    let baseMsg = `Done — I blocked "${params.label}" ${recur} (${params.startTime}–${params.endTime}).`;
    baseMsg += syncNote;
    baseMsg = appendConflictFollowUpFromBullets(baseMsg, overlapBullets);
    return {
      success: true,
      intent: 'PROTECT_BLOCK',
      atomicOp: 'add_recurring_block',
      eventsAffected: [],
      requiresConfirmation: false,
      messageToUser: baseMsg,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    return {
      success: false,
      intent: 'PROTECT_BLOCK',
      atomicOp: 'add_recurring_block',
      eventsAffected: [],
      requiresConfirmation: false,
      failureReason: `Protect block validation failed (${msg}).`,
    };
  }
}
