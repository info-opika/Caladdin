import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockSession = { userId: 'user-ics-1', email: 'host@ics.test' };
const mockGetUser = vi.fn();
const mockListSessions = vi.fn();

vi.mock('../../src/middleware/session.js', () => ({
  requireSession: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { session: typeof mockSession }).session = mockSession;
    next();
  },
}));

vi.mock('../../src/db/users.js', () => ({
  getUserById: (...a: unknown[]) => mockGetUser(...a),
  getUserProfileView: vi.fn(),
  updateUserProfile: vi.fn(),
}));

vi.mock('../../src/db/scheduling_sessions.js', () => ({
  listSessionsForHost: (...a: unknown[]) => mockListSessions(...a),
}));

vi.mock('../../src/db/user_data.js', () => ({
  exportUserData: vi.fn(),
  deleteUserAccount: vi.fn(),
}));

vi.mock('../../src/services/auth_service.js', () => ({
  getOAuthClientForUser: vi.fn(),
}));

vi.mock('../../src/middleware/csrf.js', () => ({
  generateCsrfToken: () => 'csrf',
  setCsrfCookie: vi.fn(),
  clearCsrfCookie: vi.fn(),
}));

vi.mock('../../src/middleware/sensitiveAudit.js', () => ({
  auditSensitiveOperation: vi.fn(),
}));

import { apiRouter } from '../../src/routes/api.js';

function app() {
  const x = express();
  x.use('/api', apiRouter);
  return x;
}

describe('GET /api/calendar.ics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ id: 'user-ics-1', email: 'host@ics.test', display_name: 'Host ICS' });
    mockListSessions.mockResolvedValue([
      {
        token: 'tok-1',
        status: 'confirmed',
        host_name: 'Host ICS',
        context: 'Demo booking',
        selected_slot: { start: '2026-06-10T15:00:00.000Z', end: '2026-06-10T15:30:00.000Z' },
      },
      { token: 'tok-2', status: 'pending', selected_slot: null },
    ]);
  });

  it('returns text/calendar with confirmed session events', async () => {
    const res = await request(app()).get('/api/calendar.ics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/calendar');
    expect(res.text).toContain('BEGIN:VCALENDAR');
    expect(res.text).toContain('BEGIN:VEVENT');
    expect(res.text).toContain('SUMMARY:Meeting with Host ICS');
  });
});
