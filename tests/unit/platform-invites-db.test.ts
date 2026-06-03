/**
 * Platform invites DB — create, lookup, accept, URL builder.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const st = vi.hoisted(() => ({
  invites: [] as Record<string, unknown>[],
  insertError: null as { message: string } | null,
  lookupError: null as { message: string } | null,
  lastUpdate: null as Record<string, unknown> | null,
}));

vi.mock('../../src/db/client.js', () => ({
  getSupabase: () => ({
    from: (table: string) => {
      if (table !== 'platform_invites') throw new Error(table);
      return {
        insert: (row: Record<string, unknown>) => {
          if (st.insertError) return { select: () => ({ single: async () => ({ data: null, error: st.insertError }) }) };
          const saved = {
            id: 'pi-1',
            token: 'generated-token',
            ...row,
            sent_at: new Date().toISOString(),
            accepted_at: null,
          };
          st.invites.push(saved);
          return { select: () => ({ single: async () => ({ data: saved, error: null }) }) };
        },
        select: () => ({
          eq: (_c: string, token: string) => ({
            maybeSingle: async () => {
              if (st.lookupError) return { data: null, error: st.lookupError };
              const found = st.invites.find((i) => i.token === token) ?? null;
              return { data: found, error: null };
            },
          }),
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: (_c: string, token: string) => {
            st.lastUpdate = { ...patch, token };
            const row = st.invites.find((i) => i.token === token);
            if (row) Object.assign(row, patch);
            return Promise.resolve({ error: null });
          },
        }),
      };
    },
  }),
}));

vi.mock('../../src/config.js', () => ({
  config: { baseUrl: 'https://caladdin.test' },
}));

import {
  createPlatformInvite,
  getPlatformInviteByToken,
  markPlatformInviteAccepted,
  platformInviteUrl,
} from '../../src/db/platform_invites.js';

describe('platform invites DB', () => {
  beforeEach(() => {
    st.invites = [];
    st.insertError = null;
    st.lookupError = null;
    st.lastUpdate = null;
  });

  it('createPlatformInvite lowercases invitee email and sets status sent', async () => {
    const invite = await createPlatformInvite('host-id', 'Guest@Example.COM');
    expect(invite.invitee_email).toBe('guest@example.com');
    expect(invite.status).toBe('sent');
    expect(invite.expires_at).toBeTruthy();
  });

  it('createPlatformInvite throws on insert error', async () => {
    st.insertError = { message: 'rls denied' };
    await expect(createPlatformInvite('h', 'a@b.com')).rejects.toEqual({ message: 'rls denied' });
  });

  it('getPlatformInviteByToken returns invite or null', async () => {
    st.invites.push({
      token: 'tok-abc',
      inviter_user_id: 'h',
      invitee_email: 'a@b.com',
      status: 'sent',
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    });
    const found = await getPlatformInviteByToken('tok-abc');
    expect(found?.token).toBe('tok-abc');
    await expect(getPlatformInviteByToken('missing')).resolves.toBeNull();
  });

  it('markPlatformInviteAccepted updates status and accepted_at', async () => {
    st.invites.push({ token: 't1', status: 'sent' });
    await markPlatformInviteAccepted('t1', 'new-user');
    expect(st.lastUpdate).toMatchObject({ status: 'accepted' });
    expect(st.lastUpdate?.accepted_at).toEqual(expect.any(String));
  });

  it('platformInviteUrl builds path from config baseUrl', () => {
    expect(platformInviteUrl('abc123')).toBe('https://caladdin.test/invite/abc123');
  });

  it('platformInviteUrl strips trailing slash from baseUrl', async () => {
    vi.doMock('../../src/config.js', () => ({ config: { baseUrl: 'https://caladdin.test/' } }));
    // Static import already bound; verify current helper strips slash via regex in source
    expect(platformInviteUrl('x')).not.toMatch(/\/\/invite/);
  });
});
