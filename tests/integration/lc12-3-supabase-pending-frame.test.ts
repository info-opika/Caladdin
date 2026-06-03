/**
 * LC12.3 — Supabase-backed pending clarification frames (route + storage).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import voiceRouter from '../../src/routes/voice.js';
import { CALADDIN_USER_COOKIE } from '../../src/constants.js';
import {
  _resetPendingIntentStoreForTests,
  _clearPendingFrameStorageOverrideForTests,
  getPendingIntent,
  _setExpiredPendingForTests,
} from '../../src/core/pending-intent-memory.js';
import {
  SharedInMemoryPendingFrameStorage,
  getPendingFrameStorageKind,
  upsertPendingFrame,
  getPendingFrame,
  clearPendingFrame,
} from '../../src/db/pending-clarification-frames.js';

const mockListPending = vi.fn();
const mockLoadPolicy = vi.fn();
const mockGetClient = vi.fn();
const mockOrchestrate = vi.fn();

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

vi.mock('../../src/core/orchestrator.js', () => ({
  orchestrate: (...a: unknown[]) => mockOrchestrate(...a),
}));

vi.mock('../../src/services/llm.js', async (importOriginal) => {
  const m = await importOriginal<typeof import('../../src/services/llm.js')>();
  return { ...m, classifyIntent: vi.fn() };
});

vi.mock('googleapis', () => ({
  google: {
    calendar: () => ({
      events: {
        list: vi.fn().mockResolvedValue({ data: { items: [] } }),
      },
    }),
  },
}));

import { classifyIntent } from '../../src/services/llm.js';

const mockClassify = vi.mocked(classifyIntent);

const HOST = '5bf20398-930a-4afc-8460-7668d7423916';

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

const SCHED_KNOWN = {
  inviteeEmail: 'kanth.miriyala@gmail.com',
  parsedSchedulingDateRange: { start: '2026-05-25', end: '2026-05-31' },
  schedulingUnsupportedConstraints: [] as string[],
  schedulingDefaultSearchWindow: true,
};

function app() {
  const x = express();
  x.use(cookieParser());
  x.use(express.json());
  x.use('/voice', voiceRouter);
  return x;
}

function postVoice(utterance: string) {
  return request(app())
    .post('/voice')
    .set('Cookie', `${CALADDIN_USER_COOKIE}=${HOST}`)
    .send({ transcript: utterance });
}

describe('LC12.3 Supabase pending frame — /voice route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetPendingIntentStoreForTests();
    mockLoadPolicy.mockResolvedValue(PROFILE);
    mockGetClient.mockResolvedValue({});
    mockListPending.mockResolvedValue([]);
    mockClassify.mockReset();
    mockOrchestrate.mockReset();
  });

  afterEach(() => {
    _clearPendingFrameStorageOverrideForTests();
  });

  it('1. exact live transcript continues scheduling on turn 2 (not warm redirect)', async () => {
    mockClassify.mockResolvedValueOnce({
      intent: 'SCHEDULING_LINK',
      confidence: 0.92,
      params: { ...SCHED_KNOWN },
      mappingMethod: 'direct',
      rawUtterance: 'Find time with kanth.miriyala@gmail.com next week',
    });
    mockOrchestrate.mockResolvedValueOnce({
      success: false,
      intent: 'SCHEDULING_LINK',
      atomicOp: 'scheduling_link',
      eventsAffected: [],
      requiresConfirmation: false,
      failureReason: 'scheduling_window_missing',
      messageToUser:
        'What time window should I search? Say both start and end (for example 9am to 5pm).',
    });

    const turn1 = await postVoice('Find time with kanth.miriyala@gmail.com next week');
    expect(turn1.status).toBe(200);
    const pending = await getPendingIntent(HOST);
    expect(pending?.pendingIntent).toBe('SCHEDULING_LINK');

    mockOrchestrate.mockResolvedValueOnce({
      success: true,
      intent: 'SCHEDULING_LINK',
      atomicOp: 'scheduling_link',
      eventsAffected: [],
      requiresConfirmation: false,
      messageToUser: 'Here are two times that work.',
      schedulingUrl: 'https://example.test/s/abc',
    });

    const turn2 = await postVoice('yes, 9am to 5pm');
    expect(turn2.status).toBe(200);
    expect(turn2.body.intent).toBe('SCHEDULING_LINK');
    expect(turn2.body.messageToUser).not.toMatch(/handles calendars and scheduling/i);
    expect(mockClassify).toHaveBeenCalledTimes(1);
    const arg = mockOrchestrate.mock.calls[1]![0] as { intent: string; params: Record<string, unknown> };
    expect(arg.intent).toBe('SCHEDULING_LINK');
    expect(arg.params['windowStartHourLocal']).toBe(9);
    expect(arg.params['windowEndHourLocal']).toBe(17);
    expect(await getPendingIntent(HOST)).toBeNull();
  });

  it('2. cross-instance: write via storage A, read via storage B', async () => {
    const [writer, reader] = SharedInMemoryPendingFrameStorage.createSharedPair();
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 900_000).toISOString();
    await writer.upsertPendingFrame(HOST, {
      pendingIntent: 'SCHEDULING_LINK',
      knownFields: SCHED_KNOWN,
      missingFields: ['windowStartHourLocal', 'windowEndHourLocal'],
      originalUtterance: 'Find time with kanth.miriyala@gmail.com next week',
      createdAt,
      expiresAt,
    });
    const read = await reader.getPendingFrame(HOST);
    expect(read?.knownFields['inviteeEmail']).toBe('kanth.miriyala@gmail.com');
  });

  it('3. success clears frame', async () => {
    mockClassify.mockResolvedValueOnce({
      intent: 'SCHEDULING_LINK',
      confidence: 0.9,
      params: { ...SCHED_KNOWN },
      mappingMethod: 'direct',
      rawUtterance: 'Find time with kanth.miriyala@gmail.com next week',
    });
    mockOrchestrate
      .mockResolvedValueOnce({
        success: false,
        intent: 'SCHEDULING_LINK',
        atomicOp: 'scheduling_link',
        eventsAffected: [],
        failureReason: 'scheduling_window_missing',
        messageToUser: 'What time window?',
      })
      .mockResolvedValueOnce({
        success: true,
        intent: 'SCHEDULING_LINK',
        atomicOp: 'scheduling_link',
        eventsAffected: [],
        messageToUser: 'ok',
      });
    await postVoice('Find time with kanth.miriyala@gmail.com next week');
    expect(await getPendingIntent(HOST)).not.toBeNull();
    await postVoice('yes, 9am to 5pm');
    expect(await getPendingIntent(HOST)).toBeNull();
  });

  it('4. expired frame ignored', async () => {
    await _setExpiredPendingForTests(HOST, {
      pendingIntent: 'SCHEDULING_LINK',
      knownFields: { ...SCHED_KNOWN },
      missingFields: ['windowStartHourLocal', 'windowEndHourLocal'],
      originalUtterance: 'Find time with kanth.miriyala@gmail.com next week',
    });
    mockOrchestrate.mockResolvedValue({
      success: true,
      intent: 'WARM_REDIRECT',
      atomicOp: 'warm_redirect',
      eventsAffected: [],
      messageToUser:
        'Caladdin handles calendars and scheduling. For other topics, your favorite search or assistant is a better fit — ask me anytime you want to move, book, or protect time.',
      isWarmRedirect: true,
    });
    const res = await postVoice('yes, 9am to 5pm');
    expect(res.body.intent).toBe('WARM_REDIRECT');
    expect((mockOrchestrate.mock.calls[0]![0] as { intent: string }).intent).toBe('WARM_REDIRECT');
  });

  it('5. standalone fragment safe (no pending)', async () => {
    mockOrchestrate.mockResolvedValue({
      success: true,
      intent: 'WARM_REDIRECT',
      atomicOp: 'warm_redirect',
      eventsAffected: [],
      messageToUser:
        'Caladdin handles calendars and scheduling. For other topics, your favorite search or assistant is a better fit — ask me anytime you want to move, book, or protect time.',
      isWarmRedirect: true,
    });
    const res = await postVoice('yes, 9am to 5pm');
    expect(res.body.intent).toBe('WARM_REDIRECT');
    expect(mockClassify).not.toHaveBeenCalled();
  });

  it('6. unrelated reply clears pending and warm-redirects', async () => {
    mockClassify.mockResolvedValueOnce({
      intent: 'SCHEDULING_LINK',
      confidence: 0.9,
      params: { ...SCHED_KNOWN },
      mappingMethod: 'direct',
      rawUtterance: 'Find time with kanth.miriyala@gmail.com next week',
    });
    mockOrchestrate.mockResolvedValueOnce({
      success: false,
      intent: 'SCHEDULING_LINK',
      atomicOp: 'scheduling_link',
      eventsAffected: [],
      failureReason: 'scheduling_window_missing',
      messageToUser: 'What time window?',
    });
    await postVoice('Find time with kanth.miriyala@gmail.com next week');
    mockOrchestrate.mockResolvedValue({
      success: true,
      intent: 'WARM_REDIRECT',
      atomicOp: 'warm_redirect',
      eventsAffected: [],
      messageToUser: 'Caladdin handles calendars and scheduling.',
      isWarmRedirect: true,
    });
    const res = await postVoice('tell me a joke');
    expect(res.body.intent).toBe('WARM_REDIRECT');
    expect(await getPendingIntent(HOST)).toBeNull();
  });

  it('7. same user/session key stable across write and read', async () => {
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 900_000).toISOString();
    await upsertPendingFrame(HOST, {
      pendingIntent: 'SCHEDULING_LINK',
      knownFields: SCHED_KNOWN,
      missingFields: ['windowStartHourLocal'],
      originalUtterance: 'x',
      createdAt,
      expiresAt,
    });
    const row = await getPendingFrame(HOST);
    expect(row?.originalUtterance).toBe('x');
    await clearPendingFrame(HOST);
    expect(await getPendingFrame(HOST)).toBeNull();
  });

  it('8. production storage kind is supabase when test override cleared', () => {
    _clearPendingFrameStorageOverrideForTests();
    expect(getPendingFrameStorageKind()).toBe('supabase');
  });
});
