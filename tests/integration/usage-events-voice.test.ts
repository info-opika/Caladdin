/**
 * Ensures /voice emits usage_events calls without breaking the response path.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { CALADDIN_USER_COOKIE } from '../../src/constants.js';

const { logCalls } = vi.hoisted(() => {
  const logCalls: { eventType: string; userId?: string | null }[] = [];
  return { logCalls };
});

vi.mock('../../src/db/usage_events.js', () => ({
  logUsageEvent: (input: { eventType: string; userId?: string | null }) => {
    logCalls.push({ eventType: input.eventType, userId: input.userId });
  },
}));

const { MOCK_PROFILE, mockGetClientForUser } = vi.hoisted(() => {
  const mockGetClientForUser = vi.fn().mockResolvedValue({ token: 'oauth-ok' });
  return {
    MOCK_PROFILE: {
      userId: 'cookie-user-0000-0000-4000-8000-000000000001',
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
    mockGetClientForUser,
  };
});

vi.mock('../../src/services/auth_service.js', () => ({
  getAuthService: vi.fn(() => ({
    getClientForUser: mockGetClientForUser,
  })),
}));

vi.mock('../../src/core/system-mode.js', () => ({
  resolveSystemMode: vi.fn().mockResolvedValue('FULL'),
}));

vi.mock('../../src/core/voice-intent-pipeline.js', () => ({
  mapVoiceUtteranceToIntent: vi.fn().mockResolvedValue({
    intent: {
      intent: 'QUERY_CALENDAR',
      confidence: 0.99,
      rawUtterance: 'What is on my calendar today?',
      params: { queryType: 'today' },
      mappingMethod: 'direct',
    },
    meta: { haikuCalled: true, usedPendingTemplate: false, storedPendingTemplate: false },
  }),
}));

vi.mock('../../src/core/orchestrator.js', () => ({
  orchestrate: vi.fn().mockResolvedValue({
    success: true,
    intent: 'QUERY_CALENDAR',
    atomicOp: 'query_calendar',
    eventsAffected: [],
    requiresConfirmation: false,
    messageToUser: 'Nothing scheduled today.',
  }),
}));

vi.mock('../../src/services/load_user_policy.js', () => ({
  loadUserPolicyRaw: vi.fn().mockResolvedValue(MOCK_PROFILE),
}));

vi.mock('../../src/db/scheduling_sessions_queries.js', () => ({
  listHostSessionsWithPendingProposals: vi.fn().mockResolvedValue([]),
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

import voiceRoutes from '../../src/routes/voice.js';

function app() {
  const a = express();
  a.use(express.json());
  a.use(cookieParser());
  a.use('/voice', voiceRoutes);
  return a;
}

describe('/voice usage instrumentation', () => {
  afterEach(() => {
    logCalls.length = 0;
  });

  it('logs chat_command_submitted and chat_command_succeeded on happy path', async () => {
    const userId = MOCK_PROFILE.userId;
    const res = await request(app())
      .post('/voice')
      .set('Cookie', `${CALADDIN_USER_COOKIE}=${userId}`)
      .send({ utterance: 'What is on my calendar today?' });

    expect(res.status).toBe(200);
    expect(res.body.messageToUser).toBeDefined();
    const types = logCalls.map((c) => c.eventType);
    expect(types).toContain('chat_command_submitted');
    expect(types).toContain('chat_command_succeeded');
    expect(logCalls.some((c) => c.eventType === 'chat_command_submitted' && c.userId === userId)).toBe(true);
  });
});
