import { getSupabase } from './client.js';
import { config } from '../config.js';
import type { CandidateSlot } from '../core/adts.js';

export const GCAL_CLAIMING_SENTINEL = '__CALADDIN_GCAL_CLAIMING__';

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
  invitee_email?: string | null;
  host_timezone?: string | null;
  duration_minutes?: number | null;
  offered_slots?: CandidateSlot[] | null;
  selected_slot?: CandidateSlot | null;
  google_event_id?: string | null;
  proposed_alternatives?: unknown[];
}

export interface SchedulingSessionRow {
  id: string;
  token: string;
  host_user_id: string;
  host_name: string | null;
  host_timezone: string;
  invitee_email: string | null;
  invitee_label: string | null;
  duration_minutes: number;
  offered_slots: CandidateSlot[];
  selected_slot: CandidateSlot | null;
  google_event_id: string | null;
  proposed_alternatives: unknown[];
  status: 'pending' | 'confirmed' | 'open' | 'booked' | 'expired';
  expires_at: string;
  created_at: string;
  updated_at: string;
  slots?: unknown;
  context?: string | null;
  posture?: string;
  proposed_event_ids?: string[];
}

function rowFromDb(data: Record<string, unknown>): SchedulingSessionRow {
  const offered = (data.offered_slots ?? data.slots) as CandidateSlot[] | undefined;
  return {
    id: data.id as string,
    token: data.token as string,
    host_user_id: data.host_user_id as string,
    host_name: (data.host_name as string) ?? null,
    host_timezone: (data.host_timezone as string) ?? 'America/Chicago',
    invitee_email: (data.invitee_email as string) ?? null,
    invitee_label: (data.invitee_label as string) ?? null,
    duration_minutes: (data.duration_minutes as number) ?? 30,
    offered_slots: offered ?? [],
    selected_slot: (data.selected_slot as CandidateSlot) ?? null,
    google_event_id: (data.google_event_id as string) ?? null,
    proposed_alternatives: (data.proposed_alternatives as unknown[]) ?? [],
    status: normalizeStatus(data.status as string),
    expires_at: data.expires_at as string,
    created_at: (data.created_at as string) ?? new Date().toISOString(),
    updated_at: (data.updated_at as string) ?? new Date().toISOString(),
  };
}

function normalizeStatus(s: string): SchedulingSessionRow['status'] {
  if (s === 'open') return 'pending';
  if (s === 'booked') return 'confirmed';
  return s as SchedulingSessionRow['status'];
}

export async function createSchedulingSession(entry: {
  hostUserId: string;
  slots: Array<{ start: string; end: string; score?: number }>;
  hostName?: string;
  context?: string;
  proposedEventIds?: string[];
  inviteeEmail?: string;
  hostTimezone?: string;
  durationMinutes?: number;
  offeredSlots?: CandidateSlot[];
}): Promise<SchedulingSession> {
  const expiresAt = new Date(Date.now() + config.schedulingSessionHours * 3600 * 1000).toISOString();
  const offered = entry.offeredSlots ?? entry.slots.map((s) => ({
    start: s.start,
    end: s.end,
    adjacentEventCount: 0,
    energyScore: s.score ?? 0.5,
    createsFragment: false,
  }));

  const { data, error } = await getSupabase()
    .from('scheduling_sessions')
    .insert({
      host_user_id: entry.hostUserId,
      slots: entry.slots,
      offered_slots: offered,
      host_name: entry.hostName,
      context: entry.context,
      proposed_event_ids: entry.proposedEventIds ?? [],
      invitee_email: entry.inviteeEmail,
      host_timezone: entry.hostTimezone ?? 'America/Chicago',
      duration_minutes: entry.durationMinutes ?? 30,
      expires_at: expiresAt,
      status: 'pending',
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

export async function getSchedulingSessionByToken(token: string): Promise<SchedulingSessionRow | null> {
  const { data, error } = await getSupabase()
    .from('scheduling_sessions')
    .select('*')
    .eq('token', token)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return rowFromDb(data as Record<string, unknown>);
}

export async function claimSessionSlotForGcal(opts: {
  token: string;
  slotIndex: 0 | 1;
}): Promise<boolean> {
  const session = await getSchedulingSessionByToken(opts.token);
  if (!session || session.status !== 'pending' || session.google_event_id != null) {
    return false;
  }
  const sel = session.offered_slots[opts.slotIndex];
  if (!sel) return false;

  const { error } = await getSupabase()
    .from('scheduling_sessions')
    .update({
      selected_slot: sel,
      google_event_id: GCAL_CLAIMING_SENTINEL,
      status: 'pending',
    })
    .eq('token', opts.token)
    .eq('status', 'pending')
    .is('google_event_id', null);

  return !error;
}

export async function finalizeSessionAfterGcal(opts: {
  token: string;
  googleEventId: string;
}): Promise<boolean> {
  const { data, error } = await getSupabase()
    .from('scheduling_sessions')
    .update({
      google_event_id: opts.googleEventId,
      status: 'confirmed',
    })
    .eq('token', opts.token)
    .eq('google_event_id', GCAL_CLAIMING_SENTINEL)
    .select()
    .maybeSingle();

  return !error && Boolean(data);
}

export async function revertSessionClaim(token: string): Promise<void> {
  await getSupabase()
    .from('scheduling_sessions')
    .update({
      google_event_id: null,
      selected_slot: null,
      status: 'pending',
    })
    .eq('token', token)
    .eq('google_event_id', GCAL_CLAIMING_SENTINEL);
}

export async function appendProposedAlternative(
  token: string,
  alt: { proposedDate: string; proposedTimeWindow: string; note?: string },
): Promise<void> {
  const session = await getSchedulingSessionByToken(token);
  if (!session || session.status !== 'pending') {
    throw new Error('session_not_open');
  }
  const alts = [...(session.proposed_alternatives ?? []), alt];
  const { error } = await getSupabase()
    .from('scheduling_sessions')
    .update({ proposed_alternatives: alts })
    .eq('token', token);
  if (error) throw error;
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
    .in('status', ['open', 'pending'])
    .lt('expires_at', new Date().toISOString());
  if (error) throw error;
}
