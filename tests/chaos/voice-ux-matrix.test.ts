import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { CALADDIN_USER_COOKIE } from '../../src/constants.js';

vi.mock('../../src/core/system-mode.js', () => ({
  resolveSystemMode: vi.fn().mockResolvedValue('FULL'),
}));

vi.mock('../../src/core/voice-intent-pipeline.js', () => ({
  mapVoiceUtteranceToIntent: vi.fn().mockImplementation((utterance: string) =>
    Promise.resolve({
      intent: {
        intent: utterance.includes('block') ? 'PROTECT_BLOCK' : 'OFFER_SPECIFIC',
        confidence: 0.9,
        rawUtterance: utterance,
        params: {},
        mappingMethod: 'direct',
      },
      meta: { haikuCalled: true, usedPendingTemplate: false, storedPendingTemplate: false },
    })
  ),
}));

vi.mock('../../src/core/orchestrator.js', () => ({
  orchestrate: vi.fn().mockImplementation((intent: { intent: string }) =>
    Promise.resolve({
      success: true,
      intent: intent.intent,
      atomicOp: 'noop',
      eventsAffected: [],
      requiresConfirmation: false,
      messageToUser: 'Done.',
    })
  ),
}));

const { mockGetClientForUser } = vi.hoisted(() => ({
  mockGetClientForUser: vi.fn().mockResolvedValue({ token: 'oauth-ok' }),
}));

vi.mock('../../src/services/auth_service.js', () => ({
  getAuthService: () => ({
    getClientForUser: mockGetClientForUser,
  }),
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

const P = {
  userId: '77a22c75-4e6b-47ca-aee6-2f4ace21be53',
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
  protectedBlocks: [] as any[],
  contactTiers: {} as Record<string, number>,
};

vi.mock('../../src/db/policies.js', () => ({
  getPolicyByUserId: vi.fn().mockResolvedValue(P),
}));

vi.mock('../../src/services/load_user_policy.js', () => ({
  loadUserPolicyRaw: vi.fn().mockImplementation((id: string) => Promise.resolve({ ...P, userId: id })),
}));

vi.mock('../../src/db/scheduling_sessions_queries.js', () => ({
  listHostSessionsWithPendingProposals: vi.fn().mockResolvedValue([]),
}));

import { voiceRouter } from '../../src/routes/voice.js';

const UID = '77a22c75-4e6b-47ca-aee6-2f4ace21be53';

const testApp = (() => {
  const x = express();
  x.use(cookieParser());
  x.use(express.json());
  x.use('/voice', voiceRouter);
  return x;
})();

function buildUtterances(): string[] {
  const actions = ['block', 'protect', 'find', 'schedule', 'move', 'cancel'];
  const people = ['Alex', 'Priya', 'Sam', 'Jordan', 'Taylor'];
  const windows = ['next week', 'this week', 'tomorrow', 'Friday'];
  const specifics = ['for deep work', 'for a 30 minute sync', 'for project review', 'for follow-up'];
  const out: string[] = [];
  for (const a of actions) {
    for (const p of people) {
      for (const w of windows) {
        for (const s of specifics) {
          out.push(`${a} time with ${p} ${w} ${s}`);
        }
      }
    }
  }
  return out;
}

describe('Voice UX matrix (high-volume text asks)', () => {
  const utterances = buildUtterances();

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetClientForUser.mockReset();
    mockGetClientForUser.mockResolvedValue({ token: 'oauth-ok' });
  });

  it(
    `accepts ${buildUtterances().length} varied asks without 500s`,
    async () => {
      for (const utterance of utterances) {
        const res = await request(testApp)
          .post('/voice')
          .set('Cookie', `${CALADDIN_USER_COOKIE}=${UID}`)
          .send({ userId: UID, utterance });

        expect(res.status, `utterance="${utterance}" body=${JSON.stringify(res.body)}`).toBe(200);
        expect(res.body).toEqual(
          expect.objectContaining({
            success: true,
            requiresConfirmation: false,
            messageToUser: expect.any(String),
          })
        );
      }
    },
    30_000
  );
});
