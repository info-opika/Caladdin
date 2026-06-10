import { getSupabase } from './client.js';
import type { ProposedAlternative, SchedulingSessionRow } from './scheduling_sessions.js';

export async function listHostSessionsWithPendingProposals(hostUserId: string): Promise<SchedulingSessionRow[]> {
  const { data, error } = await getSupabase()
    .from('scheduling_sessions')
    .select('*')
    .eq('host_user_id', hostUserId)
    .order('updated_at', { ascending: false });
  if (error) throw new Error(`scheduling_sessions list: ${error.message}`);
  const rows = (data ?? []) as unknown as SchedulingSessionRow[];
  return rows.filter((r) => {
    const alts = r.proposed_alternatives;
    if (!Array.isArray(alts) || alts.length === 0) return false;
    return alts.some((a: ProposedAlternative) => a.status === 'pending' || a.status == null);
  });
}
