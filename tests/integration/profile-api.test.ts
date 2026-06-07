import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { apiRouter, feedbackRouter } from '../../src/routes/api.js';

const mockGetUserProfileView = vi.fn();
const mockUpdateUserProfile = vi.fn();
const mockGetOAuthClientForUser = vi.fn();
const mockListSessionsForHost = vi.fn();
const mockInsertFeedback = vi.fn();
const mockRequireSession = vi.fn();

vi.mock('../../src/db/users.js', () => ({
  getUserProfileView: (...args: unknown[]) => mockGetUserProfileView(...args),
  updateUserProfile: (...args: unknown[]) => mockUpdateUserProfile(...args),
}));

vi.mock('../../src/db/scheduling_sessions.js', () => ({
  listSessionsForHost: (...args: unknown[]) => mockListSessionsForHost(...args),
}));

vi.mock('../../src/db/feedback.js', () => ({
  insertFeedback: (...args: unknown[]) => mockInsertFeedback(...args),
}));

vi.mock('../../src/services/auth_service.js', () => ({
  getOAuthClientForUser: (...args: unknown[]) => mockGetOAuthClientForUser(...args),
}));

vi.mock('../../src/middleware/session.js', () => ({
  requireSession: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    mockRequireSession(req, res, next);
    (req as express.Request & { session: { userId: string; email: string } }).session = {
      userId: '11111111-1111-4111-8111-111111111111',
      email: 'host@example.test',
    };
    next();
  },
}));

function app() {
  const x = express();
  x.use(express.json());
  x.use('/api', apiRouter);
  x.use('/feedback', feedbackRouter);
  return x;
}

describe('Profile API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOAuthClientForUser.mockResolvedValue({ request: vi.fn() });
  });

  it('GET /api/profile returns profile for session user', async () => {
    mockGetUserProfileView.mockResolvedValueOnce({
      userId: '11111111-1111-4111-8111-111111111111',
      email: 'host@example.test',
      timezone: 'America/Chicago',
      privacyMode: 'private',
      onboardingComplete: false,
      calendarConnected: true,
    });

    const res = await request(app()).get('/api/profile');
    expect(res.status).toBe(200);
    expect(res.body.timezone).toBe('America/Chicago');
    expect(res.body.calendarConnected).toBe(true);
  });

  it('PATCH /api/profile persists timezone and privacy', async () => {
    mockUpdateUserProfile.mockResolvedValueOnce({
      userId: '11111111-1111-4111-8111-111111111111',
      email: 'host@example.test',
      timezone: 'America/Los_Angeles',
      privacyMode: 'trusted',
      onboardingComplete: true,
      calendarConnected: false,
    });

    const res = await request(app())
      .patch('/api/profile')
      .send({ timezone: 'America/Los_Angeles', privacyMode: 'trusted' });

    expect(res.status).toBe(200);
    expect(mockUpdateUserProfile).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      expect.objectContaining({
        timezone: 'America/Los_Angeles',
        privacyMode: 'trusted',
        markOnboardingComplete: true,
      }),
    );
    expect(res.body.onboardingComplete).toBe(true);
  });

  it('PATCH /api/profile rejects empty payload', async () => {
    const res = await request(app()).patch('/api/profile').send({});
    expect(res.status).toBe(400);
    expect(mockUpdateUserProfile).not.toHaveBeenCalled();
  });

  it('GET /api/profile returns 404 when user missing', async () => {
    mockGetUserProfileView.mockResolvedValueOnce(null);
    const res = await request(app()).get('/api/profile');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('User not found');
  });

  it('PATCH /api/profile rejects invalid privacy mode', async () => {
    const res = await request(app())
      .patch('/api/profile')
      .send({ privacyMode: 'public' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid profile payload');
    expect(mockUpdateUserProfile).not.toHaveBeenCalled();
  });

  it('PATCH /api/profile rejects malformed working hours', async () => {
    const res = await request(app())
      .patch('/api/profile')
      .send({ workingHoursStart: '9am' });
    expect(res.status).toBe(400);
    expect(mockUpdateUserProfile).not.toHaveBeenCalled();
  });

  it('PATCH /api/profile persists working hours without marking onboarding', async () => {
    mockUpdateUserProfile.mockResolvedValueOnce({
      userId: '11111111-1111-4111-8111-111111111111',
      email: 'host@example.test',
      timezone: 'America/Chicago',
      privacyMode: 'private',
      onboardingComplete: false,
      calendarConnected: false,
    });

    const res = await request(app())
      .patch('/api/profile')
      .send({ workingHoursStart: '09:00', workingHoursEnd: '17:00' });

    expect(res.status).toBe(200);
    expect(mockUpdateUserProfile).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      expect.objectContaining({
        workingHoursStart: '09:00',
        workingHoursEnd: '17:00',
        markOnboardingComplete: false,
      }),
    );
  });

  it('PATCH /api/profile returns 500 when update fails', async () => {
    mockUpdateUserProfile.mockRejectedValueOnce(new Error('db error'));
    const res = await request(app()).patch('/api/profile').send({ timezone: 'UTC' });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Could not save profile');
  });

  it('GET /api/sessions returns host scheduling sessions', async () => {
    mockListSessionsForHost.mockResolvedValueOnce([
      { id: 'sess-1', token: 'abc', status: 'pending' },
    ]);
    const res = await request(app()).get('/api/sessions');
    expect(res.status).toBe(200);
    expect(res.body.sessions).toHaveLength(1);
    expect(mockListSessionsForHost).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
  });

  it('POST /feedback records session feedback', async () => {
    mockInsertFeedback.mockResolvedValueOnce(undefined);
    const res = await request(app())
      .post('/feedback')
      .send({ rating: 'positive', stars: 5, intent: 'OFFER_SPECIFIC', comment: 'Great' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockInsertFeedback).toHaveBeenCalledWith({
      userId: '11111111-1111-4111-8111-111111111111',
      rating: 'positive',
      stars: 5,
      intent: 'OFFER_SPECIFIC',
      comment: 'Great',
    });
  });
});
