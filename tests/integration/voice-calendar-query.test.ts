import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import voiceRouter from '../../src/routes/voice.js';
import { CALADDIN_USER_COOKIE } from '../../src/constants.js';

const mockListPending = vi.fn();
const mockLoadPolicy = vi.fn();
const mockGetClient = vi.fn();
const gcalList = vi.fn();

vi.mock('../../src/db/scheduling_sessions_queries.js', () => ({
  listHostSessionsWithPendingProposals: (...a: unknown[]) => mockListPending(...a),
}));

vi.mock('../../src/services/load_user_policy.js', () => ({
  loadUserPolicyRaw: (...a: unknown[]) => mockLoadPolicy(...a),
}));

vi.mock('../../src/services/auth_service.js', () => ({
  getAuthService: () => ({ getClientForUser: (...a: unknown[]) => mockGetClient(...a) }),
}));

vi.mock('../../src/core/system-mode.js', () => ({
  resolveSystemMode: () => Promise.resolve('FULL'),
}));

vi.mock('googleapis', () => ({
  google: {
    calendar: () => ({
      events: {
        list: (...a: unknown[]) => gcalList(...a),
      },
    }),
  },
}));

vi.mock('../../src/services/proposal_host_actions.js', () => ({
  hostAcceptProposal: vi.fn(),
  hostIgnoreProposal: vi.fn(),
}));

vi.mock('../../src/services/llm.js', () => ({
  classifyIntent: vi.fn(async (utterance: string) => {
    const u = utterance.toLowerCase();
    if (/\btomorrow\b/.test(u)) {
      return {
        intent: 'QUERY_CALENDAR',
        confidence: 0.92,
        params: { queryType: 'tomorrow' },
        mappingMethod: 'direct',
        rawUtterance: utterance,
      };
    }
    if (/\bnext meeting\b/.test(u)) {
      return {
        intent: 'QUERY_CALENDAR',
        confidence: 0.92,
        params: { queryType: 'next' },
        mappingMethod: 'direct',
        rawUtterance: utterance,
      };
    }
    return {
      intent: 'QUERY_CALENDAR',
      confidence: 0.92,
      params: { queryType: 'today' },
      mappingMethod: 'direct',
      rawUtterance: utterance,
    };
  }),
}));

const HOST = '66666666-6666-6666-8666-666666666666';

const PROFILE = {
  userId: HOST,
  schemaVersion: 1,
  timezone: 'America/Chicago',
  chronotype: 'flexible' as const,
  defaultBufferMinutes: 15,
  clusteringPreference: 'balanced' as const,
  maxFragmentsPerDay: 3,
  faxEffectConfig: {
    targetSlotsPerOffer: 2,
    minBufferMinutes: 15,
    clusteringWeight: 1,
    energyWeight: 1,
    fragmentPenaltyWeight: 1,
    protectDeepWorkBlocks: true,
  },
  protectedBlocks: [] as any[],
  contactTiers: {} as any,
};

function app() {
  const x = express();
  x.use(cookieParser());
  x.use(express.json());
  x.use('/voice', voiceRouter);
  return x;
}

describe('voice — QUERY_CALENDAR (Haiku ADT mock + orchestrate)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-26T15:00:00.000Z'));
    mockListPending.mockResolvedValue([]);
    mockLoadPolicy.mockResolvedValue(PROFILE);
    mockGetClient.mockResolvedValue({});
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('What’s on my calendar today? does not return RESOLVE_MANUAL', async () => {
    gcalList.mockResolvedValue({ data: { items: [] } });
    const res = await request(app())
      .post('/voice')
      .set('Cookie', [`${CALADDIN_USER_COOKIE}=${HOST}`])
      .send({ utterance: 'What’s on my calendar today?' });
    expect(res.status).toBe(200);
    expect(res.body.messageToUser).not.toMatch(/wasn't sure|not sure what you meant/i);
  });

  it('what is on my calendar tomorrow? returns QUERY_CALENDAR, not RESOLVE_MANUAL', async () => {
    gcalList.mockResolvedValue({ data: { items: [] } });
    const res = await request(app())
      .post('/voice')
      .set('Cookie', [`${CALADDIN_USER_COOKIE}=${HOST}`])
      .send({ utterance: 'what is on my calendar tomorrow?' });
    expect(res.status).toBe(200);
    expect(res.body.intent).toBe('QUERY_CALENDAR');
    expect(res.body.messageToUser).not.toMatch(/wasn't sure|not sure what you meant/i);
  });

  it('when is my next meeting? returns next-event agenda (prefilter, no classifier-down copy)', async () => {
    gcalList.mockResolvedValue({ data: { items: [] } });
    const res = await request(app())
      .post('/voice')
      .set('Cookie', [`${CALADDIN_USER_COOKIE}=${HOST}`])
      .send({ utterance: 'when is my next meeting?' });
    expect(res.status).toBe(200);
    expect(res.body.intent).toBe('QUERY_CALENDAR');
    expect(res.body.messageToUser).not.toMatch(/classifier|wasn't sure|not sure what you meant|ai unavailable/i);
  });

  it('lists events when GCal returns items', async () => {
    gcalList.mockResolvedValue({
      data: {
        items: [
          {
            id: 'ev1',
            summary: 'Board review',
            start: { dateTime: '2026-04-26T15:00:00-05:00' },
            end: { dateTime: '2026-04-26T16:00:00-05:00' },
          },
        ],
      },
    });
    const res = await request(app())
      .post('/voice')
      .set('Cookie', [`${CALADDIN_USER_COOKIE}=${HOST}`])
      .send({ utterance: "What's on my calendar today?" });
    expect(res.status).toBe(200);
    expect(res.body.messageToUser).toMatch(/Board review/i);
  });
});
