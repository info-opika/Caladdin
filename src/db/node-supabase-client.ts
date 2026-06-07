import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** Node/test Supabase client without browser session persistence. */
export function createNodeSupabaseClient(url: string, key: string): SupabaseClient {
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

/** Set per-request user scope for RLS policies (app.user_id). */
export async function setUserContext(client: SupabaseClient, userId: string): Promise<void> {
  const { error } = await client.rpc('set_app_user_id', { p_user_id: userId });
  if (error) {
    throw new Error(`Failed to set user context: ${error.message}`);
  }
}
