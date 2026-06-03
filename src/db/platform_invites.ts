import { getSupabase } from './client.js';
import { config } from '../config.js';

export interface PlatformInvite {
  id: string;
  token: string;
  inviter_user_id: string;
  invitee_email: string;
  status: string;
  sent_at: string;
  accepted_at: string | null;
  expires_at: string;
}

export async function createPlatformInvite(
  inviterUserId: string,
  inviteeEmail: string,
): Promise<PlatformInvite> {
  const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
  const { data, error } = await getSupabase()
    .from('platform_invites')
    .insert({
      inviter_user_id: inviterUserId,
      invitee_email: inviteeEmail.toLowerCase(),
      expires_at: expiresAt,
      status: 'sent',
    })
    .select()
    .single();
  if (error) throw error;
  return data as PlatformInvite;
}

export async function getPlatformInviteByToken(token: string): Promise<PlatformInvite | null> {
  const { data, error } = await getSupabase()
    .from('platform_invites')
    .select('*')
    .eq('token', token)
    .maybeSingle();
  if (error) throw error;
  return data as PlatformInvite | null;
}

export async function markPlatformInviteAccepted(token: string, userId: string): Promise<void> {
  await getSupabase()
    .from('platform_invites')
    .update({ status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('token', token);
  await recordInviteMetric(userId, token);
}

async function recordInviteMetric(_userId: string, _token: string): Promise<void> {
  // usage tracked in auth callback
}

export function platformInviteUrl(token: string): string {
  return `${config.baseUrl.replace(/\/$/, '')}/invite/${token}`;
}
