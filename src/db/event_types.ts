import { getSupabase, setUserContext } from './client.js';

export interface EventTypeRow {
  id: string;
  user_id: string;
  slug: string;
  name: string;
  duration_minutes: number;
  description: string | null;
  availability_rules: Record<string, unknown>;
  scheduling_mode: string;
  round_robin_index: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface EventType {
  id: string;
  userId: string;
  slug: string;
  name: string;
  durationMinutes: number;
  description: string | null;
  availabilityRules: Record<string, unknown>;
  schedulingMode: 'single' | 'round_robin';
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

function rowToEventType(row: EventTypeRow): EventType {
  const mode = (row as { scheduling_mode?: string }).scheduling_mode === 'round_robin' ? 'round_robin' : 'single';
  return {
    id: row.id,
    userId: row.user_id,
    slug: row.slug,
    name: row.name,
    durationMinutes: row.duration_minutes,
    description: row.description,
    availabilityRules: row.availability_rules ?? {},
    schedulingMode: mode,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listEventTypes(userId: string, includeInactive = false): Promise<EventType[]> {
  const db = await setUserContext(userId);
  let q = db.from('event_types').select('*').eq('user_id', userId).order('created_at', { ascending: false });
  if (!includeInactive) q = q.eq('active', true);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((row) => rowToEventType(row as EventTypeRow));
}

export async function getEventTypeById(userId: string, id: string): Promise<EventType | null> {
  const db = await setUserContext(userId);
  const { data, error } = await db
    .from('event_types')
    .select('*')
    .eq('user_id', userId)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToEventType(data as EventTypeRow) : null;
}

export async function createEventType(
  userId: string,
  input: {
    name: string;
    slug: string;
    durationMinutes: number;
    description?: string | null;
    availabilityRules?: Record<string, unknown>;
    schedulingMode?: 'single' | 'round_robin';
  },
): Promise<EventType> {
  const db = await setUserContext(userId);
  const now = new Date().toISOString();
  const { data, error } = await db
    .from('event_types')
    .insert({
      user_id: userId,
      name: input.name,
      slug: input.slug,
      duration_minutes: input.durationMinutes,
      description: input.description ?? null,
      availability_rules: input.availabilityRules ?? {},
      scheduling_mode: input.schedulingMode ?? 'single',
      active: true,
      updated_at: now,
    })
    .select()
    .single();
  if (error) throw error;
  return rowToEventType(data as EventTypeRow);
}

export async function updateEventType(
  userId: string,
  id: string,
  patch: {
    name?: string;
    slug?: string;
    durationMinutes?: number;
    description?: string | null;
    availabilityRules?: Record<string, unknown>;
    schedulingMode?: 'single' | 'round_robin';
    active?: boolean;
  },
): Promise<EventType | null> {
  const db = await setUserContext(userId);
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.slug !== undefined) row.slug = patch.slug;
  if (patch.durationMinutes !== undefined) row.duration_minutes = patch.durationMinutes;
  if (patch.description !== undefined) row.description = patch.description;
  if (patch.availabilityRules !== undefined) row.availability_rules = patch.availabilityRules;
  if (patch.schedulingMode !== undefined) row.scheduling_mode = patch.schedulingMode;
  if (patch.active !== undefined) row.active = patch.active;

  const { data, error } = await db
    .from('event_types')
    .update(row)
    .eq('user_id', userId)
    .eq('id', id)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data ? rowToEventType(data as EventTypeRow) : null;
}

export async function deactivateEventType(userId: string, id: string): Promise<EventType | null> {
  return updateEventType(userId, id, { active: false });
}

/** Public lookup — service role bypasses RLS (guest booking entry). */
export async function getPublicEventTypeByUsernameSlug(
  username: string,
  slug: string,
): Promise<{ eventType: EventType; hostName: string | null; hostTimezone: string } | null> {
  const { data: user, error: userError } = await getSupabase()
    .from('users')
    .select('id, display_name, timezone')
    .eq('username', username.toLowerCase())
    .maybeSingle();
  if (userError) throw userError;
  if (!user) return null;

  const { data, error } = await getSupabase()
    .from('event_types')
    .select('*')
    .eq('user_id', user.id)
    .eq('slug', slug.toLowerCase())
    .eq('active', true)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  return {
    eventType: rowToEventType(data as EventTypeRow),
    hostName: (user.display_name as string) ?? null,
    hostTimezone: (user.timezone as string) ?? 'America/Chicago',
  };
}
