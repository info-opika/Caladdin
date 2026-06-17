import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import schedulePublicRoutes from '../../src/routes/schedule_public.js';
import type { SchedulingSessionRow } from '../../src/db/scheduling_sessions.js';
import type { InviteCalendarGrantRow } from '../../src/db/invite_calendar_grants.js';

const mockGetSession = vi.fn();
const mockGetGrant = vi.fn();
const mockGetAuth = vi.fn();
const mockListBusy = vi.fn();
const mockFindMutualSlots = vi.fn();
const mockComputeMutual = vi.fn();

vi.mock('../../src/db/scheduling_sessions.js', () => ({
  GCAL_CLAIMING_SENTINEL: '__CALADDIN_GCAL_CLAIMING__',
  getSchedulingSessionByToken: (...a: unknown[]) => mockGetSession(...a),
  replaceSessionOfferedSlots: vi.fn().mockResolvedValue(undefined),
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

vi.mock('../../src/services/auth_service.js', () => ({
  getAuthService: () => ({ getClientForUser: mockGetAuth }),
}));

vi.mock('../../src/services/calendar_api.js', () => ({
  listBusyFromGCal: (...a: unknown[]) => mockListBusy(...a),
}));

vi.mock('../../src/services/mutual_slot_engine.js', () => ({
  findMutualSlots: (...a: unknown[]) => mockFindMutualSlots(...a),
}));

vi.mock('../../src/routes/invite_grant_auth.js', () => ({
  computeMutualSlotsForSession: (...a: unknown[]) => mockComputeMutual(...a),
}));

vi.mock('../../src/db/users.js', () => ({
  getPolicy: vi.fn().mockResolvedValue({
    workingHoursStart: '09:00',
    workingHoursEnd: '18:00',
    chronotype: 'flexible',
  }),
  getUserById: vi.fn().mockResolvedValue({ id: 'host-1', email: 'host@test.com' }),
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

function openSession(): SchedulingSessionRow {
  return {
    id: 'sess-next',
    token: 'tok-next',
    host_user_id: 'host-1',
    host_name: 'Host',
    host_timezone: 'America/Chicago',
    invitee_email: 'guest@test.com',
    invitee_label: null,
    duration_minutes: 60,
    offered_slots: [],
    selected_slot: null,
    google_event_id: null,
    proposed_alternatives: [],
    status: 'pending',
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function activeGrant(): InviteCalendarGrantRow {
  return {
    id: 'grant-next',
    scheduling_session_id: 'sess-next',
    invitee_email: 'guest@test.com',
    oauth_access_token: 'access',
    oauth_refresh_token: 'refresh',
    oauth_expiry: new Date(Date.now() + 3600000).toISOString(),
    preferred_window_start: '2026-06-10T09:00:00-05:00',
    preferred_window_end: '2026-06-12T17:00:00-05:00',
    status: 'active',
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    created_at: new Date().toISOString(),
  };
}

describe('POST /s/:token/next-slots mutual paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(openSession());
    mockGetAuth.mockResolvedValue({ request: vi.fn() });
    mockListBusy.mockResolvedValue([]);
    mockFindMutualSlots.mockReturnValue([
      { start: '2026-06-10T10:00:00-05:00', end: '2026-06-10T11:00:00-05:00' },
      { start: '2026-06-11T14:00:00-05:00', end: '2026-06-11T15:00:00-05:00' },
    ]);
    mockComputeMutual.mockResolvedValue([
      { start: '2026-06-12T10:00:00-05:00', end: '2026-06-12T11:00:00-05:00' },
      { start: '2026-06-13T14:00:00-05:00', end: '2026-06-13T15:00:00-05:00' },
    ]);
  });

  it('returns mutual slots when invite grant is active', async () => {
    mockGetGrant.mockResolvedValue(activeGrant());
    const res = await request(app()).post('/s/tok-next/next-slots');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('mutual');
    expect(res.body.slots).toHaveLength(2);
    expect(mockComputeMutual).toHaveBeenCalled();
    expect(mockFindMutualSlots).not.toHaveBeenCalled();
  });

  it('falls back to host-only slots when grant is missing', async () => {
    mockGetGrant.mockResolvedValue(null);
    const res = await request(app()).post('/s/tok-next/next-slots');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('host');
    expect(res.body.slots).toHaveLength(2);
    expect(mockFindMutualSlots).toHaveBeenCalledWith(
      expect.objectContaining({ inviteeBusy: [] }),
    );
  });

  it('returns host_fallback when grant exists but mutual compute yields too few slots', async () => {
    mockGetGrant.mockResolvedValue(activeGrant());
    mockComputeMutual.mockResolvedValue([]);
    const res = await request(app()).post('/s/tok-next/next-slots');
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('host_fallback');
    expect(mockFindMutualSlots).toHaveBeenCalled();
  });
});
