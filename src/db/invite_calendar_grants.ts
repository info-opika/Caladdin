import { getSupabase } from './client.js';

export type InviteGrantStatus = 'active' | 'expired' | 'revoked';

export interface InviteCalendarGrantRow {
  id: string;
  scheduling_session_id: string;
  invitee_email: string | null;
  oauth_access_token: string | null;
  oauth_refresh_token: string | null;
  oauth_expiry: string | null;
  preferred_window_start: string | null;
  preferred_window_end: string | null;
  status: InviteGrantStatus;
  expires_at: string;
  created_at: string;
}

const GRANT_TTL_HOURS = 48;

export function defaultGrantExpiresAt(): string {
  return new Date(Date.now() + GRANT_TTL_HOURS * 60 * 60 * 1000).toISOString();
}

export async function getGrantBySessionId(
  schedulingSessionId: string,
): Promise<InviteCalendarGrantRow | null> {
  const { data, error } = await getSupabase()
    .from('invite_calendar_grants')
    .select('*')
    .eq('scheduling_session_id', schedulingSessionId)
    .maybeSingle();
  if (error) throw error;
  return data as InviteCalendarGrantRow | null;
}

export async function getGrantBySessionToken(
  sessionToken: string,
): Promise<InviteCalendarGrantRow | null> {
  const { data: session, error: sessionError } = await getSupabase()
    .from('scheduling_sessions')
    .select('id')
    .eq('token', sessionToken)
    .maybeSingle();
  if (sessionError) throw sessionError;
  if (!session) return null;
  return getGrantBySessionId(session.id as string);
}

export async function upsertInviteGrant(entry: {
  schedulingSessionId: string;
  inviteeEmail?: string;
  oauthAccessToken?: string;
  oauthRefreshToken?: string | null;
  oauthExpiry?: Date | null;
  expiresAt?: string;
}): Promise<InviteCalendarGrantRow> {
  const { data, error } = await getSupabase()
    .from('invite_calendar_grants')
    .upsert(
      {
        scheduling_session_id: entry.schedulingSessionId,
        invitee_email: entry.inviteeEmail ?? null,
        oauth_access_token: entry.oauthAccessToken ?? null,
        oauth_refresh_token: entry.oauthRefreshToken ?? null,
        oauth_expiry: entry.oauthExpiry?.toISOString() ?? null,
        expires_at: entry.expiresAt ?? defaultGrantExpiresAt(),
        status: 'active',
      },
      { onConflict: 'scheduling_session_id' },
    )
    .select('*')
    .single();
  if (error) throw error;
  return data as InviteCalendarGrantRow;
}

export async function updateGrantPreferredWindow(
  grantId: string,
  window: { start: string; end: string },
): Promise<void> {
  const { error } = await getSupabase()
    .from('invite_calendar_grants')
    .update({
      preferred_window_start: window.start,
      preferred_window_end: window.end,
    })
    .eq('id', grantId);
  if (error) throw error;
}

export async function revokeGrant(
  grantId: string,
  status: 'expired' | 'revoked' = 'revoked',
): Promise<void> {
  const { error } = await getSupabase()
    .from('invite_calendar_grants')
    .update({ status })
    .eq('id', grantId);
  if (error) throw error;
}

export async function revokeGrantForSession(schedulingSessionId: string): Promise<void> {
  const { error } = await getSupabase()
    .from('invite_calendar_grants')
    .update({ status: 'revoked' })
    .eq('scheduling_session_id', schedulingSessionId)
    .eq('status', 'active');
  if (error) throw error;
}

/** Expire grants past TTL or whose parent session is no longer open. */
export async function expireStaleInviteGrants(): Promise<number> {
  const now = new Date().toISOString();

  const { data: ttlExpired, error: ttlError } = await getSupabase()
    .from('invite_calendar_grants')
    .update({ status: 'expired' })
    .eq('status', 'active')
    .lt('expires_at', now)
    .select('id');
  if (ttlError) throw ttlError;

  const { data: resolvedSessions, error: sessionError } = await getSupabase()
    .from('scheduling_sessions')
    .select('id')
    .neq('status', 'open')
    .neq('status', 'pending');
  if (sessionError) throw sessionError;

  let resolvedCount = 0;
  if (resolvedSessions?.length) {
    const ids = resolvedSessions.map((s) => s.id as string);
    const { data: revoked, error: revokeError } = await getSupabase()
      .from('invite_calendar_grants')
      .update({ status: 'revoked' })
      .eq('status', 'active')
      .in('scheduling_session_id', ids)
      .select('id');
    if (revokeError) throw revokeError;
    resolvedCount = revoked?.length ?? 0;
  }

  return (ttlExpired?.length ?? 0) + resolvedCount;
}
