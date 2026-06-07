import { getSupabase, setUserContext } from './client.js';

export type SchedulingMode = 'single' | 'round_robin';

export interface EventTypeMember {
  id: string;
  eventTypeId: string;
  userId: string;
  position: number;
  createdAt: string;
}

interface MemberRow {
  id: string;
  event_type_id: string;
  user_id: string;
  position: number;
  created_at: string;
}

function rowToMember(row: MemberRow): EventTypeMember {
  return {
    id: row.id,
    eventTypeId: row.event_type_id,
    userId: row.user_id,
    position: row.position,
    createdAt: row.created_at,
  };
}

export async function listEventTypeMembers(userId: string, eventTypeId: string): Promise<EventTypeMember[]> {
  const db = await setUserContext(userId);
  const { data, error } = await db
    .from('event_type_members')
    .select('*')
    .eq('event_type_id', eventTypeId)
    .order('position', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => rowToMember(row as MemberRow));
}

export async function setEventTypeMembers(
  userId: string,
  eventTypeId: string,
  memberUserIds: string[],
): Promise<EventTypeMember[]> {
  const db = await setUserContext(userId);

  const { error: deleteError } = await db.from('event_type_members').delete().eq('event_type_id', eventTypeId);
  if (deleteError) throw deleteError;

  if (memberUserIds.length === 0) return [];

  const rows = memberUserIds.map((memberId, index) => ({
    event_type_id: eventTypeId,
    user_id: memberId,
    position: index,
  }));

  const { data, error } = await db.from('event_type_members').insert(rows).select();
  if (error) throw error;
  return (data ?? []).map((row) => rowToMember(row as MemberRow));
}

/** Service role — resolve round-robin host for public booking. */
export async function pickRoundRobinHost(eventTypeId: string, ownerUserId: string): Promise<string> {
  const { data: members, error: membersError } = await getSupabase()
    .from('event_type_members')
    .select('user_id, position')
    .eq('event_type_id', eventTypeId)
    .order('position', { ascending: true });
  if (membersError) throw membersError;

  const pool = (members ?? []).map((m) => m.user_id as string);
  if (pool.length === 0) return ownerUserId;

  const { data: eventType, error: etError } = await getSupabase()
    .from('event_types')
    .select('round_robin_index')
    .eq('id', eventTypeId)
    .single();
  if (etError) throw etError;

  const index = (eventType.round_robin_index as number) ?? 0;
  const hostId = pool[index % pool.length]!;
  const nextIndex = (index + 1) % pool.length;

  await getSupabase()
    .from('event_types')
    .update({ round_robin_index: nextIndex, updated_at: new Date().toISOString() })
    .eq('id', eventTypeId);

  return hostId;
}

/** Service role — members for public metadata. */
export async function listMembersForEventType(eventTypeId: string): Promise<string[]> {
  const { data, error } = await getSupabase()
    .from('event_type_members')
    .select('user_id')
    .eq('event_type_id', eventTypeId)
    .order('position', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => row.user_id as string);
}
