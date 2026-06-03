/**
 * LC6 v9.9 — Public scheduling engine fidelity.
 * Real Express routes (`schedule_public`) + E2E persistence (`scheduling_sessions` delegates to
 * in-memory store with mutex-serialized claims). No mock of `claimSessionSlotForGcal` / session getters.
 */
process.env.CALADDIN_E2E = '1';

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { resetE2EState } from '../../src/e2e/runtime.js';
import { insertSchedulingSession, getSchedulingSessionByToken } from '../../src/db/scheduling_sessions.js';
import { e2eSeedSession } from '../../src/e2e/scheduling_memory.js';
import schedulePublicRoutes from '../../src/routes/schedule_public.js';
import type { CandidateSlot } from '../../src/core/adts.js';

function app() {
  const x = express();
  x.use(express.json());
  x.use(schedulePublicRoutes);
  return x;
}

const hostId = '77777777-7777-4777-8777-777777777777';

function slotChicago(hStart: number, hEnd: number): CandidateSlot {
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    start: `2026-06-02T${pad(hStart)}:00:00-05:00`,
    end: `2026-06-02T${pad(hEnd)}:00:00-05:00`,
    adjacentEventCount: 0,
    energyScore: 0.8,
    createsFragment: false,
  };
}

afterAll(() => {
  delete process.env.CALADDIN_E2E;
});

describe('LC6 scheduling fidelity (E2E store + real routes)', () => {
  beforeEach(() => {
    resetE2EState();
  });

  it('hostile: parallel same slot → one non-idempotent 200, one idempotent 200; single googleEventId', async () => {
    const { token } = await insertSchedulingSession({
      hostUserId: hostId,
      hostTimezone: 'America/Chicago',
      inviteeEmail: 'g@example.test',
      durationMinutes: 30,
      offeredSlots: [slotChicago(10, 11), slotChicago(14, 15)],
    });
    const a = app();
    const [r1, r2] = await Promise.all([
      request(a).post(`/s/${token}/select`).send({ slotIndex: 0 }),
      request(a).post(`/s/${token}/select`).send({ slotIndex: 0 }),
    ]);
    expect([r1.status, r2.status].every((s) => s === 200)).toBe(true);
    const idem = [r1, r2].filter((r) => r.body.idempotent);
    const fresh = [r1, r2].filter((r) => r.body.ok && !r.body.idempotent);
    expect(idem).toHaveLength(1);
    expect(fresh).toHaveLength(1);
    expect(idem[0]!.body.googleEventId).toBe(fresh[0]!.body.googleEventId);
  });

  it('hostile: sequential double-click replay same endpoint after confirm → both idempotent', async () => {
    const { token } = await insertSchedulingSession({
      hostUserId: hostId,
      hostTimezone: 'America/Chicago',
      durationMinutes: 30,
      offeredSlots: [slotChicago(10, 11), slotChicago(14, 15)],
    });
    const a = app();
    const first = await request(a).post(`/s/${token}/select`).send({ slotIndex: 1 });
    expect(first.status).toBe(200);
    const second = await request(a).post(`/s/${token}/select`).send({ slotIndex: 1 });
    expect(second.status).toBe(200);
    expect(second.body.idempotent).toBe(true);
    expect(second.body.googleEventId).toBe(first.body.googleEventId);
  });

  it('hostile: parallel different slots → exactly one success; loser 409 other_slot_reserving', async () => {
    const { token } = await insertSchedulingSession({
      hostUserId: hostId,
      hostTimezone: 'America/Chicago',
      durationMinutes: 30,
      offeredSlots: [slotChicago(10, 11), slotChicago(14, 15)],
    });
    const a = app();
    const [r0, r1] = await Promise.all([
      request(a).post(`/s/${token}/select`).send({ slotIndex: 0 }),
      request(a).post(`/s/${token}/select`).send({ slotIndex: 1 }),
    ]);
    const successes = [r0, r1].filter((r) => r.status === 200);
    expect(successes).toHaveLength(1);
    const loser = [r0, r1].find((r) => r.status !== 200);
    expect(loser?.status).toBe(409);
    expect(['other_slot_reserving', 'already_confirmed']).toContain(loser?.body.error);
  });

  it('hostile: expired token → POST select 410', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const { token } = await insertSchedulingSession({
      hostUserId: hostId,
      hostTimezone: 'America/Chicago',
      durationMinutes: 30,
      offeredSlots: [slotChicago(10, 11), slotChicago(14, 15)],
      expiresAt: past,
    });
    const res = await request(app()).post(`/s/${token}/select`).send({ slotIndex: 0 });
    expect(res.status).toBe(410);
    expect(res.body.error).toBe('expired');
  });

  it('stale UI / offered_slots mutation: books DB slot at index, not stale client preview', async () => {
    const staleA = slotChicago(10, 11);
    const sharedB = slotChicago(14, 15);
    const canonicalC = slotChicago(11, 12);
    const { token } = await insertSchedulingSession({
      hostUserId: hostId,
      hostTimezone: 'America/Chicago',
      durationMinutes: 30,
      offeredSlots: [staleA, sharedB],
    });
    const cur = await getSchedulingSessionByToken(token);
    expect(cur).not.toBeNull();
    e2eSeedSession({
      ...cur!,
      offered_slots: [canonicalC, sharedB],
    });
    const res = await request(app()).post(`/s/${token}/select`).send({ slotIndex: 0 });
    expect(res.status).toBe(200);
    const after = await getSchedulingSessionByToken(token);
    expect(after!.selected_slot!.start).toBe(canonicalC.start);
    expect(after!.selected_slot!.start).not.toBe(staleA.start);
  });

  it('public POST /propose on valid pending session → 200 and row gains alternative', async () => {
    const { token } = await insertSchedulingSession({
      hostUserId: hostId,
      hostTimezone: 'America/Chicago',
      durationMinutes: 30,
      offeredSlots: [slotChicago(10, 11), slotChicago(14, 15)],
    });
    const res = await request(app())
      .post(`/s/${token}/propose`)
      .send({ proposedDate: 'invitee-suggestion', proposedTimeWindow: 'Thursday after 3pm', note: 'ping' });
    expect(res.status).toBe(200);
    const row = await getSchedulingSessionByToken(token);
    expect(row!.proposed_alternatives?.length).toBe(1);
    expect(row!.proposed_alternatives![0]!.proposedTimeWindow).toContain('Thursday');
  });

  it('token mapping: unknown select token → 404 not_found', async () => {
    const res = await request(app()).post(`/s/definitely-not-a-session-token/select`).send({ slotIndex: 0 });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });

  it('malformed slotIndex (out of range) → 400 invalid_slot', async () => {
    const { token } = await insertSchedulingSession({
      hostUserId: hostId,
      hostTimezone: 'America/Chicago',
      durationMinutes: 30,
      offeredSlots: [slotChicago(10, 11), slotChicago(14, 15)],
    });
    const res = await request(app()).post(`/s/${token}/select`).send({ slotIndex: 3 });
    expect(res.status).toBe(400);
  });

  it('timezone / labeling: host Europe/London, GET invitee page 200 with two cards', async () => {
    const { token } = await insertSchedulingSession({
      hostUserId: hostId,
      hostTimezone: 'Europe/London',
      durationMinutes: 30,
      offeredSlots: [
        {
          start: '2026-06-15T14:00:00+01:00',
          end: '2026-06-15T15:00:00+01:00',
          adjacentEventCount: 0,
          energyScore: 0.8,
          createsFragment: false,
        },
        {
          start: '2026-06-15T16:00:00+01:00',
          end: '2026-06-15T17:00:00+01:00',
          adjacentEventCount: 0,
          energyScore: 0.8,
          createsFragment: false,
        },
      ],
    });
    const html = await request(app()).get(`/s/${token}`);
    expect(html.status).toBe(200);
    expect((html.text.match(/class="card slot-card"/g) || []).length).toBe(2);
  });

  it('DST-adjacent instant renders: spring forward window (US host) still serves two options', async () => {
    const { token } = await insertSchedulingSession({
      hostUserId: hostId,
      hostTimezone: 'America/Chicago',
      durationMinutes: 30,
      offeredSlots: [
        {
          start: '2026-03-09T15:00:00-05:00',
          end: '2026-03-09T16:00:00-05:00',
          adjacentEventCount: 0,
          energyScore: 0.8,
          createsFragment: false,
        },
        {
          start: '2026-03-10T15:00:00-05:00',
          end: '2026-03-10T16:00:00-05:00',
          adjacentEventCount: 0,
          energyScore: 0.8,
          createsFragment: false,
        },
      ],
    });
    const html = await request(app()).get(`/s/${token}`);
    expect(html.status).toBe(200);
    expect(html.text).toContain('Option 1');
    expect(html.text).toContain('Option 2');
  });
});
