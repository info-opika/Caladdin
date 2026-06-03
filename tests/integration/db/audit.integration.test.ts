/**
 * Layer 2 — DB Integration Tests: audit_log table
 *
 * Tests insertAuditLog behaviour against the REAL test DB.
 * Skips gracefully if SUPABASE_TEST_URL is not set.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getTestClient, isTestDbAvailable, cleanupTestUser } from './helpers.js';

const SKIP = !isTestDbAvailable();
const AUDIT_TEST_USER_ID = '00000000-0000-4000-8000-00000000ab15';

function makeAuditOps(client: SupabaseClient) {
  async function insertAuditLog(entry: {
    userId: string;
    intent: string;
    atomicOp: string;
    eventId?: string | null;
    outcome: 'success' | 'blocked' | 'pending_confirmation' | 'failed';
    confirmationToken?: string | null;
    telemetry?: unknown;
  }): Promise<void> {
    const { error } = await client.from('audit_log').insert({
      user_id: entry.userId,
      intent: entry.intent,
      atomic_op: entry.atomicOp,
      event_id: entry.eventId ?? null,
      outcome: entry.outcome,
      confirmation_token: entry.confirmationToken ?? null,
      telemetry: entry.telemetry ?? null,
    });
    if (error) throw new Error(`Audit log insert failed: ${error.message}`);
  }

  return { insertAuditLog };
}

describe.skipIf(SKIP)('audit_log integration (real DB)', () => {
  let client: SupabaseClient;
  let ops: ReturnType<typeof makeAuditOps>;

  beforeAll(async () => {
    client = getTestClient()!;
    ops = makeAuditOps(client);
    await client
      .from('users')
      .upsert({ id: AUDIT_TEST_USER_ID, email: 'test+audit@caladdin.test' }, { onConflict: 'id' });
  });

  afterAll(async () => {
    await cleanupTestUser(client, AUDIT_TEST_USER_ID);
  });

  it('inserts with all required fields', async () => {
    await expect(
      ops.insertAuditLog({
        userId: AUDIT_TEST_USER_ID,
        intent: 'PROTECT_BLOCK',
        atomicOp: 'add_recurring_block',
        outcome: 'success',
      })
    ).resolves.not.toThrow();
  });

  it('inserts with optional telemetry JSONB', async () => {
    await expect(
      ops.insertAuditLog({
        userId: AUDIT_TEST_USER_ID,
        intent: 'OFFER_SPECIFIC',
        atomicOp: 'offer_slots',
        outcome: 'success',
        telemetry: {
          stateTransitionPath: [
            { state: 'RECEIVED', timestamp: new Date().toISOString() },
            { state: 'EXECUTED', timestamp: new Date().toISOString() },
          ],
        },
      })
    ).resolves.not.toThrow();
  });

  it('inserts without telemetry (column is nullable)', async () => {
    await expect(
      ops.insertAuditLog({
        userId: AUDIT_TEST_USER_ID,
        intent: 'FLUSH_RANGE',
        atomicOp: 'flush_range',
        outcome: 'blocked',
        telemetry: null,
      })
    ).resolves.not.toThrow();
  });

  it('all 4 outcome values accepted by DB constraint', async () => {
    const outcomes = ['success', 'blocked', 'pending_confirmation', 'failed'] as const;
    for (const outcome of outcomes) {
      await expect(
        ops.insertAuditLog({
          userId: AUDIT_TEST_USER_ID,
          intent: 'MODIFY_EVENT',
          atomicOp: 'modify_event',
          outcome,
        })
      ).resolves.not.toThrow();
    }
  });

  it('invalid outcome value rejected by DB constraint', async () => {
    const { error } = await client.from('audit_log').insert({
      user_id: AUDIT_TEST_USER_ID,
      intent: 'TEST',
      atomic_op: 'test',
      outcome: 'invalid_outcome_xyz',
    });
    expect(error).not.toBeNull();
  });
});
