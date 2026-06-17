import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockSession = { userId: '11111111-1111-4111-8111-111111111111', email: 'host@example.test' };
const mockEnsurePolicy = vi.fn();
const mockGetOAuth = vi.fn();
const mockListBusy = vi.fn();
const mockGetCachedBusy = vi.fn();
const mockLookupInvitee = vi.fn();

vi.mock('../../src/middleware/session.js', () => ({
  requireSession: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { session: typeof mockSession }).session = mockSession;
    next();
  },
}));

vi.mock('../../src/db/users.js', () => ({
  ensureDefaultPolicy: (...a: unknown[]) => mockEnsurePolicy(...a),
  getUserProfileView: vi.fn(),
  updateUserProfile: vi.fn(),
  getUserById: vi.fn(),
}));

vi.mock('../../src/db/scheduling_sessions.js', () => ({
  listSessionsForHost: vi.fn(),
}));

vi.mock('../../src/db/user_data.js', () => ({
  exportUserData: vi.fn(),
  deleteUserAccount: vi.fn(),
}));

vi.mock('../../src/services/auth_service.js', () => ({
  getOAuthClientForUser: (...a: unknown[]) => mockGetOAuth(...a),
}));

vi.mock('../../src/services/calendar_api.js', () => ({
  listBusyFromGCal: (...a: unknown[]) => mockListBusy(...a),
}));

vi.mock('../../src/services/freebusy-cache.js', () => ({
  getCachedBusyFromGCal: (...a: unknown[]) => mockGetCachedBusy(...a),
}));

vi.mock('../../src/services/invitee_lookup.js', () => ({
  lookupInviteeAvailability: (...a: unknown[]) => mockLookupInvitee(...a),
}));

vi.mock('../../src/middleware/csrf.js', () => ({
  generateCsrfToken: () => 'csrf',
  setCsrfCookie: vi.fn(),
  clearCsrfCookie: vi.fn(),
}));

vi.mock('../../src/middleware/sensitiveAudit.js', () => ({
  auditSensitiveOperation: vi.fn(),
}));

vi.mock('../../src/db/events.js', () => ({
  listWeekEventsWithSource: vi.fn(),
}));

import { apiRouter } from '../../src/routes/api.js';

function app() {
  const x = express();
  x.use(express.json());
  x.use('/api', apiRouter);
  return x;
}

describe('POST /api/calendar/check-slot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnsurePolicy.mockResolvedValue({ timezone: 'America/Chicago' });
    mockGetOAuth.mockResolvedValue({ freebusy: { query: vi.fn() } });
    mockListBusy.mockResolvedValue([]);
    mockLookupInvitee.mockResolvedValue({ isCaladdinUser: false, hasCalendarConnected: false });
  });

  it('returns host_only availability when invitee is unknown', async () => {
    const res = await request(app())
      .post('/api/calendar/check-slot')
      .send({
        candidateStart: '2026-06-10T14:00:00-05:00',
        candidateEnd: '2026-06-10T15:00:00-05:00',
        inviteeEmail: 'unknown@example.com',
      });

    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    expect(res.body.scope).toBe('host_only');
    expect(mockGetCachedBusy).not.toHaveBeenCalled();
  });

  it('checks mutual scope for known invitee with calendar', async () => {
    mockLookupInvitee.mockResolvedValue({
      isCaladdinUser: true,
      hasCalendarConnected: true,
      userId: '22222222-2222-4222-8222-222222222222',
    });
    mockGetOAuth
      .mockResolvedValueOnce({ freebusy: { query: vi.fn() } })
      .mockResolvedValueOnce({ freebusy: { query: vi.fn() } });
    mockGetCachedBusy.mockResolvedValue([
      { start: '2026-06-10T14:30:00-05:00', end: '2026-06-10T15:30:00-05:00' },
    ]);

    const res = await request(app())
      .post('/api/calendar/check-slot')
      .send({
        candidateStart: '2026-06-10T14:00:00-05:00',
        candidateEnd: '2026-06-10T15:00:00-05:00',
        inviteeEmail: 'known@example.com',
      });

    expect(res.status).toBe(200);
    expect(res.body.scope).toBe('mutual');
    expect(res.body.available).toBe(false);
    expect(res.body.conflicts[0].party).toBe('invitee');
  });

  it('rejects invalid payload', async () => {
    const res = await request(app()).post('/api/calendar/check-slot').send({});
    expect(res.status).toBe(400);
  });
});
