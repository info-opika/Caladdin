/**
 * Layer 2 — DB Integration Tests: pending_confirmations table
 *
 * Tests the confirmation flow against the REAL test DB.
 * Skips gracefully if SUPABASE_TEST_URL is not set.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getTestClient, isTestDbAvailable, cleanupTestUser } from './helpers.js';
import { randomUUID, createHash } from 'crypto';

const SKIP = !isTestDbAvailable();
const CONFIRMATIONS_TEST_USER_ID = '00000000-0000-4000-8000-00000000ab12';

function hashPayload(payload: unknown): string {
  const sorted = JSON.stringify(payload, Object.keys(payload as Record<string, unknown>).sort());
  return createHash('sha256').update(sorted).digest('hex');
}

function makeConfirmationOps(client: SupabaseClient) {
  async function insertPendingConfirmation(
    userId: string,
    intent: string,
    payload: unknown
  ): Promise<string> {
    const token = randomUUID();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const payload_hash = hashPayload(payload);

    const { error } = await client.from('pending_confirmations').insert({
      user_id: userId,
      confirmation_token: token,
      intent,
      payload,
      payload_hash,
      expires_at: expiresAt,
    });
    if (error) throw new Error(`DB insert failed: ${error.message}`);
    return token;
  }

  async function getPendingConfirmation(token: string) {
    const { data, error } = await client
      .from('pending_confirmations')
      .select('*')
      .eq('confirmation_token', token)
      .single();
    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new Error(`DB query failed: ${error.message}`);
    }
    return data;
  }

  async function updateConfirmationStatus(
    token: string,
    status: 'approved' | 'rejected'
  ): Promise<void> {
    const { error } = await client
      .from('pending_confirmations')
      .update({ status })
      .eq('confirmation_token', token);
    if (error) throw new Error(`DB update failed: ${error.message}`);
  }

  return { insertPendingConfirmation, getPendingConfirmation, updateConfirmationStatus };
}

describe.skipIf(SKIP)('pending_confirmations integration (real DB)', () => {
  let client: SupabaseClient;
  let ops: ReturnType<typeof makeConfirmationOps>;
  let insertedToken: string;

  beforeAll(async () => {
    client = getTestClient()!;
    ops = makeConfirmationOps(client);
    await client
      .from('users')
      .upsert({ id: CONFIRMATIONS_TEST_USER_ID, email: 'test+confirm@caladdin.test' }, { onConflict: 'id' });
  });

  afterAll(async () => {
    await cleanupTestUser(client, CONFIRMATIONS_TEST_USER_ID);
  });

  it('insertPendingConfirmation returns valid UUID token', async () => {
    const payload = { intent: 'FLUSH_RANGE', eventsAffected: [] };
    insertedToken = await ops.insertPendingConfirmation(CONFIRMATIONS_TEST_USER_ID, 'FLUSH_RANGE', payload);
    expect(insertedToken).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  it('getPendingConfirmation returns correct row', async () => {
    const row = await ops.getPendingConfirmation(insertedToken);
    expect(row).not.toBeNull();
    expect(row!['confirmation_token']).toBe(insertedToken);
    expect(row!['user_id']).toBe(CONFIRMATIONS_TEST_USER_ID);
    expect(row!['intent']).toBe('FLUSH_RANGE');
    expect(row!['status']).toBe('pending');
  });

  it('getPendingConfirmation returns null for unknown token', async () => {
    const unknown = randomUUID();
    const row = await ops.getPendingConfirmation(unknown);
    expect(row).toBeNull();
  });

  it('updateConfirmationStatus changes status correctly', async () => {
    await ops.updateConfirmationStatus(insertedToken, 'approved');
    const row = await ops.getPendingConfirmation(insertedToken);
    expect(row!['status']).toBe('approved');
  });

  it('payload_hash column exists and stores correctly', async () => {
    const payload = { intent: 'PROTECT_BLOCK', data: 'test' };
    const token = await ops.insertPendingConfirmation(CONFIRMATIONS_TEST_USER_ID, 'PROTECT_BLOCK', payload);
    const row = await ops.getPendingConfirmation(token);

    expect(row).not.toBeNull();
    const expectedHash = hashPayload(payload);
    expect(row!['payload_hash']).toBe(expectedHash);
  });

  it('expires_at is always set to future timestamp', async () => {
    const payload = { intent: 'OFFER_SPECIFIC' };
    const token = await ops.insertPendingConfirmation(CONFIRMATIONS_TEST_USER_ID, 'OFFER_SPECIFIC', payload);
    const row = await ops.getPendingConfirmation(token);

    expect(row).not.toBeNull();
    const expiresAt = new Date(row!['expires_at']).getTime();
    expect(expiresAt).toBeGreaterThan(Date.now());
  });
});
