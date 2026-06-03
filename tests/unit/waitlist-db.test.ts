/**
 * Waitlist DB layer — addToWaitlist idempotency and getWaitlistStatus.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const st = vi.hoisted(() => ({
  waitlistRows: [] as { id: string; email: string; status: string; created_at: string; invited_at: string | null }[],
  lastUpsert: null as Record<string, unknown> | null,
  countWaiting: 0,
  upsertError: null as { message: string } | null,
  countError: null as { message: string } | null,
}));

vi.mock('../../src/db/client.js', () => ({
  getSupabase: () => ({
    from: (table: string) => {
      if (table !== 'waitlist') throw new Error(`unexpected table ${table}`);
      return {
        upsert: (row: Record<string, unknown>, _opts: { onConflict: string }) => {
          st.lastUpsert = row;
          if (st.upsertError) return { select: () => ({ single: async () => ({ data: null, error: st.upsertError }) }) };
          const existing = st.waitlistRows.find((r) => r.email === row.email);
          const saved = existing ?? {
            id: 'wl-1',
            email: row.email as string,
            status: row.status as string,
            created_at: new Date().toISOString(),
            invited_at: null,
          };
          if (!existing) st.waitlistRows.push(saved);
          return {
            select: () => ({
              single: async () => ({ data: saved, error: null }),
            }),
          };
        },
        select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
          if (opts?.count === 'exact' && opts?.head) {
            return {
              eq: (_c: string, status: string) =>
                Promise.resolve({
                  count: status === 'waiting' ? st.countWaiting : 0,
                  error: st.countError,
                }),
            };
          }
          return { eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) };
        },
      };
    },
  }),
}));

import { addToWaitlist, getWaitlistStatus } from '../../src/db/waitlist.js';

describe('waitlist DB', () => {
  beforeEach(() => {
    st.waitlistRows = [];
    st.lastUpsert = null;
    st.countWaiting = 0;
    st.upsertError = null;
    st.countError = null;
  });

  it('addToWaitlist normalizes email trim and lowercase', async () => {
    const row = await addToWaitlist('  User@Example.COM  ');
    expect(row.email).toBe('user@example.com');
    expect(st.lastUpsert).toMatchObject({ email: 'user@example.com', status: 'waiting' });
  });

  it('addToWaitlist is idempotent on same email (upsert onConflict)', async () => {
    await addToWaitlist('a@b.com');
    await addToWaitlist('A@B.COM');
    expect(st.waitlistRows.filter((r) => r.email === 'a@b.com')).toHaveLength(1);
  });

  it('addToWaitlist throws on Supabase error', async () => {
    st.upsertError = { message: 'duplicate' };
    await expect(addToWaitlist('x@y.com')).rejects.toEqual({ message: 'duplicate' });
  });

  it('getWaitlistStatus returns waiting count and open flag', async () => {
    st.countWaiting = 7;
    await expect(getWaitlistStatus()).resolves.toEqual({ count: 7, open: true });
  });

  it('getWaitlistStatus returns zero when no one waiting', async () => {
    st.countWaiting = 0;
    const status = await getWaitlistStatus();
    expect(status).toEqual({ count: 0, open: true });
  });

  it('getWaitlistStatus throws on count error', async () => {
    st.countError = { message: 'db down' };
    await expect(getWaitlistStatus()).rejects.toEqual({ message: 'db down' });
  });
});
