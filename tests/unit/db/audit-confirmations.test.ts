/**
 * DB layer — audit, confirmations, failures (mocked Supabase).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const st = vi.hoisted(() => ({
  auditRows: [] as Record<string, unknown>[],
  confirmations: [] as Record<string, unknown>[],
  failures: [] as Record<string, unknown>[],
}));

vi.mock('../../../src/db/client.js', () => ({
  getSupabase: () => ({
    from: (table: string) => {
      if (table === 'audit_log') {
        return {
          insert: (row: Record<string, unknown>) => {
            st.auditRows.unshift({ ...row, created_at: new Date().toISOString() });
            return Promise.resolve({ error: null });
          },
          select: () => ({
            eq: (_c: string, userId: string) => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({
                    data: st.auditRows.find((r) => r.user_id === userId) ?? null,
                    error: null,
                  }),
                }),
              }),
              eq: (_c2: string, intent: string) => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({
                      data: st.auditRows.find((r) => r.user_id === userId && r.intent === intent) ?? null,
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'pending_confirmations') {
        return {
          insert: (row: Record<string, unknown>) => ({
            select: () => ({
              single: async () => {
                const saved = { token: 'confirm-tok-1', ...row };
                st.confirmations.push(saved);
                return { data: saved, error: null };
              },
            }),
          }),
          select: () => ({
            eq: (_c: string, token: string) => ({
              maybeSingle: async () => ({
                data: st.confirmations.find((c) => c.token === token) ?? null,
                error: null,
              }),
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: (_c: string, token: string) => {
              const row = st.confirmations.find((c) => c.token === token);
              if (row) Object.assign(row, patch);
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      if (table === 'failure_logs') {
        return {
          insert: (row: Record<string, unknown>) => {
            st.failures.push(row);
            return Promise.resolve({ error: null });
          },
          select: () => ({
            gte: () => ({
              order: async () => ({ data: st.failures, error: null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

vi.mock('../../../src/config.js', () => ({
  config: { confirmExpiryMinutes: 30 },
}));

import { insertAuditLog, getLastAuditForUser, hashPayload } from '../../../src/db/audit.js';
import {
  insertPendingConfirmation,
  getPendingConfirmation,
  updateConfirmationStatus,
} from '../../../src/db/confirmations.js';
import { insertFailureLog, listFailuresSince } from '../../../src/db/failures.js';

describe('audit db', () => {
  beforeEach(() => {
    st.auditRows = [];
  });

  it('insertAuditLog stores row', async () => {
    await insertAuditLog({
      userId: 'u1',
      intent: 'CREATE_EVENT',
      outcome: 'success',
      eventsAffected: 1,
      requestId: 'r1',
    });
    const last = await getLastAuditForUser('u1');
    expect(last?.intent).toBe('CREATE_EVENT');
  });

  it('hashPayload is deterministic', () => {
    const h1 = hashPayload({ a: 1 });
    const h2 = hashPayload({ a: 1 });
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
  });
});

describe('confirmations db', () => {
  beforeEach(() => {
    st.confirmations = [];
  });

  it('insertPendingConfirmation returns token with hash', async () => {
    const token = await insertPendingConfirmation({
      userId: 'u1',
      intent: 'FLUSH_RANGE',
      payload: { parsed: { intent: 'FLUSH_RANGE' } },
    });
    expect(token).toBe('confirm-tok-1');
    const pending = await getPendingConfirmation(token);
    expect(pending?.payload_hash).toBeTruthy();
    expect(pending?.status).toBe('pending');
  });

  it('updateConfirmationStatus patches row', async () => {
    await insertPendingConfirmation({ userId: 'u1', intent: 'X', payload: {} });
    await updateConfirmationStatus('confirm-tok-1', 'approved');
    const pending = await getPendingConfirmation('confirm-tok-1');
    expect(pending?.status).toBe('approved');
  });
});

describe('failures db', () => {
  beforeEach(() => {
    st.failures = [];
  });

  it('insertFailureLog and listFailuresSince', async () => {
    await insertFailureLog({
      userId: 'u1',
      rawUtterance: 'help',
      attemptedIntent: 'RESOLVE_MANUAL',
      failureReason: 'resolve_manual',
    });
    const rows = await listFailuresSince(new Date(Date.now() - 60000));
    expect(rows).toHaveLength(1);
    expect(rows[0].failure_reason).toBe('resolve_manual');
  });
});
