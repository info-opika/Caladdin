import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import schedulePublicRoutes from '../../src/routes/schedule_public.js';
import type { SchedulingSessionRow } from '../../src/db/scheduling_sessions.js';
import type { CandidateSlot } from '../../src/core/adts.js';

const mockGetSession = vi.fn();
const mockGetGrant = vi.fn();

vi.mock('../../src/db/scheduling_sessions.js', () => ({
  GCAL_CLAIMING_SENTINEL: '__CALADDIN_GCAL_CLAIMING__',
  getSchedulingSessionByToken: (...a: unknown[]) => mockGetSession(...a),
  claimSessionSlotForGcal: vi.fn(),
  finalizeSessionAfterGcal: vi.fn(),
  revertSessionClaim: vi.fn(),
  appendProposedAlternative: vi.fn(),
  cancelConfirmedSession: vi.fn(),
  rescheduleConfirmedSession: vi.fn(),
}));

vi.mock('../../src/db/invite_calendar_grants.js', () => ({
  getGrantBySessionId: (...a: unknown[]) => mockGetGrant(...a),
  revokeGrantForSession: vi.fn(),
}));

vi.mock('../../src/db/booking_responses.js', () => ({
  upsertBookingResponse: vi.fn(),
  validateGuestIntake: () => null,
}));

vi.mock('../../src/db/booking_reminders.js', () => ({
  enqueueRemindersForSession: vi.fn(),
}));

vi.mock('../../src/services/auth_service.js', () => ({
  getAuthService: () => ({ getClientForUser: vi.fn() }),
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

describe('schedule-public v3 invitee HTML', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGrant.mockResolvedValue(null);
    mockGetSession.mockResolvedValue(baseSession({ host_name: 'Kanth' }));
  });

  it('renders branded invite page with slot options', async () => {
    const res = await request(app()).get('/s/tok123');
    expect(res.status).toBe(200);
    expect(res.type).toMatch(/html/);
    expect(res.text).toContain('invite.css');
    expect(res.text).toContain('tokens.css');
    expect(res.text).toContain('family=DM+Sans');
    expect(res.text).toContain('family=Fraunces');
    expect(res.text).toContain('theme-color" content="#d97706"');
    expect(res.text).toContain('invite-brand');
    expect(res.text).toContain('Caladdin');
    expect(res.text).toContain('Kanth is inviting you to a meeting.');
    expect(res.text).toContain('Find next common slot');
    expect(res.text).toContain('Type a preferred time');
    expect(res.text).toContain('Share your availability for this meeting only');
    expect((res.text.match(/class="slot-btn/g) || []).length).toBe(2);
    expect(res.text).toContain('data-timezone="America/Chicago"');

    expect(res.text).not.toContain('booking.css');
    expect(res.text).not.toContain('guest-intake');
    expect(res.text).not.toContain('Suggest another time');
    expect(res.text).not.toContain('Choose this time');
    expect(res.text).not.toContain('View Kanth');
  });

  it('shows grant window panel when grant is active', async () => {
    mockGetGrant.mockResolvedValueOnce({
      id: 'g1',
      scheduling_session_id: 's1',
      status: 'active',
      oauth_access_token: 'tok',
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    });
    const res = await request(app()).get('/s/tok123');
    expect(res.text).toContain('grant-window-panel');
    expect(res.text).toContain('Your calendar is connected for this meeting only');
    expect(res.text).not.toContain('Share your availability for this meeting only');
  });
});
