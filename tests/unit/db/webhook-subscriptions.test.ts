import { describe, it, expect, vi, beforeEach } from 'vitest';

const st = vi.hoisted(() => ({
  subs: [] as Record<string, unknown>[],
  userContext: '',
}));

function buildSelectChain(rows: Record<string, unknown>[]) {
  const filters: Record<string, unknown> = {};
  const applyFilters = () =>
    rows.filter((s) => Object.entries(filters).every(([k, v]) => s[k] === v));

  const chain = {
    eq: (col: string, val: unknown) => {
      filters[col] = val;
      return chain;
    },
    order: async () => ({ data: applyFilters(), error: null }),
    then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
      Promise.resolve({ data: applyFilters(), error: null }).then(resolve),
  };
  return chain;
}

vi.mock('../../../src/db/client.js', () => ({
  getSupabase: () => ({
    from: (table: string) => {
      if (table !== 'webhook_subscriptions') throw new Error(table);
      return {
        select: () => buildSelectChain(st.subs),
        insert: (row: Record<string, unknown>) => ({
          select: () => ({
            single: async () => {
              const saved = {
                id: `wh-${st.subs.length + 1}`,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                ...row,
              };
              st.subs.push(saved);
              return { data: saved, error: null };
            },
          }),
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: () => ({
            eq: () => ({
              select: () => ({
                maybeSingle: async () => {
                  const row = st.subs[0];
                  if (row) Object.assign(row, patch);
                  return { data: row, error: null };
                },
              }),
            }),
          }),
        }),
        delete: () => ({
          eq: () => ({
            eq: () => ({
              select: () => ({
                maybeSingle: async () => ({ data: { id: st.subs[0]?.id }, error: null }),
              }),
            }),
          }),
        }),
      };
    },
  }),
  setUserContext: async (userId: string) => {
    st.userContext = userId;
    return (await import('../../../src/db/client.js')).getSupabase();
  },
}));

import {
  createWebhookSubscription,
  listWebhookSubscriptions,
  listActiveWebhooksForEvent,
  generateWebhookSecret,
} from '../../../src/db/webhook_subscriptions.js';

describe('webhook_subscriptions db', () => {
  beforeEach(() => {
    st.subs = [];
    st.userContext = '';
  });

  it('generateWebhookSecret returns hex string', () => {
    expect(generateWebhookSecret()).toMatch(/^[a-f0-9]{48}$/);
  });

  it('create and list subscriptions for user', async () => {
    await createWebhookSubscription('host-1', {
      url: 'https://hooks.example.com/caladdin',
      events: ['booking.confirmed'],
    });
    const rows = await listWebhookSubscriptions('host-1');
    expect(rows).toHaveLength(1);
    expect(rows[0].url).toContain('hooks.example.com');
    expect(rows[0].events).toContain('booking.confirmed');
  });

  it('listActiveWebhooksForEvent filters by event type', async () => {
    st.subs.push({
      id: 'wh-1',
      user_id: 'host-1',
      url: 'https://a.test/h',
      secret: 'sec',
      events: ['booking.confirmed'],
      active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    st.subs.push({
      id: 'wh-2',
      user_id: 'host-1',
      url: 'https://b.test/h',
      secret: 'sec2',
      events: ['booking.cancelled'],
      active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const confirmed = await listActiveWebhooksForEvent('host-1', 'booking.confirmed');
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0].events).toContain('booking.confirmed');
  });
});
