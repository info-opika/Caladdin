import { DateTime } from 'luxon';
import { config } from '../../config.js';
import type { InviteCalendarGrantRow } from '../../db/invite_calendar_grants.js';
import type { SlotSource } from '../../db/scheduling_sessions.js';
import type { SlotSource as AgentSlotSource } from '../types.js';

export type GrantStatusView = 'none' | 'active' | 'expired' | 'revoked';

export function sessionTokenFromSchedulingLink(link: string): string | null {
  const m = /\/s\/([^/?#]+)/.exec(link);
  return m?.[1] ?? null;
}

export type SlotPair = { start: string; end?: string };
export type NormalizedSlotPair = { start: string; end: string };

/** Accept bare token or full scheduling / grant URL. */
export function normalizeSessionToken(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const fromPath = sessionTokenFromSchedulingLink(trimmed);
  if (fromPath) return fromPath;
  if (trimmed.includes('://') || trimmed.includes('/s/')) return null;
  return trimmed;
}

/** Validate and normalize ISO slot pairs; derives end from duration when end is omitted. */
export function normalizeSlotPairs(
  slots: SlotPair[],
  opts?: { defaultDurationMinutes?: number },
): { ok: true; slots: NormalizedSlotPair[] } | { ok: false; error: string } {
  const duration = opts?.defaultDurationMinutes ?? 30;
  const out: NormalizedSlotPair[] = [];

  for (const [i, slot] of slots.entries()) {
    const start = DateTime.fromISO(slot.start, { setZone: true });
    if (!start.isValid) {
      return { ok: false, error: `slots[${i}].start is not a valid ISO datetime` };
    }

    const endRaw = slot.end?.trim() ?? '';
    let end = endRaw ? DateTime.fromISO(endRaw, { setZone: true }) : start.plus({ minutes: duration });
    if (!end.isValid) {
      return { ok: false, error: `slots[${i}].end is not a valid ISO datetime` };
    }
    if (end <= start) {
      return { ok: false, error: `slots[${i}].end must be after start` };
    }

    const startIso = start.toISO();
    const endIso = end.toISO();
    if (!startIso || !endIso) {
      return { ok: false, error: `slots[${i}] could not be normalized to ISO` };
    }
    out.push({ start: startIso, end: endIso });
  }

  return { ok: true, slots: out };
}

export function buildOfferedSlotsFromInviteInput(
  input: {
    proposedSlots?: SlotPair[];
    proposedStart?: string;
  },
  durationMinutes: number,
): { ok: true; slots: NormalizedSlotPair[] } | { ok: false; error: string } | { ok: true; slots: undefined } {
  if (input.proposedSlots && input.proposedSlots.length > 0) {
    return normalizeSlotPairs(input.proposedSlots, { defaultDurationMinutes: durationMinutes });
  }
  if (input.proposedStart) {
    return normalizeSlotPairs([{ start: input.proposedStart, end: '' }], {
      defaultDurationMinutes: durationMinutes,
    });
  }
  return { ok: true, slots: undefined };
}

export function buildGrantUrl(sessionToken: string): string {
  const base = config.baseUrl.replace(/\/$/, '');
  return `${base}/s/${sessionToken}/grant/start`;
}

export function buildSchedulingLink(sessionToken: string): string {
  const base = config.baseUrl.replace(/\/$/, '');
  return `${base}/s/${sessionToken}`;
}

export function agentSlotSourceFromSession(
  slotSource: SlotSource | null | undefined,
): AgentSlotSource {
  return slotSource === 'mutual_known_user' ? 'mutual' : 'host-only';
}

export function resolveGrantStatus(grant: InviteCalendarGrantRow | null): GrantStatusView {
  if (!grant) return 'none';
  if (grant.status === 'revoked') return 'revoked';
  if (grant.status === 'expired' || new Date(grant.expires_at) < new Date()) {
    return 'expired';
  }
  if (grant.status === 'active' && grant.oauth_access_token) return 'active';
  return 'none';
}

export function isMutualRecomputeAvailable(
  grant: InviteCalendarGrantRow | null,
  sessionStatus: string,
): boolean {
  if (sessionStatus !== 'pending') return false;
  return resolveGrantStatus(grant) === 'active';
}

export function buildInviteMessageTemplate(opts: {
  slotSource: SlotSource;
  inviteeEmail: string;
  grantUrl?: string;
  conflictWarning?: string;
}): string {
  if (opts.conflictWarning) {
    return opts.conflictWarning;
  }
  if (opts.slotSource === 'mutual_known_user') {
    return `${opts.inviteeEmail} is a Caladdin user with calendar connected — offered times use mutual availability on both calendars.`;
  }
  const grantHint = opts.grantUrl
    ? ` They can share availability via: ${opts.grantUrl}`
    : ' They can share availability from the scheduling link.';
  return (
    `These times are host-only (slot_source: host_only_pending_grant) — ${opts.inviteeEmail} has not shared calendar access yet.` +
    `${grantHint} Mutual matching starts after they complete the freebusy grant.`
  );
}
