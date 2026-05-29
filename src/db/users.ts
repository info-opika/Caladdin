import { getSupabase } from './client.js';
import { migratePolicy, UserPolicyProfile } from '../core/adts.js';

export interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  timezone: string;
  privacy_mode: string;
}

export async function getUserById(id: string): Promise<UserRow | null> {
  const { data, error } = await getSupabase().from('users').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getUserByEmail(email: string): Promise<UserRow | null> {
  const { data, error } = await getSupabase().from('users').select('*').eq('email', email).maybeSingle();
  if (error) throw error;
  return data;
}

export async function upsertUser(row: { email: string; display_name?: string; timezone?: string }): Promise<UserRow> {
  const { data, error } = await getSupabase()
    .from('users')
    .upsert({ email: row.email, display_name: row.display_name, timezone: row.timezone ?? 'America/Chicago' }, { onConflict: 'email' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getPolicy(userId: string): Promise<UserPolicyProfile | null> {
  const { data, error } = await getSupabase().from('user_policies').select('profile').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return migratePolicy(data.profile);
}

export async function upsertPolicy(userId: string, profile: UserPolicyProfile): Promise<void> {
  const { error } = await getSupabase()
    .from('user_policies')
    .upsert({ user_id: userId, profile, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw error;
}

export async function ensureDefaultPolicy(userId: string): Promise<UserPolicyProfile> {
  let policy = await getPolicy(userId);
  if (!policy) {
    policy = migratePolicy({});
    await upsertPolicy(userId, policy);
  }
  return policy;
}
