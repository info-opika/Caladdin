import { DateTime } from 'luxon';
import type { calendar_v3 } from 'googleapis';
import { lookupInviteeAvailability } from './invitee_lookup.js';
import { getAuthService, getOAuthClientForUser } from './auth_service.js';
import { listBusyFromGCal } from './calendar_api.js';
import { checkSpecificSlot } from './mutual_slot_engine.js';
import { getInviteeCalendarClient } from './invitee_oauth.js';
import type { InviteCalendarGrantRow } from '../db/invite_calendar_grants.js';
import type { SchedulingSessionRow } from '../db/scheduling_sessions.js';

export type SlotWithConflicts = {
  start: string;
  end: string;
  inviteeConflict: boolean;
  hostConflict: boolean;
};

function slotBounds(slots: Array<{ start: string; end: string }>): { start: string; end: string } | null {
  if (slots.length === 0) return null;
  let minStart = slots[0]!.start;
  let maxEnd = slots[0]!.end;
  for (const slot of slots) {
    if (slot.start < minStart) minStart = slot.start;
    if (slot.end > maxEnd) maxEnd = slot.end;
  }
  return { start: minStart, end: maxEnd };
}

export function markSlotsWithBusyConflicts(
  slots: Array<{ start: string; end: string }>,
  hostBusy: Array<{ start: string; end: string }>,
  inviteeBusy: Array<{ start: string; end: string }> | undefined,
  timezone: string,
): SlotWithConflicts[] {
  return slots.map((slot) => {
    const result = checkSpecificSlot({
      candidateStart: slot.start,
      candidateEnd: slot.end,
      hostBusy,
      inviteeBusy,
      timezone,
    });
    return {
      ...slot,
      inviteeConflict: result.conflicts.some((c) => c.party === 'invitee'),
      hostConflict: result.conflicts.some((c) => c.party === 'host'),
    };
  });
}

export async function checkInviteeConflictsForSlots(
  email: string,
  slots: Array<{ start: string; end: string }>,
  opts?: {
    hostCal?: calendar_v3.Calendar | null;
    timezone?: string;
  },
): Promise<SlotWithConflicts[]> {
  if (slots.length === 0) return [];

  const tz = opts?.timezone ?? 'America/Chicago';
  const bounds = slotBounds(slots);
  if (!bounds) return [];

  const invitee = await lookupInviteeAvailability(email);
  if (!invitee.isCaladdinUser || !invitee.hasCalendarConnected || !invitee.userId) {
    return slots.map((slot) => ({
      ...slot,
      inviteeConflict: false,
      hostConflict: false,
    }));
  }

  let hostBusy: Array<{ start: string; end: string }> = [];
  if (opts?.hostCal) {
    hostBusy = await listBusyFromGCal(opts.hostCal, bounds.start, bounds.end);
  }

  const inviteeCal = await getOAuthClientForUser(invitee.userId);
  if (!inviteeCal) {
    return slots.map((slot) => ({
      ...slot,
      inviteeConflict: false,
      hostConflict: false,
    }));
  }

  const inviteeBusy = await listBusyFromGCal(inviteeCal, bounds.start, bounds.end);
  return markSlotsWithBusyConflicts(slots, hostBusy, inviteeBusy, tz);
}

export async function markGrantInviteeConflicts(
  session: SchedulingSessionRow,
  grant: InviteCalendarGrantRow,
  slots: Array<{ start: string; end: string }>,
): Promise<Array<{ inviteeConflict: boolean }>> {
  if (slots.length === 0) return [];

  const tz = session.host_timezone ?? 'America/Chicago';
  const bounds = slotBounds(slots);
  if (!bounds) return slots.map(() => ({ inviteeConflict: false }));

  const hostAuth = getAuthService();
  const hostCal = await hostAuth.getClientForUser(session.host_user_id);
  const inviteeCal = await getInviteeCalendarClient(grant);

  if (!hostCal || !inviteeCal) {
    return slots.map(() => ({ inviteeConflict: false }));
  }

  const [hostBusy, inviteeBusy] = await Promise.all([
    listBusyFromGCal(hostCal, bounds.start, bounds.end),
    listBusyFromGCal(inviteeCal, bounds.start, bounds.end),
  ]);

  return markSlotsWithBusyConflicts(slots, hostBusy, inviteeBusy, tz).map((slot) => ({
    inviteeConflict: slot.inviteeConflict,
  }));
}

export function formatSlotTimeShort(start: string, timezone: string): string {
  const dt = DateTime.fromISO(start, { zone: timezone });
  if (!dt.isValid) return start;
  return dt.toFormat('ccc h:mm a');
}

export function buildInviteeConflictWarnings(
  email: string,
  conflicts: SlotWithConflicts[],
  timezone: string,
): string {
  const conflicting = conflicts.filter((slot) => slot.inviteeConflict);
  if (conflicting.length === 0) return '';

  const parts = conflicting.map((slot) => formatSlotTimeShort(slot.start, timezone));
  const slotList = parts.join(', ');
  const verb = conflicting.length > 1 ? 'conflict' : 'conflicts';
  return `${email} is on Caladdin — ${slotList} ${verb} with their calendar.`;
}
