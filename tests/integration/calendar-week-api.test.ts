import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockSession = { userId: '11111111-1111-4111-8111-111111111111', email: 'host@example.test' };
const mockListWeekEventsWithSource = vi.fn();

vi.mock('../../src/middleware/session.js', () => ({
  requireSession: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { session: typeof mockSession }).session = mockSession;
    next();
  },
}));

vi.mock('../../src/db/events.js', () => ({
  listWeekEventsWithSource: (...args: unknown[]) => mockListWeekEventsWithSource(...args),
}));

vi.mock('../../src/db/users.js', () => ({
  getUserProfileView: vi.fn(),
  updateUserProfile: vi.fn(),
  getUserById: vi.fn(),
  ensureDefaultPolicy: vi.fn(),
}));

vi.mock('../../src/db/scheduling_sessions.js', () => ({
  listSessionsForHost: vi.fn(),
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

describe('GET /api/calendar/week', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns week events with source for session user', async () => {
    mockListWeekEventsWithSource.mockResolvedValueOnce({
      start: '2026-06-15T05:00:00.000Z',
      end: '2026-06-22T05:00:00.000Z',
      events: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          title: '[Protected] Focus',
          start: '2026-06-16T14:00:00.000Z',
          end: '2026-06-16T15:00:00.000Z',
          source: 'caladdin_block',
        },
        {
          id: '33333333-3333-4333-8333-333333333333',
          title: 'Team sync',
          start: '2026-06-17T15:00:00.000Z',
          end: '2026-06-17T16:00:00.000Z',
          source: 'external',
        },
      ],
    });

    const res = await request(app()).get('/api/calendar/week?start=2026-06-16T12:00:00.000Z');
    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(2);
    expect(res.body.events[0].source).toBe('caladdin_block');
    expect(mockListWeekEventsWithSource).toHaveBeenCalledWith(
      mockSession.userId,
      '2026-06-16T12:00:00.000Z',
    );
  });

  it('defaults week start when start query omitted', async () => {
    mockListWeekEventsWithSource.mockResolvedValueOnce({
      start: '2026-06-15T05:00:00.000Z',
      end: '2026-06-22T05:00:00.000Z',
      events: [],
    });

    const res = await request(app()).get('/api/calendar/week');
    expect(res.status).toBe(200);
    expect(mockListWeekEventsWithSource).toHaveBeenCalledWith(mockSession.userId, undefined);
  });

  it('rejects invalid start parameter', async () => {
    const res = await request(app()).get('/api/calendar/week?start=not-a-date');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid start/);
    expect(mockListWeekEventsWithSource).not.toHaveBeenCalled();
  });
});
