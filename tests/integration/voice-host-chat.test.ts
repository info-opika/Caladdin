import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import voiceRouter from '../../src/routes/voice.js';
import { CALADDIN_USER_COOKIE } from '../../src/constants.js';

const mockListPending = vi.fn();
const mockLoadPolicy = vi.fn();
const mockGetClient = vi.fn();
const mockMapVoice = vi.fn();
const mockOrchestrate = vi.fn();
const mockAccept = vi.fn();
const mockIgnore = vi.fn();

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

vi.mock('../../src/core/voice-intent-pipeline.js', () => ({
  mapVoiceUtteranceToIntent: (...a: unknown[]) => mockMapVoice(...a),
}));

vi.mock('../../src/core/orchestrator.js', () => ({
  orchestrate: (...a: unknown[]) => mockOrchestrate(...a),
}));

vi.mock('googleapis', () => ({
  google: {
    calendar: () => ({
      events: {
        list: vi.fn().mockResolvedValue({ data: { items: [] } }),
      },
    }),
  },
}));

vi.mock('../../src/services/proposal_host_actions.js', () => ({
  hostAcceptProposal: (...a: unknown[]) => mockAccept(...a),
  hostIgnoreProposal: (...a: unknown[]) => mockIgnore(...a),
}));

const HOST = '44444444-4444-4444-8444-444444444444';

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
  protectedBlocks: [],
  contactTiers: {},
};

const TOK = 'b'.repeat(32);

function app() {
  const x = express();
  x.use(cookieParser());
  x.use(express.json());
  x.use('/voice', voiceRouter);
  return x;
}

describe('voice host chat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadPolicy.mockResolvedValue(PROFILE);
    mockGetClient.mockResolvedValue({});
    mockListPending.mockResolvedValue([]);
    mockMapVoice.mockResolvedValue({
      intent: {
        intent: 'QUERY_CALENDAR',
        confidence: 1,
        rawUtterance: 'x',
        params: {},
        mappingMethod: 'direct',
      },
      meta: { haikuCalled: true, usedPendingTemplate: false, storedPendingTemplate: false },
    });
    mockOrchestrate.mockResolvedValue({
      success: true,
      intent: 'QUERY_CALENDAR',
      atomicOp: 'noop',
      eventsAffected: [],
      messageToUser: 'Hello',
    });
    mockAccept.mockResolvedValue({
      ok: true,
      applied: true,
      googleEventId: 'cal_evt',
      message: 'Added to your calendar.',
    });
    mockIgnore.mockResolvedValue({ ok: true, applied: true, message: 'Ignored.' });
  });

  it('list proposals returns formatted lines and appends pending tip', async () => {
    mockListPending.mockResolvedValue([
      {
        token: TOK,
        invitee_email: 'g@ex.com',
        proposed_alternatives: [
          {
            email: 'i@ex.com',
            proposedDate: '2026-06-03',
            proposedTimeWindow: '2pm',
            submittedAt: 't',
            status: 'pending',
          },
        ],
      },
    ]);
    const res = await request(app())
      .post('/voice')
      .set('Cookie', [`${CALADDIN_USER_COOKIE}=${HOST}`])
      .send({ utterance: 'show proposals' });
    expect(res.status).toBe(200);
    expect(res.body.messageToUser).toContain('[i@ex.com] proposed 2026-06-03 at 2pm');
    expect(res.body.messageToUser).toContain('You have 1 pending scheduling proposal');
    expect(res.body.pendingProposalCount).toBe(1);
  });

  it('orchestrator response gets pendingProposalTip when proposals exist', async () => {
    mockListPending.mockResolvedValue([
      {
        token: TOK,
        proposed_alternatives: [
          { proposedDate: '2026-06-04', proposedTimeWindow: '3pm', submittedAt: 't', status: 'pending' },
        ],
      },
    ]);
    const res = await request(app())
      .post('/voice')
      .set('Cookie', [`${CALADDIN_USER_COOKIE}=${HOST}`])
      .send({ utterance: 'what is on my calendar' });
    expect(res.status).toBe(200);
    expect(res.body.messageToUser).toContain('Hello');
    expect(res.body.messageToUser).toContain('show proposals');
    expect(mockMapVoice).toHaveBeenCalled();
    expect(mockOrchestrate).toHaveBeenCalled();
  });

  it('accept proposal command calls hostAcceptProposal', async () => {
    mockListPending.mockResolvedValue([]);
    const res = await request(app())
      .post('/voice')
      .set('Cookie', [`${CALADDIN_USER_COOKIE}=${HOST}`])
      .send({ utterance: `accept proposal 0 ${TOK}` });
    expect(res.status).toBe(200);
    expect(mockAccept).toHaveBeenCalledWith(TOK, 0, HOST, expect.anything(), expect.objectContaining({ userId: HOST }));
    expect(res.body.messageToUser).toContain('Added to your calendar');
  });

  it('ignore proposal command calls hostIgnoreProposal', async () => {
    mockListPending.mockResolvedValue([]);
    const res = await request(app())
      .post('/voice')
      .set('Cookie', [`${CALADDIN_USER_COOKIE}=${HOST}`])
      .send({ utterance: `ignore proposal 0 ${TOK}` });
    expect(res.status).toBe(200);
    expect(mockIgnore).toHaveBeenCalledWith(TOK, 0, HOST);
  });
});
