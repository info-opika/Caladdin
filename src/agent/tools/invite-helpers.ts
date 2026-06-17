import { config } from '../../config.js';
import type { InviteCalendarGrantRow } from '../../db/invite_calendar_grants.js';
import type { SlotSource } from '../../db/scheduling_sessions.js';
import type { SlotSource as AgentSlotSource } from '../types.js';

export type GrantStatusView = 'none' | 'active' | 'expired' | 'revoked';

export function sessionTokenFromSchedulingLink(link: string): string | null {
  const m = /\/s\/([^/?#]+)/.exec(link);
  return m?.[1] ?? null;
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
}): string {
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
