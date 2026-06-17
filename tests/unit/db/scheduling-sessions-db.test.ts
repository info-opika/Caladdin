import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CandidateSlot } from '../../../src/core/adts.js';

const st = vi.hoisted(() => ({
  sessions: [] as Record<string, unknown>[],
}));

vi.mock('../../../src/db/client.js', () => ({
  getSupabase: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === 'claim_scheduling_slot_for_gcal') {
        const token = args.p_token as string;
        const row = st.sessions.find((s) => s.token === token);
        if (row) {
          row.google_event_id = '__CALADDIN_GCAL_CLAIMING__';
          row.status = 'pending';
        }
        return { data: true, error: null };
      }
      return { data: true, error: null };
    },
    from: (table: string) => {
      if (table !== 'scheduling_sessions') throw new Error(table);
      return {
        insert: (row: Record<string, unknown>) => ({
          select: () => ({
            single: async () => {
              const saved = {
                id: `sess-${st.sessions.length + 1}`,
                token: `tok-${st.sessions.length + 1}`,
                ...row,
              };
              st.sessions.push(saved);
              return { data: saved, error: null };
            },
          }),
        }),
        select: () => ({
          eq: (_c: string, token: string) => ({
            maybeSingle: async () => ({
              data: st.sessions.find((s) => s.token === token) ?? null,
              error: null,
            }),
            order: async () => ({ data: st.sessions, error: null }),
          }),
        }),
        update: (patch: Record<string, unknown>) => {
          const filters: Array<[string, unknown]> = [];

          const rowMatches = (s: Record<string, unknown>) =>
            filters.every(([col, val]) => {
              if (val === null) return s[col] == null;
              return s[col] === val;
            });

          const applyPatch = () => {
            const row = st.sessions.find(rowMatches);
            if (row) Object.assign(row, patch);
            return row ?? null;
          };

          const chain = {
            eq: (col: string, val: unknown) => {
              filters.push([col, val]);
              return chain;
            },
            is: (col: string, val: null) => {
              filters.push([col, val]);
              return chain;
            },
            select: () => ({
              maybeSingle: async () => ({ data: applyPatch(), error: null }),
            }),
            then: (
              resolve: (v: { error: null }) => void,
              reject?: (e: unknown) => void,
            ) => {
              applyPatch();
              return Promise.resolve({ error: null }).then(resolve, reject);
            },
          };

          return chain;
        },
      };
    },
  }),
}));

vi.mock('../../../src/config.js', () => ({
  config: { schedulingSessionHours: 72 },
}));

import {
  GCAL_CLAIMING_SENTINEL,
  createSchedulingSession,
  getSchedulingSessionByToken,
  claimSessionSlotForGcal,
  finalizeSessionAfterGcal,
  cancelConfirmedSession,
} from '../../../src/db/scheduling_sessions.js';

const slot = (): CandidateSlot => ({
  start: '2026-06-10T15:00:00-05:00',
  end: '2026-06-10T16:00:00-05:00',
  adjacentEventCount: 0,
  energyScore: 0.8,
  createsFragment: false,
});

describe('scheduling_sessions db', () => {
  beforeEach(() => {
    st.sessions = [];
  });

  it('createSchedulingSession stores offered slots', async () => {
    const session = await createSchedulingSession({
      hostUserId: 'host-1',
      slots: [{ start: slot().start, end: slot().end, score: 0.8 }],
      hostName: 'Host',
      durationMinutes: 60,
      offeredSlots: [slot(), { ...slot(), start: '2026-06-11T10:00:00-05:00', end: '2026-06-11T11:00:00-05:00' }],
    });
    expect(session.token).toMatch(/^tok-/);
    expect(session.status).toBe('pending');
  });

  it('claim → finalize booking flow', async () => {
    await createSchedulingSession({
      hostUserId: 'host-1',
      slots: [{ start: slot().start, end: slot().end }],
      offeredSlots: [slot(), { ...slot(), start: '2026-06-11T10:00:00-05:00', end: '2026-06-11T11:00:00-05:00' }],
    });
    const token = st.sessions[0].token as string;
    const claimed = await claimSessionSlotForGcal({ token, slotIndex: 0 });
    expect(claimed).toBe(true);

    const finalized = await finalizeSessionAfterGcal({ token, googleEventId: 'gcal-real-1' });
    expect(finalized).toBe(true);
    const done = await getSchedulingSessionByToken(token);
    expect(done?.status).toBe('confirmed');
    expect(done?.google_event_id).toBe('gcal-real-1');
  });

  it('cancelConfirmedSession marks cancelled', async () => {
    st.sessions.push({
      token: 'tok-x',
      status: 'confirmed',
      host_user_id: 'host-1',
      offered_slots: [slot()],
    });
    const ok = await cancelConfirmedSession('tok-x');
    expect(ok).toBe(true);
    const row = await getSchedulingSessionByToken('tok-x');
    expect(row?.status).toBe('cancelled');
  });
});
