/**
 * RLS isolation — requires SUPABASE_TEST_URL + service role for seeding.
 * Proves set_app_user_id context scopes reads when RLS is enforced via pg role.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { getTestClient, isTestDbAvailable, cleanupTestUser } from './helpers.js';
import { setUserContext } from '../../../src/db/node-supabase-client.js';

const SKIP = !isTestDbAvailable() || !process.env['SUPABASE_TEST_DATABASE_URL'];

const USER_A = '00000000-0000-4000-8000-00000000rla1';
const USER_B = '00000000-0000-4000-8000-00000000rlb2';

describe.skipIf(SKIP)('RLS isolation (real DB)', () => {
  const pool = new pg.Pool({ connectionString: process.env['SUPABASE_TEST_DATABASE_URL'] });

  beforeAll(async () => {
    const client = getTestClient()!;
    for (const [id, email] of [
      [USER_A, 'rls-a@caladdin.test'],
      [USER_B, 'rls-b@caladdin.test'],
    ] as const) {
      await client.from('users').upsert({ id, email }, { onConflict: 'id' });
    }

    await client.from('events').delete().in('user_id', [USER_A, USER_B]);
    await client.from('events').insert([
      {
        user_id: USER_A,
        title: 'User A meeting',
        start_at: new Date().toISOString(),
        end_at: new Date(Date.now() + 3_600_000).toISOString(),
        tier: 2,
        status: 'confirmed',
      },
      {
        user_id: USER_B,
        title: 'User B meeting',
        start_at: new Date().toISOString(),
        end_at: new Date(Date.now() + 3_600_000).toISOString(),
        tier: 2,
        status: 'confirmed',
      },
    ]);
  });

  afterAll(async () => {
    const client = getTestClient()!;
    await client.from('events').delete().in('user_id', [USER_A, USER_B]);
    await cleanupTestUser(client, USER_A);
    await cleanupTestUser(client, USER_B);
    await pool.end();
  });

  it('user A cannot read user B events under RLS (authenticated role)', async () => {
    const conn = await pool.connect();
    try {
      await conn.query('SET ROLE authenticated');
      await conn.query('SELECT set_app_user_id($1::uuid)', [USER_A]);

      const own = await conn.query('SELECT title FROM events WHERE user_id = $1', [USER_A]);
      const other = await conn.query('SELECT title FROM events WHERE user_id = $1', [USER_B]);

      expect(own.rows.length).toBeGreaterThanOrEqual(1);
      expect(other.rows.length).toBe(0);
    } finally {
      await conn.query('RESET ROLE');
      conn.release();
    }
  });

  it('setUserContext RPC scopes Supabase client reads when not bypassing RLS', async () => {
    const client = getTestClient()!;
    await setUserContext(client, USER_A);

    const { data, error } = await client.from('events').select('title').eq('user_id', USER_B);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });
});
