import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import schedulePublicRoutes from '../../src/routes/schedule_public.js';
import { signGuestActionToken } from '../../src/core/guest-action-token.js';
import type { SchedulingSessionRow } from '../../src/db/scheduling_sessions.js';
import type { CandidateSlot } from '../../src/core/adts.js';

const { GCAL } = vi.hoisted(() => ({ GCAL: '__CALADDIN_GCAL_CLAIMING__' }));

const mockGetSession = vi.fn();
const mockClaim = vi.fn();
const mockFinalize = vi.fn();
const mockRevert = vi.fn();
const mockCancel = vi.fn();
const mockReschedule = vi.fn();
const mockUpsertGuest = vi.fn();
const mockEnqueueReminders = vi.fn();
const mockGetAuth = vi.fn();
const mockCreateEvent = vi.fn();
const mockUpdateEvent = vi.fn();
const mockGcalDelete = vi.fn();
const mockCheckOperationAllowed = vi.fn();
const mockHostNotify = vi.fn();
const mockDispatchWebhooks = vi.hoisted(() => vi.fn().mockResolvedValue({ delivered: 0, failed: 0 }));
const mockAppendProposed = vi.fn();

vi.mock('../../src/db/scheduling_sessions.js', () => ({
  GCAL_CLAIMING_SENTINEL: GCAL,
  getSchedulingSessionByToken: (...a: unknown[]) => mockGetSession(...a),
  claimSessionSlotForGcal: (...a: unknown[]) => mockClaim(...a),
  finalizeSessionAfterGcal: (...a: unknown[]) => mockFinalize(...a),
  revertSessionClaim: (...a: unknown[]) => mockRevert(...a),
  appendProposedAlternative: (...a: unknown[]) => mockAppendProposed(...a),
  cancelConfirmedSession: (...a: unknown[]) => mockCancel(...a),
  rescheduleConfirmedSession: (...a: unknown[]) => mockReschedule(...a),
}));

vi.mock('../../src/db/booking_responses.js', () => ({
  upsertBookingResponse: (...a: unknown[]) => mockUpsertGuest(...a),
  validateGuestIntake: (guest: { name?: string; email?: string } | undefined) => {
    if (!guest?.name?.trim()) return 'name_required';
    if (!guest?.email?.trim()) return 'email_required';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guest.email.trim())) return 'email_invalid';
    return null;
  },
}));

vi.mock('../../src/db/booking_reminders.js', () => ({
  enqueueRemindersForSession: (...a: unknown[]) => mockEnqueueReminders(...a),
}));

vi.mock('../../src/services/auth_service.js', () => ({
  getAuthService: () => ({ getClientForUser: mockGetAuth }),
}));

vi.mock('../../src/services/calendar.js', () => ({
  createCalendarEvent: (...a: unknown[]) => mockCreateEvent(...a),
  updateCalendarEvent: (...a: unknown[]) => mockUpdateEvent(...a),
}));

vi.mock('../../src/services/gcal.js', () => ({
  gcalDeleteEvent: (...a: unknown[]) => mockGcalDelete(...a),
}));

vi.mock('../../src/pilot/pilot_controls.js', () => ({
  checkOperationAllowed: (...args: unknown[]) => mockCheckOperationAllowed(...args),
}));

vi.mock('../../src/services/notifications.js', () => ({
  sendHostBookingNotification: (...a: unknown[]) => mockHostNotify(...a),
}));

vi.mock('../../src/services/webhooks.js', () => ({
  dispatchBookingWebhooks: (...a: unknown[]) => mockDispatchWebhooks(...a),
}));

vi.mock('../../src/db/usage_events.js', () => ({
  recordUsageEvent: vi.fn(),
}));

vi.mock('../../src/db/invite_calendar_grants.js', () => ({
  getGrantBySessionId: vi.fn().mockResolvedValue(null),
  revokeGrantForSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/db/client.js', () => ({
  getSupabase: () => ({
    from: () => ({
      update: () => ({
        eq: () => ({ eq: () => ({ error: null }) }),
      }),
    }),
  }),
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

const guestBody = {
  slotIndex: 0,
  guest: { name: 'Ada Lovelace', email: 'ada@example.com', notes: 'Hi', answers: { role: 'eng' } },
};

describe('guest lifecycle routes', () => {
  let store: { row: SchedulingSessionRow };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckOperationAllowed.mockResolvedValue({ allowed: true });
    store = { row: baseSession() };
    mockGetAuth.mockResolvedValue({});
    mockCreateEvent.mockResolvedValue({ id: 'gcal-event-99' });
    mockUpdateEvent.mockResolvedValue(undefined);
    mockGcalDelete.mockResolvedValue(undefined);
    mockFinalize.mockResolvedValue(true);
    mockRevert.mockResolvedValue(undefined);
    mockUpsertGuest.mockResolvedValue({ id: 'br-1' });
    mockEnqueueReminders.mockResolvedValue(undefined);
    mockCancel.mockResolvedValue(true);
    mockReschedule.mockResolvedValue(true);
    mockHostNotify.mockResolvedValue(true);
    mockDispatchWebhooks.mockResolvedValue({ delivered: 0, failed: 0 });
    mockAppendProposed.mockResolvedValue(undefined);

    mockGetSession.mockImplementation(() => Promise.resolve({ ...store.row }));
    mockClaim.mockImplementation(async ({ slotIndex: si }: { token: string; slotIndex: 0 | 1 }) => {
      if (store.row.status !== 'pending' || store.row.google_event_id != null) return false;
      const sel = store.row.offered_slots[si];
      if (!sel) return false;
      store.row = { ...store.row, selected_slot: sel, google_event_id: GCAL };
      return true;
    });
    mockFinalize.mockImplementation(async ({ googleEventId }: { token: string; googleEventId: string }) => {
      if (store.row.google_event_id !== GCAL) return false;
      store.row = { ...store.row, status: 'confirmed' as const, google_event_id: googleEventId };
      return true;
    });
  });

  it('POST /s/:token/select requires guest when session has no invitee email', async () => {
    store.row = baseSession({ invitee_email: null });
    const res = await request(app()).post('/s/tok123/select').send({ slotIndex: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('name_required');
    expect(mockClaim).not.toHaveBeenCalled();
  });

  it('POST /s/:token/select uses session invitee email without guest form', async () => {
    const res = await request(app()).post('/s/tok123/select').send({ slotIndex: 0 });
    expect(res.status).toBe(200);
    expect(mockUpsertGuest).toHaveBeenCalledWith({
      sessionId: 's1',
      guest: { name: 'guest1', email: 'guest1@example.test' },
    });
  });

  it('POST /s/:token/select stores guest intake before calendar write', async () => {
    const res = await request(app()).post('/s/tok123/select').send(guestBody);
    expect(res.status).toBe(200);
    expect(mockUpsertGuest).toHaveBeenCalledWith({
      sessionId: 's1',
      guest: guestBody.guest,
    });
    expect(mockCreateEvent).toHaveBeenCalled();
    expect(mockEnqueueReminders).toHaveBeenCalled();
  });

  it('POST /s/:token/cancel deletes GCal event and marks session cancelled', async () => {
    store.row = baseSession({
      status: 'confirmed',
      selected_slot: slot(10),
      google_event_id: 'gcal-1',
    });
    const actionToken = signGuestActionToken('tok123', 'cancel');
    const res = await request(app()).post('/s/tok123/cancel').send({ actionToken });
    expect(res.status).toBe(200);
    expect(mockGcalDelete).toHaveBeenCalled();
    expect(mockCancel).toHaveBeenCalledWith('tok123');
    expect(mockHostNotify).toHaveBeenCalled();
  });

  it('POST /s/:token/cancel rejects invalid action token', async () => {
    store.row = baseSession({
      status: 'confirmed',
      selected_slot: slot(10),
      google_event_id: 'gcal-1',
    });
    const res = await request(app()).post('/s/tok123/cancel').send({ actionToken: 'bad' });
    expect(res.status).toBe(403);
    expect(mockGcalDelete).not.toHaveBeenCalled();
  });

  it('POST /s/:token/reschedule updates slot with valid token', async () => {
    store.row = baseSession({
      status: 'confirmed',
      selected_slot: slot(10),
      google_event_id: 'gcal-1',
    });
    const actionToken = signGuestActionToken('tok123', 'reschedule');
    const res = await request(app())
      .post('/s/tok123/reschedule')
      .send({ actionToken, slotIndex: 1 });
    expect(res.status).toBe(200);
    expect(mockUpdateEvent).toHaveBeenCalled();
    expect(mockReschedule).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'tok123', slot: slot(14) }),
    );
    expect(mockEnqueueReminders).toHaveBeenCalled();
  });

  it('POST /s/:token/cancel is idempotent when already cancelled', async () => {
    store.row = baseSession({
      status: 'cancelled',
      selected_slot: slot(10),
      google_event_id: 'gcal-1',
    });
    const actionToken = signGuestActionToken('tok123', 'cancel');
    const res = await request(app()).post('/s/tok123/cancel').send({ actionToken });
    expect(res.status).toBe(200);
    expect(res.body.idempotent).toBe(true);
    expect(mockGcalDelete).not.toHaveBeenCalled();
  });

  it('POST /s/:token/cancel rejects pending session', async () => {
    const actionToken = signGuestActionToken('tok123', 'cancel');
    const res = await request(app()).post('/s/tok123/cancel').send({ actionToken });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('not_cancellable');
  });

  it('POST /s/:token/cancel returns 502 when GCal delete fails', async () => {
    store.row = baseSession({
      status: 'confirmed',
      selected_slot: slot(10),
      google_event_id: 'gcal-1',
    });
    mockGcalDelete.mockRejectedValueOnce(new Error('gcal down'));
    const actionToken = signGuestActionToken('tok123', 'cancel');
    const res = await request(app()).post('/s/tok123/cancel').send({ actionToken });
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('gcal_failed');
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it('POST /s/:token/reschedule rejects missing slot selection', async () => {
    store.row = baseSession({
      status: 'confirmed',
      selected_slot: slot(10),
      google_event_id: 'gcal-1',
    });
    const actionToken = signGuestActionToken('tok123', 'reschedule');
    const res = await request(app()).post('/s/tok123/reschedule').send({ actionToken });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('slot_required');
  });

  it('POST /s/:token/reschedule is idempotent for same slot', async () => {
    store.row = baseSession({
      status: 'confirmed',
      selected_slot: slot(10),
      google_event_id: 'gcal-1',
    });
    const actionToken = signGuestActionToken('tok123', 'reschedule');
    const res = await request(app())
      .post('/s/tok123/reschedule')
      .send({ actionToken, slotIndex: 0 });
    expect(res.status).toBe(200);
    expect(res.body.idempotent).toBe(true);
    expect(mockUpdateEvent).not.toHaveBeenCalled();
  });

  it('GET /s/:token/cancel renders confirmation page with valid token', async () => {
    store.row = baseSession({
      status: 'confirmed',
      selected_slot: slot(10),
      google_event_id: 'gcal-1',
    });
    const actionToken = signGuestActionToken('tok123', 'cancel');
    const res = await request(app()).get(`/s/tok123/cancel?actionToken=${encodeURIComponent(actionToken)}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.text).toContain('cancel meeting');
  });

  it('GET /s/:token/reschedule returns 403 for invalid token', async () => {
    store.row = baseSession({
      status: 'confirmed',
      selected_slot: slot(10),
      google_event_id: 'gcal-1',
    });
    const res = await request(app()).get('/s/tok123/reschedule?actionToken=bad');
    expect(res.status).toBe(403);
  });

  it('POST /s/:token/propose notifies host after storing alternative', async () => {
    store.row = baseSession({ status: 'pending' });
    mockAppendProposed.mockResolvedValueOnce(undefined);
    mockHostNotify.mockResolvedValueOnce(true);

    const res = await request(app()).post('/s/tok123/propose').send({
      proposedDate: '2026-06-15',
      proposedTimeWindow: 'morning',
      note: 'Prefer earlier',
    });

    expect(res.status).toBe(200);
    expect(mockAppendProposed).toHaveBeenCalled();
    expect(mockHostNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        hostUserId: store.row.host_user_id,
        sessionToken: 'tok123',
        kind: 'proposed',
        proposedDate: '2026-06-15',
      }),
    );
  });
});
