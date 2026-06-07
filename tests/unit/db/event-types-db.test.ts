/**
 * DB layer — event types CRUD + public lookup (mocked Supabase).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const st = vi.hoisted(() => ({
  eventTypes: [] as Record<string, unknown>[],
  users: [] as Record<string, unknown>[],
  nextEtId: 1,
}));

function chainFilter(rows: Record<string, unknown>[]) {
  const state = { rows: [...rows] };
  const api: Record<string, unknown> = {};
  const filterEq = (col: string, val: unknown) => {
    state.rows = state.rows.filter((r) => r[col] === val);
    return api;
  };
  api.eq = filterEq;
  api.order = () => api;
  api.maybeSingle = () => Promise.resolve({ data: state.rows[0] ?? null, error: null });
  api.then = (resolve: (v: unknown) => void) => {
    resolve({ data: state.rows, error: null });
  };
  return api;
}

vi.mock('../../../src/db/client.js', () => ({
  getSupabase: () => ({
    from: (table: string) => {
      if (table === 'users') {
        return {
          select: () => ({
            eq: (_c: string, username: string) => ({
              maybeSingle: async () => ({
                data: st.users.find((u) => u.username === username) ?? null,
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'event_types') {
        return {
          select: () => chainFilter(st.eventTypes),
        };
      }
      throw new Error(table);
    },
  }),
  setUserContext: async (userId: string) => ({
    from: (table: string) => {
      if (table !== 'event_types') throw new Error(table);
      const forUser = st.eventTypes.filter((e) => e.user_id === userId);
      return {
        select: () => chainFilter(forUser),
        insert: (row: Record<string, unknown>) => ({
          select: () => ({
            single: async () => {
              const saved = {
                id: `et-${st.nextEtId++}`,
                user_id: userId,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                active: true,
                round_robin_index: 0,
                scheduling_mode: 'single',
                availability_rules: {},
                ...row,
              };
              st.eventTypes.push(saved);
              return { data: saved, error: null };
            },
          }),
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: (_c: string, uid: string) => ({
            eq: (_c2: string, id: string) => ({
              select: () => ({
                maybeSingle: async () => {
                  const row = st.eventTypes.find((e) => e.id === id && e.user_id === uid);
                  if (row) Object.assign(row, patch);
                  return { data: row ?? null, error: null };
                },
              }),
            }),
          }),
        }),
      };
    },
  }),
}));

import {
  listEventTypes,
  getEventTypeById,
  createEventType,
  updateEventType,
  deactivateEventType,
  getPublicEventTypeByUsernameSlug,
} from '../../../src/db/event_types.js';

const USER = '11111111-1111-4111-8111-111111111111';

describe('event_types db', () => {
  beforeEach(() => {
    st.eventTypes = [];
    st.users = [{ id: USER, username: 'alex', display_name: 'Alex', timezone: 'America/Chicago' }];
    st.nextEtId = 1;
  });

  it('creates and lists active event types', async () => {
    await createEventType(USER, {
      name: 'Intro Call',
      slug: 'intro',
      durationMinutes: 30,
      schedulingMode: 'round_robin',
    });
    const list = await listEventTypes(USER);
    expect(list).toHaveLength(1);
    expect(list[0]?.schedulingMode).toBe('round_robin');
  });

  it('gets event type by id', async () => {
    const created = await createEventType(USER, { name: 'Sync', slug: 'sync', durationMinutes: 45 });
    const found = await getEventTypeById(USER, created.id);
    expect(found?.slug).toBe('sync');
  });

  it('updates and deactivates event types', async () => {
    const created = await createEventType(USER, { name: 'Old', slug: 'old', durationMinutes: 15 });
    const updated = await updateEventType(USER, created.id, { name: 'New name', durationMinutes: 20 });
    expect(updated?.name).toBe('New name');
    await deactivateEventType(USER, created.id);
    const active = await listEventTypes(USER, false);
    expect(active).toHaveLength(0);
    const all = await listEventTypes(USER, true);
    expect(all[0]?.active).toBe(false);
  });

  it('public lookup by username and slug', async () => {
    st.eventTypes.push({
      id: 'et-pub',
      user_id: USER,
      slug: 'strategy',
      name: 'Strategy',
      duration_minutes: 60,
      description: null,
      availability_rules: {},
      scheduling_mode: 'single',
      active: true,
      round_robin_index: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const pub = await getPublicEventTypeByUsernameSlug('alex', 'strategy');
    expect(pub?.hostName).toBe('Alex');
    expect(pub?.eventType.slug).toBe('strategy');
    expect(await getPublicEventTypeByUsernameSlug('missing', 'x')).toBeNull();
  });
});
