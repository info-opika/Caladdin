/**
 * CEO handoff smoke — full in-process booking journey (no browser).
 *
 * health → event type → public book page → guest select → confirmed session
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import * as client from '../../src/db/client.js';
import * as redis from '../../src/services/redis.js';
import type { SchedulingSessionRow } from '../../src/db/scheduling_sessions.js';
import type { CandidateSlot } from '../../src/core/adts.js';

const { GCAL } = vi.hoisted(() => ({ GCAL: '__CALADDIN_GCAL_CLAIMING__' }));

const mockSession = { userId: 'ceo-host-1', email: 'ceo@handoff.test' };
const mockCreate = vi.fn();
const mockPublicLookup = vi.fn();
const mockGetUserById = vi.fn();
const mockEnsureUsername = vi.fn();
const mockGetSession = vi.fn();
const mockClaim = vi.fn();
const mockFinalize = vi.fn();
const mockUpsertGuest = vi.fn();
const mockEnqueueReminders = vi.fn();
const mockGetAuth = vi.fn();
const mockCreateEvent = vi.fn();
const mockCheckOperationAllowed = vi.fn();
const mockHostNotify = vi.fn();
const mockDispatchWebhooks = vi.fn();

vi.mock('../../src/middleware/session.js', () => ({
  SESSION_COOKIE: 'caladdin_session',
  requireSession: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { session: typeof mockSession }).session = mockSession;
    next();
  },
  requireApiKey: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

vi.mock('../../src/db/event_types.js', () => ({
  createEventType: (...a: unknown[]) => mockCreate(...a),
  getPublicEventTypeByUsernameSlug: (...a: unknown[]) => mockPublicLookup(...a),
  listEventTypes: vi.fn().mockResolvedValue([]),
  getEventTypeById: vi.fn(),
  updateEventType: vi.fn(),
  deactivateEventType: vi.fn(),
}));

vi.mock('../../src/db/users.js', () => ({
  getUserById: (...a: unknown[]) => mockGetUserById(...a),
  ensureUsername: (...a: unknown[]) => mockEnsureUsername(...a),
}));

vi.mock('../../src/db/scheduling_sessions.js', () => ({
  GCAL_CLAIMING_SENTINEL: GCAL,
  getSchedulingSessionByToken: (...a: unknown[]) => mockGetSession(...a),
  claimSessionSlotForGcal: (...a: unknown[]) => mockClaim(...a),
  finalizeSessionAfterGcal: (...a: unknown[]) => mockFinalize(...a),
  revertSessionClaim: vi.fn(),
  appendProposedAlternative: vi.fn(),
  cancelConfirmedSession: vi.fn(),
  rescheduleConfirmedSession: vi.fn(),
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
  updateCalendarEvent: vi.fn(),
}));

vi.mock('../../src/services/gcal.js', () => ({
  gcalDeleteEvent: vi.fn(),
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

vi.mock('../../src/jobs/compensation-worker.js', () => ({
  startCompensationWorker: vi.fn(),
}));

vi.mock('../../src/jobs/session-expiry.js', () => ({
  startSessionExpiryWorker: vi.fn(),
  runSessionExpiry: vi.fn(),
}));

import { app } from '../../src/index.js';

const slot = (h: number): CandidateSlot => ({
  start: `2026-06-12T${String(h).padStart(2, '0')}:00:00-05:00`,
  end: `2026-06-12T${String(h + 1).padStart(2, '0')}:00:00-05:00`,
  adjacentEventCount: 0,
  energyScore: 0.85,
  createsFragment: false,
});

const sampleEventType = {
  id: 'et-ceo',
  userId: 'ceo-host-1',
  name: 'CEO Demo Call',
  slug: 'ceo-demo',
  durationMinutes: 30,
  description: 'Handoff demo booking',
  availabilityRules: {},
  active: true,
  createdAt: '2026-06-07T12:00:00.000Z',
  updatedAt: '2026-06-07T12:00:00.000Z',
};

function baseSession(over: Partial<SchedulingSessionRow> = {}): SchedulingSessionRow {
  const future = new Date(Date.now() + 86400_000 * 7).toISOString();
  return {
    id: 'sess-ceo-1',
    token: 'ceo-tok-demo',
    host_user_id: 'ceo-host-1',
    host_timezone: 'America/Chicago',
    invitee_email: null,
    invitee_label: null,
    duration_minutes: 30,
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

describe('CEO handoff smoke — full booking journey', () => {
  let store: { row: SchedulingSessionRow };

  beforeEach(() => {
    vi.spyOn(client, 'pingDb').mockResolvedValue('ok');
    vi.spyOn(redis, 'pingRedis').mockResolvedValue('skipped');
    vi.clearAllMocks();

    store = { row: baseSession() };

    mockGetUserById.mockResolvedValue({
      id: 'ceo-host-1',
      email: 'ceo@handoff.test',
      username: 'ceohost',
      display_name: 'CEO Host',
    });
    mockEnsureUsername.mockResolvedValue('ceohost');
    mockCreate.mockResolvedValue(sampleEventType);
    mockPublicLookup.mockResolvedValue({
      eventType: sampleEventType,
      hostName: 'CEO Host',
      hostTimezone: 'America/Chicago',
    });
    mockCheckOperationAllowed.mockResolvedValue({ allowed: true });
    mockGetAuth.mockResolvedValue({});
    mockCreateEvent.mockResolvedValue({ id: 'gcal-ceo-1' });
    mockUpsertGuest.mockResolvedValue({ id: 'br-ceo' });
    mockEnqueueReminders.mockResolvedValue(undefined);
    mockHostNotify.mockResolvedValue(undefined);
    mockDispatchWebhooks.mockResolvedValue({ delivered: 1, failed: 0 });

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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('chains health → event type → book page → guest booking → confirmation', async () => {
    const health = await request(app).get('/health');
    expect(health.status).toBe(200);
    expect(health.body.db).toBe('ok');

    const created = await request(app)
      .post('/api/event-types')
      .send({ name: 'CEO Demo Call', durationMinutes: 30, description: 'Handoff demo booking' });
    expect(created.status).toBe(201);
    expect(created.body.eventType.slug).toBe('ceo-demo');

    const bookPage = await request(app)
      .get('/book/ceohost/ceo-demo')
      .set('Accept', 'application/json');
    expect(bookPage.status).toBe(200);
    expect(bookPage.body.eventType.name).toBe('CEO Demo Call');

    const select = await request(app)
      .post('/s/ceo-tok-demo/select')
      .send({
        slotIndex: 0,
        guest: { name: 'Demo Guest', email: 'guest@handoff.test', notes: 'CEO demo' },
      });
    expect(select.status).toBe(200);
    expect(mockUpsertGuest).toHaveBeenCalled();
    expect(mockCreateEvent).toHaveBeenCalled();
    expect(mockFinalize).toHaveBeenCalled();
    expect(mockEnqueueReminders).toHaveBeenCalled();
    expect(store.row.status).toBe('confirmed');
    expect(store.row.google_event_id).toBe('gcal-ceo-1');
  });
});
