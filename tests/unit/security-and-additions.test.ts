import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

import { applyConfirmationRules } from '../../src/core/safety.js';
import type { IntentResult, CalendarEvent, UserPolicyProfile } from '../../src/core/adts.js';

const BASE_PROFILE: UserPolicyProfile = {
  userId: '8b616ceb-7e77-4886-9361-92a534374fac',
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
};

function makeEvent(n: number, tier: 0 | 1 | 2 | 3 = 2): CalendarEvent {
  return {
    id: `5088adab-6579-4c61-9bb5-bf0e3be95${String(n).padStart(3, '0')}`,
    title: `Event ${n}`,
    start: '2026-04-22T09:00:00-05:00',
    end: '2026-04-22T10:00:00-05:00',
    participants: [],
    tier,
    isRecurring: false,
    status: 'confirmed',
  };
}

function makeResult(eventCount: number, tier: 0 | 1 | 2 | 3 = 2): IntentResult {
  return {
    success: true,
    intent: 'FLUSH_RANGE',
    atomicOp: 'flush_range',
    eventsAffected: Array.from({ length: eventCount }, (_, i) => makeEvent(i, tier)),
    requiresConfirmation: false,
  };
}

describe('Blast radius limit (ADDITION 1)', () => {
  it('allows up to 5 events without confirmation', () => {
    const result = applyConfirmationRules(makeResult(5), BASE_PROFILE);
    expect(result.requiresConfirmation).toBe(false);
  });

  it('requires confirmation when more than 5 events affected', () => {
    const result = applyConfirmationRules(makeResult(6), BASE_PROFILE);
    expect(result.requiresConfirmation).toBe(true);
    expect(result.failureReason).toMatch(/Blast radius: 6 events/);
  });

  it('blast radius check takes precedence over tier check', () => {
    const result = applyConfirmationRules(makeResult(6, 2), BASE_PROFILE);
    expect(result.requiresConfirmation).toBe(true);
    expect(result.failureReason).toMatch(/Blast radius/);
  });
});

import { hashPayload } from '../../src/db/confirmations.js';

describe('Payload hash (ADDITION 2)', () => {
  it('produces the same hash for identical payloads', () => {
    const payload = { intent: 'FLUSH_RANGE', eventsAffected: [] };
    expect(hashPayload(payload)).toBe(hashPayload(payload));
  });

  it('produces different hashes for different payloads', () => {
    const a = { intent: 'FLUSH_RANGE' };
    const b = { intent: 'PROTECT_BLOCK' };
    expect(hashPayload(a)).not.toBe(hashPayload(b));
  });

  it('hash is a 64-character hex string (SHA-256)', () => {
    const h = hashPayload({ foo: 'bar' });
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});

import { createRateLimiter } from '../../src/core/rate-limiter.js';

describe('Rate limiter (FIX 8)', () => {
  it('allows requests up to the limit', () => {
    const limiter = createRateLimiter(3, 60_000);
    expect(limiter.check('user1').allowed).toBe(true);
    expect(limiter.check('user1').allowed).toBe(true);
    expect(limiter.check('user1').allowed).toBe(true);
  });

  it('blocks at the limit and returns retryAfterMs', () => {
    const limiter = createRateLimiter(3, 60_000);
    limiter.check('user2');
    limiter.check('user2');
    limiter.check('user2');
    const result = limiter.check('user2');
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it('resets the user bucket', () => {
    const limiter = createRateLimiter(1, 60_000);
    limiter.check('user3');
    expect(limiter.check('user3').allowed).toBe(false);
    limiter.reset('user3');
    expect(limiter.check('user3').allowed).toBe(true);
  });

  it('tracks limits per user independently', () => {
    const limiter = createRateLimiter(1, 60_000);
    limiter.check('userA');
    expect(limiter.check('userA').allowed).toBe(false);
    expect(limiter.check('userB').allowed).toBe(true);
  });
});

import { requireApiKey } from '../../src/middleware/auth.js';

function makeAuthApp() {
  const app = express();
  app.use(express.json());
  app.get('/protected', requireApiKey, (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

describe('API key auth middleware (FIX 7)', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV, CALADDIN_API_KEY: 'test-secret-key' };
  });

  it('returns 401 when x-api-key header is missing', async () => {
    const app = makeAuthApp();
    const res = await request(app).get('/protected');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 401 when x-api-key is wrong', async () => {
    const app = makeAuthApp();
    const res = await request(app).get('/protected').set('x-api-key', 'wrong-key');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });

  it('passes through with correct key', async () => {
    const app = makeAuthApp();
    const res = await request(app).get('/protected').set('x-api-key', 'test-secret-key');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

vi.mock('../../src/core/voice-intent-pipeline.js', () => ({
  mapVoiceUtteranceToIntent: vi.fn().mockResolvedValue({
    intent: {
      intent: 'PROTECT_BLOCK',
      confidence: 0.9,
      rawUtterance: 'test',
      params: {},
      mappingMethod: 'direct',
    },
    meta: { haikuCalled: true, usedPendingTemplate: false, storedPendingTemplate: false },
  }),
}));
vi.mock('../../src/core/orchestrator.js', () => ({
  orchestrate: vi.fn().mockResolvedValue({
    success: true,
    intent: 'PROTECT_BLOCK',
    atomicOp: 'add_recurring_block',
    eventsAffected: [],
    requiresConfirmation: false,
  }),
}));
vi.mock('../../src/db/policies.js', () => ({
  getUserPolicy: vi.fn().mockResolvedValue({
    userId: '8b616ceb-7e77-4886-9361-92a534374fac',
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
  }),
}));
vi.mock('../../src/db/events.js', () => ({
  getEventsByUser: vi.fn().mockResolvedValue([]),
  getEventById: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../src/db/tokens.js', () => ({
  loadGoogleTokens: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../src/services/auth_service.js', () => ({
  getAuthService: vi.fn(() => ({
    getClientForUser: vi.fn().mockResolvedValue({ token: 'mock-oauth' }),
  })),
  AuthService: vi.fn().mockImplementation(() => ({
    getAuthorizedClientForSub: vi.fn().mockReturnValue(null),
    saveUserTokens: vi.fn(),
    generateAuthUrl: vi.fn().mockReturnValue('http://google.com/oauth'),
    isUserConnected: vi.fn().mockReturnValue(false),
  })),
}));
vi.mock('../../src/services/oauth-resolver.js', () => ({
  resolveOAuthClient: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../src/core/system-mode.js', () => ({
  resolveSystemMode: vi.fn().mockResolvedValue('FULL'),
}));

vi.mock('../../src/services/load_user_policy.js', () => ({
  loadUserPolicyRaw: vi.fn().mockImplementation((userId: string) =>
    Promise.resolve({
      userId: userId || '8b616ceb-7e77-4886-9361-92a534374fac',
      schemaVersion: 1,
      timezone: 'America/Chicago',
      chronotype: 'morning' as const,
      defaultBufferMinutes: 15,
      clusteringPreference: 'balanced' as const,
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
    })
  ),
}));
vi.mock('../../src/db/scheduling_sessions_queries.js', () => ({
  listHostSessionsWithPendingProposals: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../src/services/host_scheduling_chat.js', () => ({
  buildListProposalsResponse: vi.fn(),
  handleHostProposalCommand: vi.fn().mockResolvedValue(null),
  isHostProposalListQuery: vi.fn().mockReturnValue(false),
  countPendingProposalEntries: vi.fn().mockReturnValue(0),
  pendingProposalTipLine: vi.fn().mockReturnValue(''),
}));
vi.mock('googleapis', () => ({
  google: {
    calendar: vi.fn().mockReturnValue({
      events: {
        list: vi.fn().mockResolvedValue({ data: { items: [] } }),
      },
    }),
  },
}));

import { voiceRouter } from '../../src/routes/voice.js';
import cookieParser from 'cookie-parser';
import { CALADDIN_USER_COOKIE } from '../../src/constants.js';

const VOICE_UID = '8b616ceb-7e77-4886-9361-92a534374fac';

function makeVoiceApp() {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use('/voice', voiceRouter);
  return app;
}

describe('Utterance length limit (FIX 10)', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = {
      ...OLD_ENV,
      CALADDIN_API_KEY: 'test-secret-key',
    };
  });

  it('returns 400 when utterance exceeds 1000 characters', async () => {
    const app = makeVoiceApp();
    const res = await request(app)
      .post('/voice')
      .set('Cookie', [`${CALADDIN_USER_COOKIE}=${VOICE_UID}`])
      .set('x-api-key', 'test-secret-key')
      .send({ userId: VOICE_UID, utterance: 'x'.repeat(1001) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/too long/i);
  });

  it('accepts utterance of exactly 1000 characters', async () => {
    const app = makeVoiceApp();
    const res = await request(app)
      .post('/voice')
      .set('Cookie', [`${CALADDIN_USER_COOKIE}=${VOICE_UID}`])
      .set('x-api-key', 'test-secret-key')
      .send({ userId: VOICE_UID, utterance: 'x'.repeat(1000) });
    expect(res.status).not.toBe(400);
  });
});