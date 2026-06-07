import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockPublicLookup = vi.fn();
const mockPickHost = vi.fn();
const mockEnsurePolicy = vi.fn();
const mockGenerateSlots = vi.fn();
const mockGetOAuth = vi.fn();

vi.mock('../../src/db/event_types.js', () => ({
  getPublicEventTypeByUsernameSlug: (...a: unknown[]) => mockPublicLookup(...a),
}));

vi.mock('../../src/db/event_type_members.js', () => ({
  pickRoundRobinHost: (...a: unknown[]) => mockPickHost(...a),
}));

vi.mock('../../src/db/users.js', () => ({
  ensureDefaultPolicy: (...a: unknown[]) => mockEnsurePolicy(...a),
}));

vi.mock('../../src/core/slot-scoring.js', () => ({
  generatePublicBookingSlots: (...a: unknown[]) => mockGenerateSlots(...a),
}));

const mockCreateEvent = vi.fn();
const mockCheckOperationAllowed = vi.fn();
const mockBookingRateLimit = vi.fn();
const mockRecordUsage = vi.fn();

vi.mock('../../src/services/calendar.js', () => ({
  createCalendarEvent: (...a: unknown[]) => mockCreateEvent(...a),
}));

vi.mock('../../src/pilot/pilot_controls.js', () => ({
  checkOperationAllowed: (...a: unknown[]) => mockCheckOperationAllowed(...a),
}));

vi.mock('../../src/core/rate-limiter.js', () => ({
  bookingSelectRateLimiter: { check: (...a: unknown[]) => mockBookingRateLimit(...a) },
}));

vi.mock('../../src/db/usage_events.js', () => ({
  recordUsageEvent: (...a: unknown[]) => mockRecordUsage(...a),
}));

const mockGetClientForUser = vi.fn();

vi.mock('../../src/services/auth_service.js', () => ({
  getOAuthClientForUser: (...a: unknown[]) => mockGetOAuth(...a),
  getAuthService: () => ({ getClientForUser: (...a: unknown[]) => mockGetClientForUser(...a) }),
}));

import { bookPublicRouter } from '../../src/routes/book_public.js';

function app() {
  const x = express();
  x.use(express.json());
  x.set('webRoot', process.cwd());
  x.use('/book', bookPublicRouter);
  x.use((err: Error, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    res.status(500).json({ error: err.message });
    next(err);
  });
  return x;
}

const sampleEventType = {
  id: 'et-1',
  userId: 'user-1',
  name: 'Strategy Session',
  slug: 'strategy-session',
  durationMinutes: 45,
  description: 'Deep dive',
  availabilityRules: { bufferMinutes: 15 },
  schedulingMode: 'single',
  active: true,
  createdAt: '2026-06-07T12:00:00.000Z',
  updatedAt: '2026-06-07T12:00:00.000Z',
};

describe('book public routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckOperationAllowed.mockResolvedValue({ allowed: true });
    mockBookingRateLimit.mockResolvedValue({ allowed: true });
    mockGetClientForUser.mockResolvedValue({});
    mockCreateEvent.mockResolvedValue({ id: 'gcal-99' });
    mockEnsurePolicy.mockResolvedValue({
      workingHoursStart: '09:00',
      workingHoursEnd: '18:00',
      timezone: 'America/New_York',
      protectedBlocks: [],
    });
    mockGetOAuth.mockResolvedValue(null);
    mockGenerateSlots.mockResolvedValue([
      { start: '2026-06-10T14:00:00.000-05:00', end: '2026-06-10T14:45:00.000-05:00' },
    ]);
  });

  it('GET /book/:username/:slug normalizes path segments to lowercase', async () => {
    mockPublicLookup.mockResolvedValueOnce({
      eventType: sampleEventType,
      hostName: 'Alex Host',
      hostTimezone: 'America/New_York',
    });

    const res = await request(app())
      .get('/book/ALEX-HOST/Strategy-Session')
      .set('Accept', 'application/json');
    expect(res.status).toBe(200);
    expect(mockPublicLookup).toHaveBeenCalledWith('alex-host', 'strategy-session');
    expect(res.body).toEqual({
      host: { name: 'Alex Host', username: 'alex-host', timezone: 'America/New_York' },
      eventType: {
        name: 'Strategy Session',
        slug: 'strategy-session',
        durationMinutes: 45,
        description: 'Deep dive',
        availabilityRules: { bufferMinutes: 15 },
        schedulingMode: 'single',
      },
    });
  });

  it('GET /book/:username/:slug/slots returns generated slots', async () => {
    mockPublicLookup.mockResolvedValueOnce({
      eventType: sampleEventType,
      hostName: 'Alex Host',
      hostTimezone: 'America/New_York',
    });

    const res = await request(app()).get('/book/alex-host/strategy-session/slots');
    expect(res.status).toBe(200);
    expect(res.body.slots).toHaveLength(1);
    expect(mockGenerateSlots).toHaveBeenCalled();
  });

  it('GET /book/:username/:slug returns 404 when booking page missing', async () => {
    mockPublicLookup.mockResolvedValueOnce(null);
    const res = await request(app())
      .get('/book/nobody/missing')
      .set('Accept', 'application/json');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Booking page not found');
  });

  it('GET /book/:username/:slug forwards lookup errors', async () => {
    mockPublicLookup.mockRejectedValueOnce(new Error('database unavailable'));
    const res = await request(app())
      .get('/book/host/slug')
      .set('Accept', 'application/json');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('database unavailable');
  });

  it('POST /book/:username/:slug/select books slot when calendar available', async () => {
    mockPublicLookup.mockResolvedValue({
      eventType: sampleEventType,
      hostName: 'Alex Host',
      hostTimezone: 'America/New_York',
    });
    const slot = { start: '2026-06-10T14:00:00.000-05:00', end: '2026-06-10T14:45:00.000-05:00' };
    mockGenerateSlots.mockResolvedValue([slot]);

    const res = await request(app())
      .post('/book/alex-host/strategy-session/select')
      .send({
        slotStart: slot.start,
        guest: { name: 'Guest', email: 'guest@example.com' },
      });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockCreateEvent).toHaveBeenCalled();
    expect(mockRecordUsage).toHaveBeenCalled();
  });

  it('POST select returns 400 for invalid guest intake', async () => {
    mockPublicLookup.mockResolvedValue({
      eventType: sampleEventType,
      hostName: 'Alex Host',
      hostTimezone: 'America/New_York',
    });
    const res = await request(app())
      .post('/book/alex-host/strategy-session/select')
      .send({ slotStart: '2026-06-10T14:00:00.000-05:00', guest: { name: '' } });
    expect(res.status).toBe(400);
  });

  it('POST select returns 409 when slot not in availability', async () => {
    mockPublicLookup.mockResolvedValue({
      eventType: sampleEventType,
      hostName: 'Alex Host',
      hostTimezone: 'America/New_York',
    });
    mockGenerateSlots.mockResolvedValue([]);
    const res = await request(app())
      .post('/book/alex-host/strategy-session/select')
      .send({
        slotStart: '2026-06-10T99:00:00.000-05:00',
        guest: { name: 'Guest', email: 'guest@example.com' },
      });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('slot_unavailable');
  });

  it('POST select returns 503 when kill switch active', async () => {
    mockCheckOperationAllowed.mockResolvedValueOnce({ allowed: false, message: 'paused' });
    const res = await request(app())
      .post('/book/alex-host/strategy-session/select')
      .send({ guest: { name: 'G', email: 'g@test.com' } });
    expect(res.status).toBe(503);
  });
});
