/**
 * Event types CRUD + public booking entry routes
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockSession = { userId: 'user-1', email: 'host@example.com' };

const mockList = vi.fn();
const mockGetById = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockDeactivate = vi.fn();
const mockPublicLookup = vi.fn();
const mockGetUserById = vi.fn();
const mockEnsureUsername = vi.fn();

vi.mock('../../src/middleware/session.js', () => ({
  requireSession: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { session: typeof mockSession }).session = mockSession;
    next();
  },
}));

vi.mock('../../src/db/event_types.js', () => ({
  listEventTypes: (...a: unknown[]) => mockList(...a),
  getEventTypeById: (...a: unknown[]) => mockGetById(...a),
  createEventType: (...a: unknown[]) => mockCreate(...a),
  updateEventType: (...a: unknown[]) => mockUpdate(...a),
  deactivateEventType: (...a: unknown[]) => mockDeactivate(...a),
  getPublicEventTypeByUsernameSlug: (...a: unknown[]) => mockPublicLookup(...a),
}));

vi.mock('../../src/db/users.js', () => ({
  getUserById: (...a: unknown[]) => mockGetUserById(...a),
  ensureUsername: (...a: unknown[]) => mockEnsureUsername(...a),
  ensureDefaultPolicy: vi.fn().mockResolvedValue({
    userId: 'user-1',
    schemaVersion: 1,
    timezone: 'America/Chicago',
    chronotype: 'morning',
    defaultBufferMinutes: 15,
    clusteringPreference: 'balanced',
    maxFragmentsPerDay: 4,
    faxEffectConfig: {
      targetSlotsPerOffer: 2,
      minBufferMinutes: 15,
      clusteringWeight: 0.35,
      energyWeight: 0.45,
      fragmentPenaltyWeight: 0.15,
      protectDeepWorkBlocks: true,
    },
    protectedBlocks: [],
    contactTiers: {},
    workingHoursStart: '09:00',
    workingHoursEnd: '17:00',
  }),
}));

vi.mock('../../src/services/auth_service.js', () => ({
  getOAuthClientForUser: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../src/core/public-booking.js', () => ({
  loadPublicBookingSlots: vi.fn().mockResolvedValue({
    policy: {},
    slots: [{ start: '2026-06-10T14:00:00.000Z', end: '2026-06-10T14:30:00.000Z' }],
  }),
  findSlotByStart: vi.fn(),
  mergeEventTypePolicy: vi.fn(),
}));

import { eventTypesRouter } from '../../src/routes/event_types.js';
import { bookPublicRouter } from '../../src/routes/book_public.js';
import { config } from '../../src/config.js';

const sampleEventType = {
  id: 'et-1',
  userId: 'user-1',
  name: 'Intro Call',
  slug: 'intro-call',
  durationMinutes: 30,
  description: 'Quick intro',
  availabilityRules: {},
  active: true,
  createdAt: '2026-06-07T12:00:00.000Z',
  updatedAt: '2026-06-07T12:00:00.000Z',
};

function apiApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/event-types', eventTypesRouter);
  app.use('/book', bookPublicRouter);
  return app;
}

describe('event types routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUserById.mockResolvedValue({
      id: 'user-1',
      email: 'host@example.com',
      username: 'host',
    });
    mockEnsureUsername.mockResolvedValue('host');
  });

  describe('GET /api/event-types', () => {
    it('returns event types with public URLs', async () => {
      mockList.mockResolvedValueOnce([sampleEventType]);
      const res = await request(apiApp()).get('/api/event-types');
      expect(res.status).toBe(200);
      expect(res.body.eventTypes).toHaveLength(1);
      expect(res.body.eventTypes[0]).toMatchObject({
        id: 'et-1',
        name: 'Intro Call',
        slug: 'intro-call',
        durationMinutes: 30,
        publicUrl: `${config.baseUrl}/book/host/intro-call`,
      });
      expect(mockList).toHaveBeenCalledWith('user-1', false);
    });
  });

  describe('POST /api/event-types', () => {
    it('creates an event type', async () => {
      mockCreate.mockResolvedValueOnce(sampleEventType);
      const res = await request(apiApp()).post('/api/event-types').send({
        name: 'Intro Call',
        durationMinutes: 30,
        description: 'Quick intro',
      });
      expect(res.status).toBe(201);
      expect(res.body.eventType.slug).toBe('intro-call');
      expect(mockCreate).toHaveBeenCalledWith('user-1', {
        name: 'Intro Call',
        slug: 'intro-call',
        durationMinutes: 30,
        description: 'Quick intro',
        availabilityRules: {},
      });
    });

    it('returns 400 for missing name', async () => {
      const res = await request(apiApp()).post('/api/event-types').send({ durationMinutes: 30 });
      expect(res.status).toBe(400);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('returns 400 for invalid duration', async () => {
      const res = await request(apiApp())
        .post('/api/event-types')
        .send({ name: 'Call', durationMinutes: 0 });
      expect(res.status).toBe(400);
    });

    it('returns 409 on duplicate slug', async () => {
      mockCreate.mockRejectedValueOnce(new Error('duplicate key value violates unique constraint'));
      const res = await request(apiApp())
        .post('/api/event-types')
        .send({ name: 'Intro Call', slug: 'intro-call', durationMinutes: 30 });
      expect(res.status).toBe(409);
    });
  });

  describe('GET /api/event-types/:id', () => {
    it('returns a single event type', async () => {
      mockGetById.mockResolvedValueOnce(sampleEventType);
      const res = await request(apiApp()).get('/api/event-types/et-1');
      expect(res.status).toBe(200);
      expect(res.body.eventType.id).toBe('et-1');
    });

    it('returns 404 when missing', async () => {
      mockGetById.mockResolvedValueOnce(null);
      const res = await request(apiApp()).get('/api/event-types/missing');
      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /api/event-types/:id', () => {
    it('updates fields', async () => {
      mockUpdate.mockResolvedValueOnce({ ...sampleEventType, name: 'Updated Call' });
      const res = await request(apiApp())
        .patch('/api/event-types/et-1')
        .send({ name: 'Updated Call', availabilityRules: { bufferMinutes: 10 } });
      expect(res.status).toBe(200);
      expect(res.body.eventType.name).toBe('Updated Call');
    });

    it('returns 400 for invalid slug', async () => {
      const res = await request(apiApp()).patch('/api/event-types/et-1').send({ slug: 'Bad Slug!' });
      expect(res.status).toBe(400);
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /api/event-types/:id', () => {
    it('deactivates event type', async () => {
      mockDeactivate.mockResolvedValueOnce({ ...sampleEventType, active: false });
      const res = await request(apiApp()).delete('/api/event-types/et-1');
      expect(res.status).toBe(200);
      expect(res.body.eventType.active).toBe(false);
    });
  });

  describe('GET /book/:username/:slug', () => {
    it('returns public booking payload', async () => {
      mockPublicLookup.mockResolvedValueOnce({
        eventType: sampleEventType,
        hostName: 'Host User',
        hostTimezone: 'America/Chicago',
      });
      const res = await request(apiApp())
        .get('/book/host/intro-call')
        .set('Accept', 'application/json');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        host: { name: 'Host User', username: 'host', timezone: 'America/Chicago' },
        eventType: { name: 'Intro Call', slug: 'intro-call', durationMinutes: 30 },
      });
    });

    it('returns 404 for unknown booking page', async () => {
      mockPublicLookup.mockResolvedValueOnce(null);
      const res = await request(apiApp())
        .get('/book/nobody/nope')
        .set('Accept', 'application/json');
      expect(res.status).toBe(404);
    });
  });
});
