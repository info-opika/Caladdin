import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockGetPolicy = vi.fn();
const mockGetUserById = vi.fn();
const mockEnsureDefaultPolicy = vi.fn();
const mockGetConversationContext = vi.fn();
const mockGetPendingEmailConfirmation = vi.fn();
const mockGetPendingSetupIntent = vi.fn();
const mockSavePendingSetupIntent = vi.fn();
const mockMapVoiceUtteranceToIntent = vi.fn();
const mockOrchestrate = vi.fn();
const mockHandleEmailConfirmationGate = vi.fn();
const mockApplyConversationContext = vi.fn();
const mockApprovePendingConfirmation = vi.fn();
const mockRejectPendingConfirmation = vi.fn();
const mockVoiceRateCheck = vi.fn();
const mockInsertCommandLog = vi.fn();
const mockUpdateCommandLogParsed = vi.fn();
const mockUpdateCommandLogAgentTrace = vi.fn();

const mockAgentTrace = {
  model: 'claude-sonnet-4-6',
  rounds: 1,
  totalLatencyMs: 12,
  tools: [] as Array<{ name: string; latencyMs: number; ok: boolean }>,
};
const mockAgentEnabledFor = vi.fn();
const mockRunSchedulingAgent = vi.fn();

vi.mock('../../src/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/config.js')>();
  return {
    ...actual,
    agentEnabledFor: (...args: unknown[]) => mockAgentEnabledFor(...args),
  };
});

vi.mock('../../src/agent/scheduling-agent.js', () => ({
  runSchedulingAgent: (...args: unknown[]) => mockRunSchedulingAgent(...args),
}));

vi.mock('../../src/db/users.js', () => ({
  getPolicy: (...args: unknown[]) => mockGetPolicy(...args),
  getUserById: (...args: unknown[]) => mockGetUserById(...args),
  ensureDefaultPolicy: (...args: unknown[]) => mockEnsureDefaultPolicy(...args),
  recordSetupFieldAnswer: vi.fn(),
}));

vi.mock('../../src/db/conversation-context.js', () => ({
  getConversationContext: (...args: unknown[]) => mockGetConversationContext(...args),
  getPendingEmailConfirmation: (...args: unknown[]) => mockGetPendingEmailConfirmation(...args),
  getPendingSetupIntent: (...args: unknown[]) => mockGetPendingSetupIntent(...args),
  savePendingSetupIntent: (...args: unknown[]) => mockSavePendingSetupIntent(...args),
  clearPendingSetupIntent: vi.fn(),
}));

vi.mock('../../src/db/command_logs.js', () => ({
  insertCommandLog: (...args: unknown[]) => mockInsertCommandLog(...args),
  updateCommandLogParsed: (...args: unknown[]) => mockUpdateCommandLogParsed(...args),
  updateCommandLogAgentTrace: (...args: unknown[]) => mockUpdateCommandLogAgentTrace(...args),
  markCommandLogConfirmed: vi.fn(),
}));

vi.mock('../../src/core/voice-intent-pipeline.js', () => ({
  mapVoiceUtteranceToIntent: (...args: unknown[]) => mockMapVoiceUtteranceToIntent(...args),
}));

vi.mock('../../src/core/system-mode.js', () => ({
  resolveSystemMode: vi.fn().mockResolvedValue('FULL'),
}));

vi.mock('../../src/core/voice-rate-limit-bucket.js', () => ({
  classifyVoiceRateLimitBucket: vi.fn().mockReturnValue('mutation'),
}));

vi.mock('../../src/core/orchestrator.js', () => ({
  orchestrate: (...args: unknown[]) => mockOrchestrate(...args),
}));

vi.mock('../../src/core/conversation-context.js', () => ({
  applyConversationContext: (...args: unknown[]) => mockApplyConversationContext(...args),
}));

vi.mock('../../src/core/email-confirmation.js', () => ({
  handleEmailConfirmationGate: (...args: unknown[]) => mockHandleEmailConfirmationGate(...args),
}));

vi.mock('../../src/core/confirmation-actions.js', () => ({
  approvePendingConfirmation: (...args: unknown[]) => mockApprovePendingConfirmation(...args),
  rejectPendingConfirmation: (...args: unknown[]) => mockRejectPendingConfirmation(...args),
}));

vi.mock('../../src/services/auth_service.js', () => ({
  getOAuthClientForUser: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../src/core/rate-limiter.js', () => ({
  voiceHttpRateLimiter: { check: (...args: unknown[]) => mockVoiceRateCheck(...args) },
}));

vi.mock('../../src/middleware/session.js', () => ({
  requireSession: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { session: { userId: string; email: string } }).session = {
      userId: '77a22c75-4e6b-47ca-aee6-2f4ace21be53',
      email: 'host@test.com',
    };
    next();
  },
}));

vi.mock('../../src/middleware/requestId.js', () => ({
  getRequestId: () => 'req-voice-1',
}));

vi.mock('../../src/logger.js', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { voiceRouter } from '../../src/routes/voice.js';

const USER_ID = '77a22c75-4e6b-47ca-aee6-2f4ace21be53';

function app() {
  const x = express();
  x.use(express.json());
  x.use('/voice', voiceRouter);
  return x;
}

const basePolicy = {
  userId: USER_ID,
  schemaVersion: 1,
  timezone: 'America/Chicago',
  workingHoursStart: '09:00',
  workingHoursEnd: '18:00',
  defaultMeetingLengthMinutes: 30,
  setupFieldsAnswered: ['timezone', 'workingHours', 'meetingTimePreference', 'defaultMeetingLength'],
  shareAvailabilityOnInvite: true,
};

describe('voice route — validation and happy path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAgentEnabledFor.mockReturnValue(true);
    mockRunSchedulingAgent.mockResolvedValue({
      reply: 'Agent reply.',
      toolCalls: [],
      rounds: 1,
      trace: mockAgentTrace,
    });
    mockVoiceRateCheck.mockResolvedValue({ allowed: true });
    mockGetPolicy.mockResolvedValue(basePolicy);
    mockEnsureDefaultPolicy.mockResolvedValue(basePolicy);
    mockGetUserById.mockResolvedValue({ id: USER_ID, email: 'host@test.com' });
    mockGetConversationContext.mockResolvedValue(null);
    mockGetPendingEmailConfirmation.mockResolvedValue(null);
    mockGetPendingSetupIntent.mockResolvedValue(null);
    mockInsertCommandLog.mockResolvedValue('cmd-log-test-1');
    mockUpdateCommandLogParsed.mockResolvedValue(undefined);
    mockUpdateCommandLogAgentTrace.mockResolvedValue(undefined);
    mockApplyConversationContext.mockImplementation((_parsed) => _parsed);
    mockHandleEmailConfirmationGate.mockResolvedValue({
      proceed: true,
      parsed: { intent: 'QUERY_CALENDAR', params: {}, confidence: 0.9, mappingMethod: 'direct', rawUtterance: 'today' },
    });
    mockOrchestrate.mockResolvedValue({
      intent: 'QUERY_CALENDAR',
      success: true,
      messageToUser: 'You are free.',
      schemaVersion: 1,
    });
    mockMapVoiceUtteranceToIntent.mockResolvedValue({
      intent: {
        intent: 'QUERY_CALENDAR',
        confidence: 0.9,
        params: {},
        mappingMethod: 'direct',
        rawUtterance: 'what is on my calendar today',
      },
      meta: { haikuCalled: false, usedPendingTemplate: false, storedPendingTemplate: false, ambiguousFollowUpTime: false },
    });
  });

  it('returns 403 when body userId mismatches session', async () => {
    const res = await request(app())
      .post('/voice')
      .send({ utterance: 'today', userId: '99999999-9999-4999-8999-999999999999' });
    expect(res.status).toBe(403);
  });

  it('returns 400 for empty utterance', async () => {
    const res = await request(app()).post('/voice').send({ utterance: '' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing utterance', async () => {
    const res = await request(app()).post('/voice').send({});
    expect(res.status).toBe(400);
  });

  it('returns 429 when rate limited', async () => {
    mockVoiceRateCheck.mockResolvedValue({ allowed: false, retryAfterMs: 5000 });
    const res = await request(app()).post('/voice').send({ utterance: 'calendar today' });
    expect(res.status).toBe(429);
    expect(res.body.retryAfterMs).toBe(5000);
  });

  it('returns 404 when user exists but has no policy row', async () => {
    mockGetPolicy.mockResolvedValue(null);
    mockGetUserById.mockResolvedValue(null);
    const res = await request(app()).post('/voice').send({ utterance: 'calendar today' });
    expect(res.status).toBe(404);
  });

  it('returns warm redirect for off-topic without pending email', async () => {
    mockRunSchedulingAgent.mockResolvedValue({
      reply: 'I only help with calendar and scheduling.',
      toolCalls: [],
      rounds: 0,
      trace: mockAgentTrace,
    });
    const res = await request(app()).post('/voice').send({ utterance: 'tell me a joke' });
    expect(res.status).toBe(200);
    expect(res.body.messageToUser).toMatch(/calendar|scheduling/i);
    expect(mockOrchestrate).not.toHaveBeenCalled();
    expect(mockRunSchedulingAgent).toHaveBeenCalled();
  });

  it('returns 503 when agent disabled for user', async () => {
    mockAgentEnabledFor.mockReturnValue(false);
    const res = await request(app()).post('/voice').send({ utterance: 'what is on my calendar today' });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/scheduling agent/i);
    expect(mockRunSchedulingAgent).not.toHaveBeenCalled();
  });

  it('agent path handles calendar query and sets x-request-id', async () => {
    mockRunSchedulingAgent.mockResolvedValue({
      reply: 'You are free.',
      toolCalls: [],
      rounds: 1,
      trace: mockAgentTrace,
    });
    const res = await request(app()).post('/voice').send({ utterance: 'what is on my calendar today' });
    expect(res.status).toBe(200);
    expect(res.headers['x-request-id']).toBe('req-voice-1');
    expect(res.body.messageToUser).toBe('You are free.');
    expect(mockRunSchedulingAgent).toHaveBeenCalled();
    expect(mockOrchestrate).not.toHaveBeenCalled();
  });

  it('streams SSE tokens when stream:true on agent path', async () => {
    mockRunSchedulingAgent.mockResolvedValue({
      reply: 'You are free.',
      toolCalls: [],
      rounds: 1,
      trace: mockAgentTrace,
    });
    const res = await request(app())
      .post('/voice')
      .set('Accept', 'text/event-stream')
      .send({ utterance: 'what is on my calendar today', stream: true });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.text).toContain('event: status');
    expect(res.text).toContain('event: token');
    expect(res.text).toContain('event: done');
    expect(res.text).toContain('You are free.');
    expect(mockRunSchedulingAgent).toHaveBeenCalled();
    expect(mockOrchestrate).not.toHaveBeenCalled();
  });

  it('POST /voice/confirm/:token/approve proxies to confirmation handler', async () => {
    mockApprovePendingConfirmation.mockResolvedValue({ status: 200, body: { ok: true } });
    const res = await request(app()).post('/voice/confirm/tok-abc/approve');
    expect(res.status).toBe(200);
    expect(mockApprovePendingConfirmation).toHaveBeenCalledWith('tok-abc', USER_ID);
  });

  it('POST /voice/confirm/:token/reject proxies to confirmation handler', async () => {
    mockRejectPendingConfirmation.mockResolvedValue({ status: 200, body: { ok: true, rejected: true } });
    const res = await request(app()).post('/voice/confirm/tok-abc/reject');
    expect(res.status).toBe(200);
    expect(mockRejectPendingConfirmation).toHaveBeenCalledWith('tok-abc', USER_ID);
  });

  it('uses agent path when agentEnabledFor and skips classifier + orchestrator', async () => {
    mockAgentEnabledFor.mockReturnValue(true);
    const res = await request(app()).post('/voice').send({ utterance: 'invite jane@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.messageToUser).toBe('Agent reply.');
    expect(res.body.agentRounds).toBe(1);
    expect(mockRunSchedulingAgent).toHaveBeenCalledWith(
      'invite jane@example.com',
      expect.objectContaining({ userId: USER_ID }),
      [],
    );
    expect(mockMapVoiceUtteranceToIntent).not.toHaveBeenCalled();
    expect(mockOrchestrate).not.toHaveBeenCalled();
    expect(mockUpdateCommandLogAgentTrace).toHaveBeenCalledWith('cmd-log-test-1', mockAgentTrace);
  });

  it('streams agent SSE when agentEnabledFor and stream requested', async () => {
    mockAgentEnabledFor.mockReturnValue(true);
    const res = await request(app())
      .post('/voice')
      .set('Accept', 'text/event-stream')
      .send({ utterance: 'book a slot on my calendar', stream: true });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.text).toContain('Agent reply.');
    expect(res.text).toContain('event: done');
    expect(mockMapVoiceUtteranceToIntent).not.toHaveBeenCalled();
    expect(mockOrchestrate).not.toHaveBeenCalled();
    expect(mockRunSchedulingAgent).toHaveBeenCalledTimes(1);
  });
});
