/**
 * Layer 3 — in-process booking flow smoke (supertest, no browser).
 *
 * Chains: health → event type create → public book page load.
 * Runs in CI without a live server or Playwright.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import * as client from '../../src/db/client.js';
import * as redis from '../../src/services/redis.js';

const mockSession = { userId: 'user-smoke-1', email: 'host@smoke.test' };
const mockCreate = vi.fn();
const mockPublicLookup = vi.fn();
const mockGetUserById = vi.fn();
const mockEnsureUsername = vi.fn();

vi.mock('../../src/middleware/session.js', () => ({
  SESSION_COOKIE: 'caladdin_session',
  requireSession: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { session: typeof mockSession }).session = mockSession;
    next();
  },
  requireApiKey: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

vi.mock('../../src/db/event_types.js', () => ({
  createEventType: (...a: unknown[]) => mockCreate(...a),
  getPublicEventTypeByUsernameSlug: (...a: unknown[]) => mockPublicLookup(...a),
  listEventTypes: vi.fn().mockResolvedValue([]),
  getEventTypeById: vi.fn(),
  updateEventType: vi.fn(),
  deactivateEventType: vi.fn(),
}));

vi.mock('../../src/db/users.js', () => ({
  getUserById: (...a: unknown[]) => mockGetUserById(...a),
  ensureUsername: (...a: unknown[]) => mockEnsureUsername(...a),
  ensureDefaultPolicy: vi.fn().mockResolvedValue({
    userId: 'user-smoke-1',
    schemaVersion: 1,
    timezone: 'UTC',
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

vi.mock('../../src/jobs/compensation-worker.js', () => ({
  startCompensationWorker: vi.fn(),
}));

vi.mock('../../src/jobs/session-expiry.js', () => ({
  startSessionExpiryWorker: vi.fn(),
  runSessionExpiry: vi.fn(),
}));

import { app } from '../../src/index.js';

const sampleEventType = {
  id: 'et-smoke',
  userId: 'user-smoke-1',
  name: 'Smoke Call',
  slug: 'smoke-call',
  durationMinutes: 30,
  description: 'CI smoke booking page',
  availabilityRules: {},
  active: true,
  createdAt: '2026-06-07T12:00:00.000Z',
  updatedAt: '2026-06-07T12:00:00.000Z',
};

describe('booking flow smoke (supertest)', () => {
  beforeEach(() => {
    vi.spyOn(client, 'pingDb').mockResolvedValue('ok');
    vi.spyOn(redis, 'pingRedis').mockResolvedValue('skipped');
    vi.clearAllMocks();
    mockGetUserById.mockResolvedValue({
      id: 'user-smoke-1',
      email: 'host@smoke.test',
      username: 'smokehost',
    });
    mockEnsureUsername.mockResolvedValue('smokehost');
    mockCreate.mockResolvedValue(sampleEventType);
    mockPublicLookup.mockResolvedValue({
      eventType: sampleEventType,
      hostName: 'Smoke Host',
      hostTimezone: 'UTC',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('health → create event type → public book page loads', async () => {
    const health = await request(app).get('/health');
    expect(health.status).toBe(200);
    expect(health.body.status).toBe('ok');

    const created = await request(app)
      .post('/api/event-types')
      .send({ name: 'Smoke Call', durationMinutes: 30, description: 'CI smoke booking page' });
    expect(created.status).toBe(201);
    expect(created.body.eventType.slug).toBe('smoke-call');

    const book = await request(app)
      .get('/book/smokehost/smoke-call')
      .set('Accept', 'application/json');
    expect(book.status).toBe(200);
    expect(book.body.eventType.name).toBe('Smoke Call');
    expect(book.body.host.username).toBe('smokehost');
    expect(mockPublicLookup).toHaveBeenCalledWith('smokehost', 'smoke-call');
  });
});
