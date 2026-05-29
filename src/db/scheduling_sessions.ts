import { getSupabase } from './client.js';
import { config } from '../config.js';

export interface SchedulingSession {
  id: string;
  token: string;
  host_user_id: string;
  slots: Array<{ start: string; end: string; score?: number }>;
  host_name: string | null;
  context: string | null;
  posture: string;
  status: string;
  proposed_event_ids: string[];
  expires_at: string;
}

export async function createSchedulingSession(entry: {
  hostUserId: string;
  slots: Array<{ start: string; end: string; score?: number }>;
  hostName?: string;
  context?: string;
  proposedEventIds?: string[];
}): Promise<SchedulingSession> {
  const expiresAt = new Date(Date.now() + config.schedulingSessionHours * 3600 * 1000).toISOString();
  const { data, error } = await getSupabase()
    .from('scheduling_sessions')
    .insert({
      host_user_id: entry.hostUserId,
      slots: entry.slots,
      host_name: entry.hostName,
      context: entry.context,
      proposed_event_ids: entry.proposedEventIds ?? [],
      expires_at: expiresAt,
      status: 'open',
    })
    .select()
    .single();
  if (error) throw error;
  return data as SchedulingSession;
}

export async function getSessionByToken(token: string): Promise<SchedulingSession | null> {
  const { data, error } = await getSupabase()
    .from('scheduling_sessions')
    .select('*')
    .eq('token', token)
    .maybeSingle();
  if (error) throw error;
  return data as SchedulingSession | null;
}

export async function updateSessionStatus(token: string, status: string): Promise<void> {
  const { error } = await getSupabase().from('scheduling_sessions').update({ status }).eq('token', token);
  if (error) throw error;
}

export async function listSessionsForHost(hostUserId: string): Promise<SchedulingSession[]> {
  const { data, error } = await getSupabase()
    .from('scheduling_sessions')
    .select('*')
    .eq('host_user_id', hostUserId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as SchedulingSession[];
}

export async function expireOpenSessions(): Promise<void> {
  const { error } = await getSupabase()
    .from('scheduling_sessions')
    .update({ status: 'expired' })
    .eq('status', 'open')
    .lt('expires_at', new Date().toISOString());
  if (error) throw error;
}
