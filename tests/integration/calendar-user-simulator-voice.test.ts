import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import voiceRouter from '../../src/routes/voice.js';
import { CALADDIN_USER_COOKIE } from '../../src/constants.js';
import {
  getVoiceGauntletSubset,
  buildMockClassifyForSimulatorItem,
} from '../fixtures/calendar-user-simulator-corpus.js';
import type { SimulatorItem } from '../fixtures/calendar-user-simulator-corpus.js';

const mockListPending = vi.fn();
const mockLoadPolicy = vi.fn();
const mockGetClient = vi.fn();
const gcalList = vi.fn();
const gcalInsert = vi.fn();

vi.mock('../../src/db/scheduling_sessions_queries.js', () => ({
  listHostSessionsWithPendingProposals: (...a: unknown[]) => mockListPending(...a),
}));

vi.mock('../../src/db/usage_events.js', () => ({
  logUsageEvent: vi.fn(),
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
        insert: (...a: unknown[]) => gcalInsert(...a),
      },
      freebusy: {
        query: async () => ({ data: { calendars: { primary: { busy: [] } } } }),
      },
    }),
  },
}));

vi.mock('../../src/services/llm.js', async (importOriginal) => {
  const m = await importOriginal<typeof import('../../src/services/llm.js')>();
  return { ...m, classifyIntent: vi.fn() };
});

vi.mock('../../src/services/proposal_host_actions.js', () => ({
  hostAcceptProposal: vi.fn(),
  hostIgnoreProposal: vi.fn(),
}));

vi.mock('../../src/db/failures.js', () => ({
  insertFailureLog: vi.fn().mockResolvedValue(undefined),
}));

import { classifyIntent } from '../../src/services/llm.js';
import { _resetPendingIntentStoreForTests } from '../../src/core/pending-intent-memory.js';

const mockClassify = vi.mocked(classifyIntent);

const HOST = '00000000-0000-4000-8000-00000000cafe';

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

function voiceSubset(): SimulatorItem[] {
  return getVoiceGauntletSubset(180);
}

describe('calendar user simulator — /voice representative gauntlet (mocked GCal + Anthropic)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetPendingIntentStoreForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-26T15:00:00.000Z'));
    mockListPending.mockResolvedValue([]);
    mockLoadPolicy.mockResolvedValue(PROFILE);
    mockGetClient.mockResolvedValue({});
    gcalList.mockResolvedValue({ data: { items: [] } });
    gcalInsert.mockResolvedValue({
      data: {
        id: 'mock-insert-id',
        summary: 'mock',
        start: { dateTime: '2026-04-26T10:00:00', timeZone: 'America/Chicago' },
        end: { dateTime: '2026-04-26T11:00:00', timeZone: 'America/Chicago' },
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it(
    'runs >= 180 utterances without 5xx, deterministic queries avoid RESOLVE_MANUAL and classifier-down copy',
    async () => {
      const items = voiceSubset();
      expect(items.length).toBeGreaterThanOrEqual(180);
      for (const item of items) {
        mockClassify.mockReset();
        if (item.shouldUseLLM === false) {
          mockClassify.mockImplementation(() => Promise.reject(new Error('no LLM for voice')));
        } else {
          const mock = buildMockClassifyForSimulatorItem(item);
          mockClassify.mockImplementation(() => Promise.resolve(mock));
        }
        const res = await request(app())
          .post('/voice')
          .set('Cookie', [`${CALADDIN_USER_COOKIE}=${HOST}`])
          .send({ utterance: item.utterance });
        expect(res.status, item.utterance).toBe(200);
        const body = res.body as { intent?: string; messageToUser?: string };
        if (
          (item.category === 'calendar_query' || item.category === 'availability') &&
          item.shouldUseLLM === false
        ) {
          expect(body.intent, item.utterance).toBe('QUERY_CALENDAR');
          expect(String(body.messageToUser), item.utterance).not.toMatch(
            /classifier|wasn.?t sure|not sure what you meant|ai unavailable/i
          );
          expect(body.intent).not.toBe('RESOLVE_MANUAL');
        }
        if (item.category === 'non_calendar' && item.shouldUseLLM === false) {
          expect(body.intent, item.utterance).toBe('WARM_REDIRECT');
        }
      }
    },
    60000
  );
});
