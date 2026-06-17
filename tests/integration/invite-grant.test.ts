import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import inviteGrantAuthRoutes from '../../src/routes/invite_grant_auth.js';
import type { SchedulingSessionRow } from '../../src/db/scheduling_sessions.js';
import type { InviteCalendarGrantRow } from '../../src/db/invite_calendar_grants.js';

const mockGetSession = vi.fn();
const mockGetGrant = vi.fn();
const mockUpsertGrant = vi.fn();
const mockUpdateWindow = vi.fn();
const mockExchangeCode = vi.fn();
const mockGetAuthUrl = vi.fn();
const mockParseState = vi.fn();
const mockGetGoogleUserInfo = vi.fn();
const mockGetInviteeCal = vi.fn();
const mockGetHostCal = vi.fn();
const mockListBusy = vi.fn();

vi.mock('../../src/db/scheduling_sessions.js', () => ({
  getSchedulingSessionByToken: (...a: unknown[]) => mockGetSession(...a),
}));

vi.mock('../../src/db/invite_calendar_grants.js', () => ({
  getGrantBySessionId: (...a: unknown[]) => mockGetGrant(...a),
  upsertInviteGrant: (...a: unknown[]) => mockUpsertGrant(...a),
  updateGrantPreferredWindow: (...a: unknown[]) => mockUpdateWindow(...a),
}));

vi.mock('../../src/services/invitee_oauth.js', () => ({
  getInviteeGrantAuthUrl: (...a: unknown[]) => mockGetAuthUrl(...a),
  exchangeInviteeGrantCode: (...a: unknown[]) => mockExchangeCode(...a),
  parseGrantState: (...a: unknown[]) => mockParseState(...a),
  getInviteeCalendarClient: (...a: unknown[]) => mockGetInviteeCal(...a),
}));

vi.mock('../../src/services/auth_service.js', () => ({
  getAuthService: () => ({ getClientForUser: mockGetHostCal }),
  getGoogleUserInfo: (...a: unknown[]) => mockGetGoogleUserInfo(...a),
}));

vi.mock('../../src/services/calendar_api.js', () => ({
  listBusyFromGCal: (...a: unknown[]) => mockListBusy(...a),
}));

vi.mock('../../src/db/users.js', () => ({
  getPolicy: vi.fn().mockResolvedValue({
    workingHoursStart: '09:00',
    workingHoursEnd: '18:00',
    chronotype: 'flexible',
  }),
}));

vi.mock('../../src/services/mutual_slot_engine.js', () => ({
  findMutualSlots: vi.fn().mockReturnValue([
    { start: '2026-06-10T10:00:00-05:00', end: '2026-06-10T11:00:00-05:00' },
    { start: '2026-06-11T14:00:00-05:00', end: '2026-06-11T15:00:00-05:00' },
  ]),
}));

function app() {
  const x = express();
  x.use(express.json());
  x.use(inviteGrantAuthRoutes);
  return x;
}

function openSession(): SchedulingSessionRow {
  return {
    id: 'sess-1',
    token: 'tok-grant',
    host_user_id: 'host-1',
    host_name: 'Kanth',
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
    id: 'grant-1',
    scheduling_session_id: 'sess-1',
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

describe('invite grant routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(openSession());
    mockGetAuthUrl.mockReturnValue('https://accounts.google.com/o/oauth2/auth?test=1');
    mockGetHostCal.mockResolvedValue({ request: vi.fn() });
    mockGetInviteeCal.mockResolvedValue({ request: vi.fn() });
    mockListBusy.mockResolvedValue([]);
  });

  it('GET /s/:token/grant/start redirects to Google OAuth', async () => {
    const res = await request(app()).get('/s/tok-grant/grant/start');
    expect(res.status).toBe(302);
    expect(mockGetAuthUrl).toHaveBeenCalledWith('tok-grant');
    expect(res.headers.location).toContain('accounts.google.com');
  });

  it('GET /s/grant/callback stores tokens and redirects back to invite', async () => {
    mockParseState.mockReturnValue({ token: 'tok-grant' });
    mockExchangeCode.mockResolvedValue({
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      expiry_date: Date.now() + 3600000,
    });
    mockGetGoogleUserInfo.mockResolvedValue({ email: 'guest@test.com' });
    mockUpsertGrant.mockResolvedValue(activeGrant());

    const res = await request(app()).get('/s/grant/callback?code=abc&state=signed');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/s/tok-grant?grant=connected');
    expect(mockUpsertGrant).toHaveBeenCalled();
  });

  it('POST /s/:token/grant/window updates preferred window', async () => {
    mockGetGrant.mockResolvedValue(activeGrant());
    const res = await request(app())
      .post('/s/tok-grant/grant/window')
      .send({
        start: '2026-06-10T09:00:00-05:00',
        end: '2026-06-12T17:00:00-05:00',
      });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockUpdateWindow).toHaveBeenCalledWith('grant-1', {
      start: '2026-06-10T09:00:00-05:00',
      end: '2026-06-12T17:00:00-05:00',
    });
  });

  it('GET /s/:token/grant/slots returns two mutual slots', async () => {
    mockGetGrant.mockResolvedValue(activeGrant());
    const res = await request(app()).get('/s/tok-grant/grant/slots');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.slots).toHaveLength(2);
  });

  it('GET /s/:token/grant/slots returns 403 without active grant', async () => {
    mockGetGrant.mockResolvedValue(null);
    const res = await request(app()).get('/s/tok-grant/grant/slots');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('grant_required');
  });
});
