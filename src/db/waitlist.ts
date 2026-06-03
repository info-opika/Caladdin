import { getSupabase } from './client.js';

export interface WaitlistRow {
  id: string;
  email: string;
  status: string;
  created_at: string;
  invited_at: string | null;
}

export async function addToWaitlist(email: string): Promise<WaitlistRow> {
  const normalized = email.trim().toLowerCase();
  const { data, error } = await getSupabase()
    .from('waitlist')
    .upsert({ email: normalized, status: 'waiting' }, { onConflict: 'email' })
    .select()
    .single();
  if (error) throw error;
  return data as WaitlistRow;
}

export async function getWaitlistStatus(): Promise<{ count: number; open: boolean }> {
  const { count, error } = await getSupabase()
    .from('waitlist')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'waiting');
  if (error) throw error;
  return { count: count ?? 0, open: true };
}
