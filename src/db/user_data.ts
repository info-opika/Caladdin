import { getSupabase } from './client.js';
import { getGoogleTokens } from './tokens.js';
import { deleteAllSessionsForUser } from './sessions.js';

export interface UserDataExport {
  exportedAt: string;
  user: Record<string, unknown> | null;
  policy: Record<string, unknown> | null;
  eventTypes: Record<string, unknown>[];
  schedulingSessions: Record<string, unknown>[];
  feedback: Record<string, unknown>[];
  auditLog: Record<string, unknown>[];
  usageEvents: Record<string, unknown>[];
  calendarConnected: boolean;
}

export async function exportUserData(userId: string): Promise<UserDataExport> {
  const supabase = getSupabase();

  const [
    userRes,
    policyRes,
    eventTypesRes,
    sessionsRes,
    feedbackRes,
    auditRes,
    usageRes,
    googleTokens,
  ] = await Promise.all([
    supabase.from('users').select('id, email, display_name, username, timezone, privacy_mode, created_at').eq('id', userId).maybeSingle(),
    supabase.from('user_policies').select('profile, updated_at').eq('user_id', userId).maybeSingle(),
    supabase.from('event_types').select('id, name, slug, duration_minutes, description, availability_rules, active, created_at, updated_at').eq('user_id', userId),
    supabase.from('scheduling_sessions').select('id, token, status, host_name, invitee_email, duration_minutes, created_at, expires_at').eq('host_user_id', userId),
    supabase.from('feedback_logs').select('id, rating, stars, intent, comment, created_at').eq('user_id', userId),
    supabase.from('audit_log').select('id, intent, outcome, events_affected, request_id, metadata, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(500),
    supabase.from('usage_events').select('id, event_type, metadata, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(500),
    getGoogleTokens(userId),
  ]);

  for (const { error } of [userRes, policyRes, eventTypesRes, sessionsRes, feedbackRes, auditRes, usageRes]) {
    if (error) throw error;
  }

  return {
    exportedAt: new Date().toISOString(),
    user: userRes.data,
    policy: policyRes.data,
    eventTypes: eventTypesRes.data ?? [],
    schedulingSessions: sessionsRes.data ?? [],
    feedback: feedbackRes.data ?? [],
    auditLog: auditRes.data ?? [],
    usageEvents: usageRes.data ?? [],
    calendarConnected: Boolean(googleTokens),
  };
}

export async function deleteUserAccount(userId: string): Promise<void> {
  const supabase = getSupabase();

  await deleteAllSessionsForUser(userId);

  const { error: tokenError } = await supabase.from('google_tokens').delete().eq('user_id', userId);
  if (tokenError) throw tokenError;

  const { error: userError } = await supabase.from('users').delete().eq('id', userId);
  if (userError) throw userError;
}
