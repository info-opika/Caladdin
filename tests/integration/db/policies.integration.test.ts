import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getTestClient, isTestDbAvailable, cleanupTestUser } from './helpers.js';
import { UserPolicyProfileSchema, type UserPolicyProfile } from '../../../src/core/adts.js';

const SKIP = !isTestDbAvailable();
const POLICIES_TEST_USER_ID = '00000000-0000-4000-8000-00000000ab14';

const TEST_POLICY: UserPolicyProfile = {
  userId: POLICIES_TEST_USER_ID,
  schemaVersion: 1,
  timezone: 'America/Chicago',
  chronotype: 'morning',
  defaultBufferMinutes: 15,
  clusteringPreference: 'balanced',
  maxFragmentsPerDay: 4,
  faxEffectConfig: {
    targetSlotsPerOffer: 2,
    minBufferMinutes: 15,
    clusteringWeight: 0.35,
    energyWeight: 0.45,
    fragmentPenaltyWeight: 0.15,
    protectDeepWorkBlocks: true,
  },
  protectedBlocks: [],
  contactTiers: {},
};

function makeUserPolicyOps(client: SupabaseClient) {
  async function getUserPolicy(userId: string): Promise<UserPolicyProfile | null> {
    const { data, error } = await client
      .from('user_policies')
      .select('policy')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new Error(`DB query failed: ${error.message}`);
    }
    if (!data) return null;
    return UserPolicyProfileSchema.parse((data as { policy: unknown }).policy);
  }

  async function upsertUserPolicy(userId: string, policy: UserPolicyProfile): Promise<void> {
    const { error } = await client
      .from('user_policies')
      .upsert(
        { user_id: userId, policy, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      );
    if (error) throw new Error(`DB upsert failed: ${error.message}`);
  }

  return { getUserPolicy, upsertUserPolicy };
}

describe.skipIf(SKIP)('policies integration (real DB)', () => {
  let client: SupabaseClient;
  let ops: ReturnType<typeof makeUserPolicyOps>;

  beforeAll(async () => {
    client = getTestClient()!;
    ops = makeUserPolicyOps(client);
    await client
      .from('users')
      .upsert({ id: POLICIES_TEST_USER_ID, email: 'test+policies@caladdin.test' }, { onConflict: 'id' });
    await client.from('user_policies').delete().eq('user_id', POLICIES_TEST_USER_ID);
  });

  afterAll(async () => {
    await cleanupTestUser(client, POLICIES_TEST_USER_ID);
  });

  it('returns null for unknown userId', async () => {
    const result = await ops.getUserPolicy('00000000-0000-4000-8000-000000000000');
    expect(result).toBeNull();
  });

  it('maybeSingle() does not throw when no rows found', async () => {
    const result = await ops.getUserPolicy(POLICIES_TEST_USER_ID);
    expect(result).toBeNull();
  });

  it('upsertUserPolicy creates new row when none exists', async () => {
    await expect(ops.upsertUserPolicy(POLICIES_TEST_USER_ID, TEST_POLICY)).resolves.not.toThrow();

    const { data } = await client
      .from('user_policies')
      .select('user_id')
      .eq('user_id', POLICIES_TEST_USER_ID)
      .single();
    expect(data).toBeTruthy();
  });

  it('returns parsed UserPolicyProfile for known userId', async () => {
    const result = await ops.getUserPolicy(POLICIES_TEST_USER_ID);
    expect(result).not.toBeNull();
    expect(result!.userId).toBe(POLICIES_TEST_USER_ID);
    expect(result!.timezone).toBe('America/Chicago');
    expect(result!.chronotype).toBe('morning');
  });

  it('upsertUserPolicy with onConflict:user_id updates existing row', async () => {
    const updated: UserPolicyProfile = { ...TEST_POLICY, timezone: 'America/New_York' };
    await expect(ops.upsertUserPolicy(POLICIES_TEST_USER_ID, updated)).resolves.not.toThrow();

    const result = await ops.getUserPolicy(POLICIES_TEST_USER_ID);
    expect(result).not.toBeNull();
    expect(result!.timezone).toBe('America/New_York');
  });

  it('duplicate rows are impossible due to unique constraint on user_id', async () => {
    const { error } = await client.from('user_policies').insert({
      user_id: POLICIES_TEST_USER_ID,
      policy: TEST_POLICY,
      updated_at: new Date().toISOString(),
    });
    expect(error).not.toBeNull();
  });
});