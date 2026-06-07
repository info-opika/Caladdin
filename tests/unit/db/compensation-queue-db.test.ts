/**
 * DB layer — compensation queue + idempotency (mocked Supabase).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const st = vi.hoisted(() => ({
  queue: [] as Record<string, unknown>[],
  idempotency: [] as Record<string, unknown>[],
}));

vi.mock('../../../src/db/client.js', () => ({
  getSupabase: () => ({
    from: (table: string) => {
      if (table === 'compensation_queue') {
        return {
          insert: (row: Record<string, unknown>) => {
            st.queue.push({ id: `cq-${st.queue.length + 1}`, attempts: 0, ...row });
            return Promise.resolve({ error: null });
          },
          select: () => ({
            lte: () => ({
              lt: () => ({
                order: () => ({
                  limit: async (n: number) => ({
                    data: st.queue.slice(0, n),
                    error: null,
                  }),
                }),
              }),
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: async (_c: string, id: string) => {
              const row = st.queue.find((q) => q.id === id);
              if (row) Object.assign(row, patch);
              return { error: null };
            },
          }),
          delete: () => ({
            eq: async (_c: string, id: string) => {
              st.queue = st.queue.filter((q) => q.id !== id);
              return { error: null };
            },
          }),
        };
      }
      if (table === 'idempotency_keys') {
        return {
          select: () => ({
            eq: (_c: string, keyHash: string) => ({
              gt: () => ({
                maybeSingle: async () => ({
                  data: st.idempotency.find((k) => k.key_hash === keyHash) ?? null,
                  error: null,
                }),
              }),
            }),
          }),
          upsert: (row: Record<string, unknown>) => {
            st.idempotency = st.idempotency.filter((k) => k.key_hash !== row.key_hash);
            st.idempotency.push(row);
            return Promise.resolve({ error: null });
          },
        };
      }
      throw new Error(table);
    },
  }),
}));

import {
  enqueueCompensation,
  pollCompensationBatch,
  markCompensationAttempt,
  deleteCompensation,
  checkIdempotency,
  storeIdempotency,
} from '../../../src/db/compensation_queue.js';

describe('compensation_queue db', () => {
  beforeEach(() => {
    st.queue = [];
    st.idempotency = [];
  });

  it('enqueue and poll batch', async () => {
    await enqueueCompensation({
      userId: 'u1',
      operation: 'gcal_delete',
      payload: { eventId: 'ev-1' },
    });
    const batch = await pollCompensationBatch(5);
    expect(batch).toHaveLength(1);
    expect(batch[0].operation).toBe('gcal_delete');
  });

  it('markCompensationAttempt updates retry metadata', async () => {
    await enqueueCompensation({ userId: 'u1', operation: 'retry', payload: {} });
    const id = st.queue[0].id as string;
    await markCompensationAttempt(id, 2);
    expect(st.queue[0].attempts).toBe(2);
    expect(st.queue[0].next_retry_at).toBeTruthy();
  });

  it('deleteCompensation removes row', async () => {
    await enqueueCompensation({ userId: 'u1', operation: 'done', payload: {} });
    const id = st.queue[0].id as string;
    await deleteCompensation(id);
    expect(st.queue).toHaveLength(0);
  });

  it('idempotency check and store', async () => {
    expect(await checkIdempotency('hash-1')).toBe(false);
    await storeIdempotency({
      keyHash: 'hash-1',
      userId: 'u1',
      intent: 'CREATE_EVENT',
      bucket5min: '2026-06-07T12:00',
    });
    expect(await checkIdempotency('hash-1')).toBe(true);
  });
});
