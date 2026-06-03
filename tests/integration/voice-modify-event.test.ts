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
const mockGcalDelete = vi.fn();
const mockGcalUpdate = vi.fn();

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

vi.mock('../../src/services/gcal.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/gcal.js')>();
  return {
    ...actual,
    gcalDeleteEvent: (...a: unknown[]) => mockGcalDelete(...a),
    gcalUpdateEvent: (...a: unknown[]) => mockGcalUpdate(...a),
  };
});

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

vi.mock('../../src/services/llm.js', async (importOriginal) => {
  const m = await importOriginal<typeof import('../../src/services/llm.js')>();
  return {
    ...m,
    classifyIntent: vi.fn(async (utterance: string) => {
    const u = utterance.toLowerCase();
    if (/\brename\b/.test(u)) {
      return {
        intent: 'MODIFY_EVENT',
        confidence: 0.9,
        params: { renameFrom: 'lunch', newTitle: 'investor call' },
        mappingMethod: 'direct',
        rawUtterance: utterance,
      };
    }
    if (/\b30 minutes\b/.test(u)) {
      return {
        intent: 'MODIFY_EVENT',
        confidence: 0.9,
        params: { newDurationMinutes: 30 },
        mappingMethod: 'direct',
        rawUtterance: utterance,
      };
    }
    return {
      intent: 'MODIFY_EVENT',
      confidence: 0.9,
      params: { operation: 'delete' },
      mappingMethod: 'direct',
      rawUtterance: utterance,
    };
  }),
  };
});

const HOST = '77777777-7777-7777-8777-777777777777';

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

describe('voice — MODIFY_EVENT', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-26T12:00:00.000-05:00'));
    mockListPending.mockResolvedValue([]);
    mockLoadPolicy.mockResolvedValue(PROFILE);
    mockGetClient.mockResolvedValue({});
    mockGcalDelete.mockResolvedValue(undefined);
    mockGcalUpdate.mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('cancel my 3pm meeting tomorrow deletes matching event via gcalDeleteEvent', async () => {
    gcalList.mockResolvedValue({
      data: {
        items: [
          {
            id: 'evt-3pm-tom',
            summary: 'Sync',
            start: { dateTime: '2026-04-27T15:00:00-05:00' },
            end: { dateTime: '2026-04-27T15:30:00-05:00' },
          },
        ],
      },
    });
    const res = await request(app())
      .post('/voice')
      .set('Cookie', [`${CALADDIN_USER_COOKIE}=${HOST}`])
      .send({ utterance: 'cancel my 3pm meeting tomorrow' });
    expect(res.status).toBe(200);
    expect(res.body.intent).toBe('MODIFY_EVENT');
    expect(res.body.success).toBe(true);
    expect(mockGcalDelete).toHaveBeenCalledWith(expect.anything(), 'evt-3pm-tom');
    expect(mockGcalUpdate).not.toHaveBeenCalled();
  });

  it('rename lunch to investor call updates summary', async () => {
    gcalList.mockResolvedValue({
      data: {
        items: [
          {
            id: 'lunch-1',
            summary: 'Team lunch',
            start: { dateTime: '2026-04-27T12:00:00-05:00' },
            end: { dateTime: '2026-04-27T13:00:00-05:00' },
          },
        ],
      },
    });
    const res = await request(app())
      .post('/voice')
      .set('Cookie', [`${CALADDIN_USER_COOKIE}=${HOST}`])
      .send({ utterance: 'rename lunch to investor call' });
    expect(res.status).toBe(200);
    expect(res.body.intent).toBe('MODIFY_EVENT');
    expect(res.body.success).toBe(true);
    expect(mockGcalUpdate).toHaveBeenCalledWith(
      expect.anything(),
      'lunch-1',
      expect.objectContaining({
        summary: 'investor call',
        timezone: 'America/Chicago',
      })
    );
    expect(mockGcalDelete).not.toHaveBeenCalled();
  });

  it('make my 3pm meeting 30 minutes patches start/end duration', async () => {
    gcalList.mockResolvedValue({
      data: {
        items: [
          {
            id: 'meet-1',
            summary: 'Client meeting',
            start: { dateTime: '2026-04-27T15:00:00-05:00' },
            end: { dateTime: '2026-04-27T16:00:00-05:00' },
          },
        ],
      },
    });
    const res = await request(app())
      .post('/voice')
      .set('Cookie', [`${CALADDIN_USER_COOKIE}=${HOST}`])
      .send({ utterance: 'make my 3pm meeting 30 minutes' });
    expect(res.status).toBe(200);
    expect(res.body.intent).toBe('MODIFY_EVENT');
    expect(res.body.success).toBe(true);
    expect(mockGcalUpdate).toHaveBeenCalled();
    const [, , patch] = mockGcalUpdate.mock.calls[0]!;
    expect(patch.start).toBeTruthy();
    expect(patch.end).toBeTruthy();
    expect(mockGcalDelete).not.toHaveBeenCalled();
  });
});
