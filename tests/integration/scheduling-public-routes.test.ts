import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import schedulePublicRoutes from '../../src/routes/schedule_public.js';
import type { SchedulingSessionRow } from '../../src/db/scheduling_sessions.js';
import type { CandidateSlot } from '../../src/core/adts.js';

const { GCAL } = vi.hoisted(() => ({ GCAL: '__CALADDIN_GCAL_CLAIMING__' }));

const mockGetSession = vi.fn();
const mockClaim = vi.fn();
const mockFinalize = vi.fn();
const mockRevert = vi.fn();
const mockAppendAlt = vi.fn();
const mockGetAuth = vi.fn();
const mockCreateEvent = vi.fn();
const mockGcalDelete = vi.fn();

vi.mock('../../src/db/scheduling_sessions.js', () => ({
  GCAL_CLAIMING_SENTINEL: GCAL,
  getSchedulingSessionByToken: (...a: unknown[]) => mockGetSession(...a),
  claimSessionSlotForGcal: (...a: unknown[]) => mockClaim(...a),
  finalizeSessionAfterGcal: (...a: unknown[]) => mockFinalize(...a),
  revertSessionClaim: (...a: unknown[]) => mockRevert(...a),
  appendProposedAlternative: (...a: unknown[]) => mockAppendAlt(...a),
}));

vi.mock('../../src/db/booking_responses.js', () => ({
  upsertBookingResponse: vi.fn().mockResolvedValue({ id: 'br-1' }),
  validateGuestIntake: (guest: { name?: string; email?: string } | undefined) => {
    if (!guest?.name?.trim()) return 'name_required';
    if (!guest?.email?.trim()) return 'email_required';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guest.email.trim())) return 'email_invalid';
    return null;
  },
}));

vi.mock('../../src/db/booking_reminders.js', () => ({
  enqueueRemindersForSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/services/auth_service.js', () => ({
  getAuthService: () => ({ getClientForUser: mockGetAuth }),
}));

vi.mock('../../src/services/calendar.js', () => ({
  createCalendarEvent: (...a: unknown[]) => mockCreateEvent(...a),
}));

vi.mock('../../src/services/gcal.js', () => ({
  gcalDeleteEvent: (...a: unknown[]) => mockGcalDelete(...a),
}));

const mockCheckOperationAllowed = vi.fn();
const mockGetPolicy = vi.fn();
const mockListEvents = vi.fn();

vi.mock('../../src/db/users.js', () => ({
  getPolicy: (...args: unknown[]) => mockGetPolicy(...args),
  getUserById: vi.fn().mockResolvedValue({ id: '22222222-2222-4222-8222-222222222222', email: 'host@test.com' }),
}));

vi.mock('../../src/db/events.js', () => ({
  listEvents: (...args: unknown[]) => mockListEvents(...args),
}));

vi.mock('../../src/services/notifications.js', () => ({
  sendHostBookingNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/services/webhooks.js', () => ({
  dispatchBookingWebhooks: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/db/usage_events.js', () => ({
  recordUsageEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/pilot/pilot_controls.js', () => ({
  checkOperationAllowed: (...args: unknown[]) => mockCheckOperationAllowed(...args),
}));

function app() {
  const x = express();
  x.use(express.json());
  x.use(schedulePublicRoutes);
  return x;
}

const slot = (h: number): CandidateSlot => ({
  start: `2026-06-02T${String(h).padStart(2, '0')}:00:00-05:00`,
  end: `2026-06-02T${String(h + 1).padStart(2, '0')}:00:00-05:00`,
  adjacentEventCount: 0,
  energyScore: 0.8,
  createsFragment: false,
});

function baseSession(over: Partial<SchedulingSessionRow> = {}): SchedulingSessionRow {
  const future = new Date(Date.now() + 86400_000).toISOString();
  return {
    id: 's1',
    token: 'tok123',
    host_user_id: '22222222-2222-4222-8222-222222222222',
    host_timezone: 'America/Chicago',
    invitee_email: 'guest1@example.test',
    invitee_label: null,
    duration_minutes: 60,
    offered_slots: [slot(10), slot(14)],
    selected_slot: null,
    google_event_id: null,
    proposed_alternatives: [],
    status: 'pending',
    expires_at: future,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...over,
  };
}

const selectBody = {
  slotIndex: 0,
  guest: { name: 'Guest User', email: 'guest@example.com' },
};

describe('Public scheduling routes', () => {
  let store: { row: SchedulingSessionRow };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckOperationAllowed.mockResolvedValue({ allowed: true });
    mockGetPolicy.mockResolvedValue({ shareAvailabilityOnInvite: true });
    mockListEvents.mockResolvedValue([]);
    store = { row: baseSession() };
    mockGetAuth.mockResolvedValue({ request: vi.fn() });
    mockCreateEvent.mockResolvedValue({ id: 'gcal-event-99' });
    mockGcalDelete.mockResolvedValue(undefined);
    mockFinalize.mockResolvedValue(true);
    mockRevert.mockResolvedValue(undefined);

    mockGetSession.mockImplementation(() => Promise.resolve({ ...store.row }));
    mockClaim.mockImplementation(
      async ({ slotIndex: si }: { token: string; slotIndex: 0 | 1 }) => {
        if (store.row.status !== 'pending' || store.row.google_event_id != null) {
          return false;
        }
        const slots = store.row.offered_slots as CandidateSlot[];
        const sel = slots[si];
        if (!sel) return false;
        store.row = { ...store.row, selected_slot: sel, google_event_id: GCAL };
        return true;
      }
    );
    mockFinalize.mockImplementation(async ({ googleEventId }: { token: string; googleEventId: string }) => {
      if (store.row.google_event_id !== GCAL) return false;
      store.row = { ...store.row, status: 'confirmed' as const, google_event_id: googleEventId };
      return true;
    });
    mockRevert.mockImplementation(async () => {
      if (store.row.google_event_id !== GCAL) return;
      store.row = { ...store.row, status: 'pending' as const, selected_slot: null, google_event_id: null };
    });
  });

  it('GET /s/:token renders polished invitee page with exactly two slot cards', async () => {
    const res = await request(app()).get('/s/tok123');
    expect(res.status).toBe(200);
    expect(res.type).toMatch(/html/);
    expect(res.text).toContain('Two thoughtful times, picked for you.');
    expect(res.text).toContain('Your host used Caladdin to avoid the calendar back-and-forth.');
    expect(res.text).toContain('Pick one, or suggest another time.');
    expect(res.text).toContain('Choose this time');
    expect((res.text.match(/class="card slot-card"/g) || []).length).toBe(2);
    expect(res.text).toContain('Option 1');
    expect(res.text).toContain('Option 2');
    expect(res.text).toContain('Suggest another time');
    expect(res.text).toContain('guest1@example.test');
  });

  it('GET /s/:token uses host-name hero copy when host name exists', async () => {
    mockGetSession.mockResolvedValueOnce({
      ...baseSession(),
      host_name: 'Kanth',
    });
    const res = await request(app()).get('/s/tok123');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Kanth found two thoughtful times for you.');
    expect(res.text).toContain('Kanth used Caladdin to avoid the calendar back-and-forth.');
  });

  it('GET /s/:token shows expired copy when past expires_at', async () => {
    store.row = baseSession({ expires_at: new Date(Date.now() - 1000).toISOString(), status: 'pending' });
    const res = await request(app()).get('/s/tok123');
    expect(res.status).toBe(200);
    expect(res.text).toContain('This scheduling link has expired.');
    expect(res.text).toContain('Ask your host for a fresh link.');
    expect(res.text).not.toContain('Choose this time');
  });

  it('GET /s/:token shows confirmed state', async () => {
    store.row = baseSession({
      status: 'confirmed',
      selected_slot: slot(10),
      google_event_id: 'e1',
    });
    const res = await request(app()).get('/s/tok123');
    expect(res.text).toContain('You’re all set.');
    expect(res.text).toContain('will see this on the calendar.');
    expect(res.text).toContain('A calendar invite should follow.');
  });

  it('GET /s/:token shows no-slots human copy when fewer than two slots', async () => {
    store.row = baseSession({ offered_slots: [slot(10)] });
    const res = await request(app()).get('/s/tok123');
    expect(res.status).toBe(200);
    expect(res.text).toContain('These options are no longer available.');
    expect(res.text).toContain('Ask your host for a fresh link.');
    expect(res.text).toContain('Suggest another time');
  });

  it('POST /s/:token/select claims, creates calendar event, then finalizes', async () => {
    const res = await request(app()).post('/s/tok123/select').send(selectBody);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockCheckOperationAllowed).toHaveBeenCalledWith('calendar_write');
    expect(mockCreateEvent).toHaveBeenCalledTimes(1);
    expect(mockClaim).toHaveBeenCalled();
    expect(mockFinalize).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'tok123', googleEventId: 'gcal-event-99' })
    );
  });

  it('POST /s/:token/select returns 503 when kill switch blocks calendar writes', async () => {
    mockCheckOperationAllowed.mockResolvedValueOnce({
      allowed: false,
      reason: 'kill_switch_active',
      message: 'Caladdin is temporarily paused. Calendar operations are unavailable.',
    });
    const res = await request(app()).post('/s/tok123/select').send(selectBody);
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('paused');
    expect(mockClaim).not.toHaveBeenCalled();
    expect(mockCreateEvent).not.toHaveBeenCalled();
  });

  it('POST /s/:token/select is idempotent when already confirmed same slot', async () => {
    const sel = slot(10);
    store.row = baseSession({
      status: 'confirmed',
      selected_slot: sel,
      google_event_id: 'existing-id',
      offered_slots: [sel, slot(14)],
    });
    const res = await request(app()).post('/s/tok123/select').send({ ...selectBody, slotIndex: 0 });
    expect(res.status).toBe(200);
    expect(res.body.idempotent).toBe(true);
    expect(mockCreateEvent).not.toHaveBeenCalled();
  });

  it('POST /s/:token/select returns 409 for different slot after confirm', async () => {
    store.row = baseSession({
      status: 'confirmed',
      selected_slot: slot(10),
      google_event_id: 'e',
    });
    const res = await request(app()).post('/s/tok123/select').send({ slotIndex: 1 });
    expect(res.status).toBe(409);
  });

  it('POST /s/:token/select: parallel selects same slot only create one GCal event', async () => {
    const a = request(app());
    const [r1, r2] = await Promise.all([
      a.post('/s/tok123/select').send(selectBody),
      a.post('/s/tok123/select').send(selectBody),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses[0]).toBe(200);
    expect(statuses[1]).toBe(200);
    const bodies = [r1.body, r2.body];
    const oneIdempotent = bodies.filter((b) => b.idempotent);
    const oneOk = bodies.filter((b) => b.ok && !b.idempotent);
    expect(mockCreateEvent).toHaveBeenCalledTimes(1);
    expect(oneIdempotent).toHaveLength(1);
    expect(oneOk).toHaveLength(1);
  });

  it('POST /s/:token/select: create failure after claim reverts and does not leave sentinel', async () => {
    mockCreateEvent.mockRejectedValueOnce(new Error('network'));
    const res = await request(app()).post('/s/tok123/select').send({ ...selectBody, slotIndex: 0 });
    expect(res.status).toBe(502);
    expect(mockRevert).toHaveBeenCalled();
    expect(store.row.google_event_id).toBeNull();
    expect(store.row.status).toBe('pending');
  });

  it('POST /s/:token/propose appends alternative', async () => {
    mockAppendAlt.mockResolvedValue(undefined);
    const res = await request(app()).post('/s/tok123/propose').send({
      proposedDate: '2026-06-03',
      proposedTimeWindow: '2-4pm',
      note: 'flexible',
    });
    expect(res.status).toBe(200);
    expect(mockAppendAlt).toHaveBeenCalled();
  });

  it('POST /s/:token/propose returns 409 when session already confirmed', async () => {
    store.row = baseSession({ status: 'confirmed', selected_slot: slot(10), google_event_id: 'e1' });
    const res = await request(app()).post('/s/tok123/propose').send({
      proposedDate: '2026-06-10',
      proposedTimeWindow: '1pm',
    });
    expect(res.status).toBe(409);
    expect(mockAppendAlt).not.toHaveBeenCalled();
  });

  it('GET /s/:token returns 404 with friendly message for invalid token', async () => {
    mockGetSession.mockResolvedValueOnce(null);
    const res = await request(app()).get('/s/invalidtoken000');
    expect(res.status).toBe(404);
    expect(res.type).toMatch(/html/);
    expect(res.text).toContain('Link not found');
    expect(res.text).toMatch(/invalid or expired/i);
    expect(res.text).toContain('ask the sender for a new link');
  });

  it('POST /s/:token/select returns 404 for invalid token', async () => {
    mockGetSession.mockResolvedValueOnce(null);
    const res = await request(app()).post('/s/badtoken/select').send(selectBody);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });

  it('POST /s/:token/propose returns 404 for invalid token', async () => {
    mockGetSession.mockResolvedValueOnce(null);
    const res = await request(app()).post('/s/badtoken/propose').send({
      proposedDate: '2026-06-10',
      proposedTimeWindow: '2pm',
    });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });

  it('GET /s/:token/calendar returns 403 when host disabled shareAvailabilityOnInvite (B07)', async () => {
    mockGetPolicy.mockResolvedValueOnce({ shareAvailabilityOnInvite: false });
    const res = await request(app()).get('/s/tok123/calendar');
    expect(res.status).toBe(403);
    expect(res.text).toMatch(/Calendar view unavailable/i);
    expect(mockListEvents).not.toHaveBeenCalled();
  });

  it('GET /s/:token/calendar renders host events when sharing enabled', async () => {
    mockListEvents.mockResolvedValueOnce([
      {
        start: new Date(Date.now() + 86400000).toISOString(),
        end: new Date(Date.now() + 90000000).toISOString(),
        status: 'confirmed',
        tier: 2,
        title: 'Team sync',
      },
    ]);
    const res = await request(app()).get('/s/tok123/calendar');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Team sync');
    expect(mockGetPolicy).toHaveBeenCalled();
  });
});
