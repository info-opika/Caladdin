/**
 * Regression: pilot smoke (query → create → modify → scheduling) must not false-429
 * when each step uses its own rate-limit bucket.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { CALADDIN_USER_COOKIE } from '../../src/constants.js';
import { VOICE_RATE_LIMIT_MUTATION_MAX } from '../../src/middleware/rate-limit.js';

const { USER_ID, MOCK_PROFILE } = vi.hoisted(() => {
  const userId = 'rate-limit-smoke-user-0000-4000-8000-000000000099';
  return {
    USER_ID: userId,
    MOCK_PROFILE: {
      userId,
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
    },
  };
});

vi.mock('../../src/services/auth_service.js', () => ({
  getAuthService: vi.fn(() => ({
    getClientForUser: vi.fn().mockResolvedValue({ token: 'oauth-ok' }),
  })),
}));

vi.mock('../../src/core/system-mode.js', () => ({
  resolveSystemMode: vi.fn().mockResolvedValue('FULL'),
}));

vi.mock('../../src/pilot/pilot_controls.js', () => ({
  isKillSwitchActive: vi.fn().mockReturnValue(false),
}));

vi.mock('../../src/core/voice-intent-pipeline.js', () => ({
  mapVoiceUtteranceToIntent: vi.fn().mockImplementation((utterance: string) => {
    const u = utterance.toLowerCase();
    let intent = 'QUERY_CALENDAR';
    if (u.includes('find time with')) intent = 'SCHEDULING_LINK';
    else if (u.includes('create')) intent = 'CREATE_EVENT';
    else if (u.includes('move')) intent = 'MODIFY_EVENT';
    return Promise.resolve({
      intent: {
        intent,
        confidence: 0.9,
        rawUtterance: utterance,
        params: {},
        mappingMethod: 'direct',
      },
      meta: { haikuCalled: false, usedPendingTemplate: false, storedPendingTemplate: false },
    });
  }),
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

vi.mock('../../src/core/modify-event-target.js', () => ({
  resolveModifyEventTarget: vi.fn().mockReturnValue({ kind: 'none', userMessage: 'not found' }),
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

vi.mock('../../src/services/load_user_policy.js', () => ({
  loadUserPolicyRaw: vi.fn().mockResolvedValue(MOCK_PROFILE),
}));

vi.mock('../../src/db/scheduling_sessions_queries.js', () => ({
  listHostSessionsWithPendingProposals: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/db/usage_events.js', () => ({
  logUsageEvent: vi.fn(),
}));

describe('/voice rate limit smoke sequence', () => {
  const prevE2e = process.env.CALADDIN_E2E;

  beforeEach(() => {
    delete process.env.CALADDIN_E2E;
  });

  afterEach(() => {
    if (prevE2e === undefined) delete process.env.CALADDIN_E2E;
    else process.env.CALADDIN_E2E = prevE2e;
  });

  const agent = () => {
    const app = createApp();
    return request.agent(app).set('Cookie', `${CALADDIN_USER_COOKIE}=${USER_ID}`);
  };

  it('allows query → create → modify → scheduling in one session without 429', async () => {
    const a = agent();
    const steps = [
      { utterance: "what's on my calendar today" },
      { utterance: 'create a 30 minute meeting with alex@example.com tomorrow at 2pm' },
      { utterance: 'move my 3pm call to Friday morning' },
      {
        utterance:
          'Find time with invitee.smoke@example.com tomorrow between 2pm and 6pm for a 30 minute meeting',
      },
    ];

    for (const { utterance } of steps) {
      const res = await a.post('/voice').send({ utterance });
      expect(res.status, `429 on "${utterance}"`).not.toBe(429);
      expect(res.status).toBe(200);
    }
  });

  it('still rate-limits abusive mutation volume', async () => {
    const a = agent();
    let lastStatus = 200;
    for (let i = 0; i < VOICE_RATE_LIMIT_MUTATION_MAX + 2; i++) {
      const res = await a.post('/voice').send({
        utterance: `create meeting ${i} with alex@example.com tomorrow at 2pm`,
      });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
    const body = await a.post('/voice').send({
      utterance: 'create another meeting with alex@example.com tomorrow at 3pm',
    });
    expect(body.status).toBe(429);
    expect(body.body?.error).toMatch(/too many requests/i);
  });
});
