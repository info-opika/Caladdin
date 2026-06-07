import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratePolicy } from '../../../src/core/adts.js';

const st = vi.hoisted(() => ({
  users: [] as Record<string, unknown>[],
  policies: [] as Record<string, unknown>[],
}));

vi.mock('../../../src/db/client.js', () => ({
  getSupabase: () => ({
    from: (table: string) => {
      if (table === 'users') {
        return {
          select: () => ({
            eq: (_c: string, val: string) => ({
              maybeSingle: async () => {
                const row =
                  st.users.find((u) => u.id === val || u.email === val || u.username === val) ?? null;
                return { data: row, error: null };
              },
            }),
          }),
          upsert: (row: Record<string, unknown>) => ({
            select: () => ({
              single: async () => {
                const existing = st.users.find((u) => u.email === row.email);
                if (existing) Object.assign(existing, row);
                else st.users.push({ id: `u-${st.users.length + 1}`, ...row });
                return { data: st.users.at(-1), error: null };
              },
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: (_c: string, id: string) => ({
              select: () => ({
                single: async () => {
                  const row = st.users.find((u) => u.id === id);
                  if (row) Object.assign(row, patch);
                  return { data: row, error: null };
                },
              }),
            }),
          }),
        };
      }
      if (table === 'user_policies') {
        return {
          select: () => ({
            eq: (_c: string, userId: string) => ({
              maybeSingle: async () => ({
                data: st.policies.find((p) => p.user_id === userId) ?? null,
                error: null,
              }),
            }),
          }),
          upsert: (row: Record<string, unknown>) => {
            const idx = st.policies.findIndex((p) => p.user_id === row.user_id);
            if (idx >= 0) st.policies[idx] = row;
            else st.policies.push(row);
            return Promise.resolve({ error: null });
          },
        };
      }
      throw new Error(table);
    },
  }),
  setUserContext: async (userId: string) => {
    void userId;
    return (await import('../../../src/db/client.js')).getSupabase();
  },
}));

import {
  deriveUsernameFromEmail,
  ensureUsername,
  ensureDefaultPolicy,
  getUserByEmail,
  upsertUser,
} from '../../../src/db/users.js';

describe('users db', () => {
  beforeEach(() => {
    st.users = [];
    st.policies = [];
  });

  it('deriveUsernameFromEmail sanitizes local part', () => {
    expect(deriveUsernameFromEmail('Jane.Doe+tag@corp.com')).toBe('jane-doe-tag');
  });

  it('upsertUser creates user row', async () => {
    const user = await upsertUser({ email: 'host@example.com', display_name: 'Host' });
    expect(user.email).toBe('host@example.com');
    const found = await getUserByEmail('host@example.com');
    expect(found?.display_name).toBe('Host');
  });

  it('ensureDefaultPolicy creates policy when missing', async () => {
    const user = await upsertUser({ email: 'a@b.com' });
    const policy = await ensureDefaultPolicy(user.id);
    expect(policy.timezone).toBeTruthy();
    expect(st.policies.some((p) => p.user_id === user.id)).toBe(true);
  });

  it('ensureUsername allocates unique slug', async () => {
    st.users.push({ id: 'u1', email: 'host@example.com', username: 'host' });
    st.users.push({ id: 'u2', email: 'host2@example.com', username: null });
    const username = await ensureUsername('u2', 'host2@example.com');
    expect(username).toMatch(/^host2/);
  });

  it('migratePolicy fills defaults', () => {
    const p = migratePolicy({});
    expect(p.schemaVersion).toBe(1);
    expect(p.protectedBlocks).toEqual([]);
  });
});
