/**
 * Layer 2 — DB Integration Tests: google_tokens table
 *
 * Tests token storage/retrieval against the REAL test DB.
 * Skips gracefully if SUPABASE_TEST_URL is not set.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getTestClient, isTestDbAvailable, cleanupTestUser } from './helpers.js';
import type { Credentials } from 'google-auth-library';

const SKIP = !isTestDbAvailable();
const TOKENS_TEST_USER_ID = '00000000-0000-4000-8000-00000000ab13';

function makeTokenOps(client: SupabaseClient) {
  async function upsertGoogleTokens(userId: string, tokens: Credentials): Promise<void> {
    const { error } = await client
      .from('google_tokens')
      .upsert(
        {
          user_id: userId,
          access_token: tokens.access_token ?? null,
          refresh_token: tokens.refresh_token ?? null,
          expiry_date: tokens.expiry_date ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      );
    if (error) throw new Error(`Failed to store Google tokens: ${error.message}`);
  }

  async function loadGoogleTokens(userId: string): Promise<Credentials | null> {
    const { data, error } = await client
      .from('google_tokens')
      .select('access_token, refresh_token, expiry_date')
      .eq('user_id', userId)
      .single();
    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new Error(`Failed to load Google tokens: ${error.message}`);
    }
    if (!data) return null;
    const row = data as { access_token: string | null; refresh_token: string | null; expiry_date: number | null };
    return {
      access_token: row.access_token,
      refresh_token: row.refresh_token,
      expiry_date: row.expiry_date,
    };
  }

  return { upsertGoogleTokens, loadGoogleTokens };
}

describe.skipIf(SKIP)('google_tokens integration (real DB)', () => {
  let client: SupabaseClient;
  let ops: ReturnType<typeof makeTokenOps>;

  beforeAll(async () => {
    client = getTestClient()!;
    ops = makeTokenOps(client);
    await client
      .from('users')
      .upsert({ id: TOKENS_TEST_USER_ID, email: 'test+tokens@caladdin.test' }, { onConflict: 'id' });
    await client.from('google_tokens').delete().eq('user_id', TOKENS_TEST_USER_ID);
  });

  afterAll(async () => {
    await cleanupTestUser(client, TOKENS_TEST_USER_ID);
  });

  it('upsertGoogleTokens stores individual columns correctly', async () => {
    const tokens: Credentials = {
      access_token: 'ya29.test-access-token',
      refresh_token: '1//test-refresh-token',
      expiry_date: Date.now() + 3600_000,
    };
    await expect(ops.upsertGoogleTokens(TOKENS_TEST_USER_ID, tokens)).resolves.not.toThrow();
  });

  it('loadGoogleTokens reconstructs Credentials from individual columns', async () => {
    const result = await ops.loadGoogleTokens(TOKENS_TEST_USER_ID);
    expect(result).not.toBeNull();
    expect(result!.access_token).toBe('ya29.test-access-token');
    expect(result!.refresh_token).toBe('1//test-refresh-token');
    expect(result!.expiry_date).toBeGreaterThan(Date.now());
  });

  it('null refresh_token stored and retrieved correctly', async () => {
    await ops.upsertGoogleTokens(TOKENS_TEST_USER_ID, {
      access_token: 'ya29.no-refresh',
      refresh_token: null,
      expiry_date: Date.now() + 3600_000,
    });
    const result = await ops.loadGoogleTokens(TOKENS_TEST_USER_ID);
    expect(result!.refresh_token).toBeNull();
  });

  it('null expiry_date stored and retrieved correctly', async () => {
    await ops.upsertGoogleTokens(TOKENS_TEST_USER_ID, {
      access_token: 'ya29.no-expiry',
      refresh_token: '1//refresh',
      expiry_date: undefined,
    });
    const result = await ops.loadGoogleTokens(TOKENS_TEST_USER_ID);
    expect(result!.expiry_date).toBeNull();
  });

  it('updating tokens for same userId overwrites correctly', async () => {
    const first: Credentials = {
      access_token: 'ya29.first',
      refresh_token: '1//first',
      expiry_date: 1000,
    };
    const second: Credentials = {
      access_token: 'ya29.second',
      refresh_token: '1//second',
      expiry_date: 2000,
    };

    await ops.upsertGoogleTokens(TOKENS_TEST_USER_ID, first);
    await ops.upsertGoogleTokens(TOKENS_TEST_USER_ID, second);

    const result = await ops.loadGoogleTokens(TOKENS_TEST_USER_ID);
    expect(result!.access_token).toBe('ya29.second');
    expect(result!.expiry_date).toBe(2000);
  });
});
