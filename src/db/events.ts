import { getSupabase } from './client.js';
import { CalendarEvent } from '../core/adts.js';

function rowToEvent(row: Record<string, unknown>): CalendarEvent {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    title: row.title as string,
    start: row.start_at as string,
    end: row.end_at as string,
    participants: (row.participants as string[]) ?? [],
    tier: row.tier as number,
    isRecurring: row.is_recurring as boolean,
    status: row.status as 'confirmed' | 'cancelled' | 'proposed',
    gcalEventId: row.gcal_event_id as string | null,
    proposedForSession: row.proposed_for_session as string | null,
    description: (row.description as string | null) ?? null,
  };
}

export async function listEvents(userId: string, start?: string, end?: string): Promise<CalendarEvent[]> {
  let q = getSupabase().from('events').select('*').eq('user_id', userId).neq('status', 'cancelled');
  if (start) q = q.gte('start_at', start);
  if (end) q = q.lte('end_at', end);
  const { data, error } = await q.order('start_at');
  if (error) throw error;
  return (data ?? []).map(rowToEvent);
}

export async function getEventById(id: string): Promise<CalendarEvent | null> {
  const { data, error } = await getSupabase().from('events').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? rowToEvent(data) : null;
}

export async function insertEvent(userId: string, event: Partial<CalendarEvent>): Promise<CalendarEvent> {
  const { data, error } = await getSupabase()
    .from('events')
    .insert({
      user_id: userId,
      title: event.title,
      start_at: event.start,
      end_at: event.end,
      tier: event.tier ?? 2,
      status: event.status ?? 'confirmed',
      participants: event.participants ?? [],
      is_recurring: event.isRecurring ?? false,
      gcal_event_id: event.gcalEventId,
      proposed_for_session: event.proposedForSession,
      description: event.description ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return rowToEvent(data);
}

export async function updateEvent(id: string, patch: Partial<CalendarEvent>): Promise<CalendarEvent> {
  const row: Record<string, unknown> = {};
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.start !== undefined) row.start_at = patch.start;
  if (patch.end !== undefined) row.end_at = patch.end;
  if (patch.tier !== undefined) row.tier = patch.tier;
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.gcalEventId !== undefined) row.gcal_event_id = patch.gcalEventId;
  if (patch.participants !== undefined) row.participants = patch.participants;
  if (patch.description !== undefined) row.description = patch.description;
  const { data, error } = await getSupabase().from('events').update(row).eq('id', id).select().single();
  if (error) throw error;
  return rowToEvent(data);
}

export async function getEventByGcalId(userId: string, gcalEventId: string): Promise<CalendarEvent | null> {
  const { data, error } = await getSupabase()
    .from('events')
    .select('*')
    .eq('user_id', userId)
    .eq('gcal_event_id', gcalEventId)
    .neq('status', 'cancelled')
    .maybeSingle();
  if (error) throw error;
  return data ? rowToEvent(data) : null;
}

export async function cancelEvent(id: string): Promise<void> {
  const { error } = await getSupabase().from('events').update({ status: 'cancelled' }).eq('id', id);
  if (error) throw error;
}

export async function countEventsInRange(userId: string, start: string, end: string): Promise<number> {
  const { count, error } = await getSupabase()
    .from('events')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .neq('status', 'cancelled')
    .gte('start_at', start)
    .lte('end_at', end);
  if (error) throw error;
  return count ?? 0;
}
