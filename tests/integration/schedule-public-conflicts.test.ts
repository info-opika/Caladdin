import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockGetSession = vi.fn();
const mockGetGrant = vi.fn();
const mockReplaceSlots = vi.fn();
const mockMarkGrant = vi.fn();

vi.mock('../../src/db/scheduling_sessions.js', () => ({
  GCAL_CLAIMING_SENTINEL: '__CALADDIN_GCAL_CLAIMING__',
  getSchedulingSessionByToken: (...a: unknown[]) => mockGetSession(...a),
  claimSessionSlotForGcal: vi.fn(),
  finalizeSessionAfterGcal: vi.fn(),
  revertSessionClaim: vi.fn(),
  appendProposedAlternative: vi.fn(),
  cancelConfirmedSession: vi.fn(),
  rescheduleConfirmedSession: vi.fn(),
  replaceSessionOfferedSlots: (...a: unknown[]) => mockReplaceSlots(...a),
}));

vi.mock('../../src/db/invite_calendar_grants.js', () => ({
  getGrantBySessionId: (...a: unknown[]) => mockGetGrant(...a),
  revokeGrantForSession: vi.fn(),
}));

vi.mock('../../src/services/invitee_slot_conflicts.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/invitee_slot_conflicts.js')>();
  return {
    ...actual,
    markGrantInviteeConflicts: (...a: unknown[]) => mockMarkGrant(...a),
  };
});

vi.mock('../../src/db/booking_responses.js', () => ({
  upsertBookingResponse: vi.fn(),
  validateGuestIntake: () => null,
}));

vi.mock('../../src/db/booking_reminders.js', () => ({
  enqueueRemindersForSession: vi.fn(),
}));

vi.mock('../../src/services/auth_service.js', () => ({
  getAuthService: () => ({ getClientForUser: vi.fn().mockResolvedValue({}) }),
}));

vi.mock('../../src/services/calendar.js', () => ({
  createCalendarEvent: vi.fn(),
  updateCalendarEvent: vi.fn(),
}));

vi.mock('../../src/services/gcal.js', () => ({
  gcalDeleteEvent: vi.fn(),
}));

vi.mock('../../src/db/users.js', () => ({
  getPolicy: vi.fn().mockResolvedValue({ workingHoursStart: '09:00', workingHoursEnd: '18:00' }),
}));

vi.mock('../../src/db/events.js', () => ({
  listEvents: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/services/notifications.js', () => ({
  sendHostBookingNotification: vi.fn(),
}));

vi.mock('../../src/services/webhooks.js', () => ({
  dispatchBookingWebhooks: vi.fn(),
}));

vi.mock('../../src/db/usage_events.js', () => ({
  recordUsageEvent: vi.fn(),
}));

vi.mock('../../src/pilot/pilot_controls.js', () => ({
  checkOperationAllowed: vi.fn().mockResolvedValue({ allowed: true }),
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

vi.mock('../../src/routes/invite_grant_auth.js', () => ({
  computeMutualSlotsForSession: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/services/calendar_api.js', () => ({
  listBusyFromGCal: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/services/mutual_slot_engine.js', () => ({
  findMutualSlots: vi.fn().mockReturnValue([
    { start: '2026-06-03T10:00:00-05:00', end: '2026-06-03T11:00:00-05:00' },
    { start: '2026-06-03T14:00:00-05:00', end: '2026-06-03T15:00:00-05:00' },
  ]),
}));

import schedulePublicRoutes from '../../src/routes/schedule_public.js';

function app() {
  const x = express();
  x.use(express.json());
  x.use(schedulePublicRoutes);
  return x;
}

describe('schedule-public invitee grant conflicts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReplaceSlots.mockResolvedValue(undefined);
    mockMarkGrant.mockResolvedValue([{ inviteeConflict: true }, { inviteeConflict: false }]);
  });

  it('renders busy slot state when grant is active and invitee conflicts', async () => {
    const future = new Date(Date.now() + 86400_000).toISOString();
    mockGetSession.mockResolvedValue({
      id: 's1',
      token: 'tok123',
      host_user_id: '22222222-2222-4222-8222-222222222222',
      host_timezone: 'America/Chicago',
      invitee_email: 'guest1@example.test',
      duration_minutes: 60,
      offered_slots: [
        { start: '2026-06-02T10:00:00-05:00', end: '2026-06-02T11:00:00-05:00' },
        { start: '2026-06-02T14:00:00-05:00', end: '2026-06-02T15:00:00-05:00' },
      ],
      status: 'pending',
      expires_at: future,
      host_name: 'Kanth',
    });
    mockGetGrant.mockResolvedValue({
      id: 'g1',
      status: 'active',
      oauth_access_token: 'tok',
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    });

    const res = await request(app()).get('/s/tok123');
    expect(res.status).toBe(200);
    expect(res.text).toContain('is-busy');
    expect(res.text).toContain("You&apos;re busy at this hour");
    expect(res.text).toContain('data-timezone="America/Chicago"');
    expect(mockMarkGrant).toHaveBeenCalled();
  });

  it('next-slots returns slotLabels and slotMeta when grant is active', async () => {
    const future = new Date(Date.now() + 86400_000).toISOString();
    mockGetSession.mockResolvedValue({
      id: 's1',
      token: 'tok123',
      host_user_id: '22222222-2222-4222-8222-222222222222',
      host_timezone: 'America/Chicago',
      invitee_email: 'guest1@example.test',
      duration_minutes: 60,
      offered_slots: [],
      status: 'pending',
      expires_at: future,
    });
    mockGetGrant.mockResolvedValue({
      id: 'g1',
      status: 'active',
      oauth_access_token: 'tok',
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    });

    const res = await request(app()).post('/s/tok123/next-slots');
    expect(res.status).toBe(200);
    expect(res.body.slotLabels).toHaveLength(2);
    expect(res.body.timezone).toBe('America/Chicago');
    expect(res.body.slotMeta).toEqual([
      { inviteeConflict: true },
      { inviteeConflict: false },
    ]);
  });
});
