/**
 * Team / round-robin booking — pickRoundRobinHost rotation (mocked Supabase).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const st = vi.hoisted(() => ({
  members: [] as { user_id: string; position: number }[],
  roundRobinIndex: 0,
  eventTypeId: 'et-team-1',
}));

vi.mock('../../src/db/client.js', () => ({
  getSupabase: () => ({
    from: (table: string) => {
      if (table === 'event_type_members') {
        return {
          select: () => ({
            eq: () => ({
              order: async () => ({ data: st.members, error: null }),
            }),
          }),
        };
      }
      if (table === 'event_types') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: { round_robin_index: st.roundRobinIndex },
                error: null,
              }),
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: () => {
              st.roundRobinIndex = patch.round_robin_index as number;
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      throw new Error(table);
    },
  }),
}));

import { pickRoundRobinHost } from '../../src/db/event_type_members.js';

describe('team round-robin booking', () => {
  beforeEach(() => {
    st.members = [
      { user_id: 'host-a', position: 0 },
      { user_id: 'host-b', position: 1 },
      { user_id: 'host-c', position: 2 },
    ];
    st.roundRobinIndex = 0;
  });

  it('returns owner when no members configured', async () => {
    st.members = [];
    const host = await pickRoundRobinHost(st.eventTypeId, 'owner-1');
    expect(host).toBe('owner-1');
  });

  it('rotates host across pool on successive picks', async () => {
    const first = await pickRoundRobinHost(st.eventTypeId, 'owner-1');
    expect(first).toBe('host-a');
    const second = await pickRoundRobinHost(st.eventTypeId, 'owner-1');
    expect(second).toBe('host-b');
    const third = await pickRoundRobinHost(st.eventTypeId, 'owner-1');
    expect(third).toBe('host-c');
    const wrap = await pickRoundRobinHost(st.eventTypeId, 'owner-1');
    expect(wrap).toBe('host-a');
  });
});
