import { getSupabase } from './client.js';
import { migratePolicy, UserPolicyProfile } from '../core/adts.js';

export interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  username: string | null;
  timezone: string;
  privacy_mode: string;
}

const USERNAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function deriveUsernameFromEmail(email: string): string {
  const local = email.split('@')[0]?.toLowerCase() ?? 'user';
  const base = local.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'user';
  return base;
}

export async function getUserByUsername(username: string): Promise<UserRow | null> {
  const { data, error } = await getSupabase()
    .from('users')
    .select('*')
    .eq('username', username.toLowerCase())
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function ensureUsername(userId: string, email: string): Promise<string> {
  const user = await getUserById(userId);
  if (user?.username) return user.username;

  let candidate = deriveUsernameFromEmail(email);
  if (!USERNAME_RE.test(candidate)) candidate = 'user';

  for (let i = 0; i < 100; i += 1) {
    const username = i === 0 ? candidate : `${candidate}-${i + 1}`;
    const existing = await getUserByUsername(username);
    if (existing && existing.id !== userId) continue;

    const { data, error } = await getSupabase()
      .from('users')
      .update({ username })
      .eq('id', userId)
      .select('username')
      .single();
    if (error) {
      if (String(error.message).includes('duplicate') || String(error.message).includes('unique')) continue;
      throw error;
    }
    return (data.username as string) ?? username;
  }

  throw new Error('Could not allocate username');
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

export interface UserProfileView {
  userId: string;
  email: string;
  timezone: string;
  privacyMode: 'private' | 'trusted' | 'open';
  workingHoursStart: string;
  workingHoursEnd: string;
  onboardingComplete: boolean;
  calendarConnected: boolean;
}

export async function getUserProfileView(
  userId: string,
  calendarConnected: boolean,
): Promise<UserProfileView | null> {
  const user = await getUserById(userId);
  if (!user) return null;
  const policy = await ensureDefaultPolicy(userId);
  const privacy = user.privacy_mode as UserProfileView['privacyMode'];
  return {
    userId: user.id,
    email: user.email,
    timezone: policy.timezone ?? user.timezone ?? 'America/Chicago',
    privacyMode: ['private', 'trusted', 'open'].includes(privacy) ? privacy : 'private',
    workingHoursStart: policy.workingHoursStart ?? '09:00',
    workingHoursEnd: policy.workingHoursEnd ?? '18:00',
    onboardingComplete: policy.onboardingComplete ?? false,
    calendarConnected,
  };
}

export async function updateUserProfile(
  userId: string,
  updates: {
    timezone?: string;
    privacyMode?: 'private' | 'trusted' | 'open';
    workingHoursStart?: string;
    workingHoursEnd?: string;
    markOnboardingComplete?: boolean;
  },
): Promise<UserProfileView> {
  const user = await getUserById(userId);
  if (!user) throw new Error('User not found');

  const userPatch: Partial<Pick<UserRow, 'timezone' | 'privacy_mode'>> = {};
  if (updates.timezone?.trim()) userPatch.timezone = updates.timezone.trim();
  if (updates.privacyMode) userPatch.privacy_mode = updates.privacyMode;

  if (Object.keys(userPatch).length > 0) {
    const { error } = await getSupabase().from('users').update(userPatch).eq('id', userId);
    if (error) throw error;
  }

  const policy = await ensureDefaultPolicy(userId);
  const nextPolicy: UserPolicyProfile = { ...policy };
  if (updates.timezone?.trim()) nextPolicy.timezone = updates.timezone.trim();
  if (updates.workingHoursStart?.trim()) nextPolicy.workingHoursStart = updates.workingHoursStart.trim();
  if (updates.workingHoursEnd?.trim()) nextPolicy.workingHoursEnd = updates.workingHoursEnd.trim();
  if (updates.markOnboardingComplete) nextPolicy.onboardingComplete = true;
  await upsertPolicy(userId, nextPolicy);

  const refreshed = await getUserById(userId);
  if (!refreshed) throw new Error('User not found');

  const privacy = refreshed.privacy_mode as UserProfileView['privacyMode'];
  return {
    userId: refreshed.id,
    email: refreshed.email,
    timezone: nextPolicy.timezone,
    privacyMode: ['private', 'trusted', 'open'].includes(privacy) ? privacy : 'private',
    workingHoursStart: nextPolicy.workingHoursStart ?? '09:00',
    workingHoursEnd: nextPolicy.workingHoursEnd ?? '18:00',
    onboardingComplete: nextPolicy.onboardingComplete ?? false,
    calendarConnected: false,
  };
}
