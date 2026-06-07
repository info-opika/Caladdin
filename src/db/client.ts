import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { setUserContext as setUserContextOnClient } from './node-supabase-client.js';

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!client) {
    if (!config.supabaseUrl || !config.supabaseServiceKey) {
      throw new Error('Supabase not configured');
    }
    client = createClient(config.supabaseUrl, config.supabaseServiceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }
  return client;
}

/** Apply RLS user scope before user-scoped queries (service role + setUserContext pattern). */
export async function setUserContext(userId: string): Promise<SupabaseClient> {
  const db = getSupabase();
  await setUserContextOnClient(db, userId);
  return db;
}

export function resetSupabaseForTests(): void {
  client = null;
}

/** Lightweight connectivity check for /health (head count on sessions). */
export async function pingDb(): Promise<'ok' | 'error'> {
  if (process.env.VITEST === 'true' || process.env.NODE_ENV === 'test') {
    return 'ok';
  }
  try {
    if (!config.supabaseUrl || !config.supabaseServiceKey) {
      return 'error';
    }
    const { error } = await getSupabase()
      .from('sessions')
      .select('token_hash', { count: 'exact', head: true });
    return error ? 'error' : 'ok';
  } catch {
    return 'error';
  }
}
