/**
 * Shared helpers for DB integration tests.
 * Connects to SUPABASE_TEST_URL if set, otherwise returns null to allow skip.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createNodeSupabaseClient } from '../../../src/db/node-supabase-client.js';
import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../../../.env') });

export const TEST_USER_ID = '77a22c75-4e6b-47ca-aee6-2f4ace21be53';

/**
 * Returns a Supabase client connected to the TEST project.
 * Prefers service role when set so integration tests can write server-owned tables
 * after RLS lockdown (anon has no table privileges).
 * Returns null if SUPABASE_TEST_URL is not set or no key is available.
 */
export function getTestClient(): SupabaseClient | null {
  const url = process.env['SUPABASE_TEST_URL'];
  if (!url) return null;
  const serviceKey =
    process.env['SUPABASE_TEST_SERVICE_ROLE_KEY']?.trim() ||
    process.env['SUPABASE_SERVICE_ROLE_KEY']?.trim();
  const anonKey = process.env['SUPABASE_TEST_ANON_KEY']?.trim();
  const key = serviceKey || anonKey;
  if (!key) return null;
  return createNodeSupabaseClient(url, key);
}

/**
 * Checks whether the test DB is available. Returns false (skip) if not configured.
 * Requires URL plus either anon key (RLS/anon tests) or service role (writes under lockdown).
 */
export function isTestDbAvailable(): boolean {
  const url = Boolean(process.env['SUPABASE_TEST_URL']);
  const anon = Boolean(process.env['SUPABASE_TEST_ANON_KEY']?.trim());
  const service = Boolean(
    process.env['SUPABASE_TEST_SERVICE_ROLE_KEY']?.trim() ||
      process.env['SUPABASE_SERVICE_ROLE_KEY']?.trim()
  );
  return url && (anon || service);
}

/**
 * Convenience: clean up rows inserted during a test by user_id.
 */
export async function cleanupTestUser(client: SupabaseClient, userId: string): Promise<void> {
  await client.from('audit_log').delete().eq('user_id', userId);
  await client.from('pending_confirmations').delete().eq('user_id', userId);
  await client.from('failure_logs').delete().eq('user_id', userId);
  await client.from('google_tokens').delete().eq('user_id', userId);
  await client.from('user_policies').delete().eq('user_id', userId);
  await client.from('users').delete().eq('id', userId);
}
