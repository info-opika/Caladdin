import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!client) {
    if (!config.supabaseUrl || !config.supabaseServiceKey) {
      throw new Error('Supabase not configured');
    }
    client = createClient(config.supabaseUrl, config.supabaseServiceKey);
  }
  return client;
}

export function resetSupabaseForTests(): void {
  client = null;
}
