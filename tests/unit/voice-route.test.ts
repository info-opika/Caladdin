import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockGetPolicy = vi.fn();
const mockGetUserById = vi.fn();
const mockGetConversationContext = vi.fn();
const mockGetPendingEmailConfirmation = vi.fn();
const mockMapVoiceUtteranceToIntent = vi.fn();
const mockOrchestrate = vi.fn();
const mockHandleEmailConfirmationGate = vi.fn();
const mockApplyConversationContext = vi.fn();
const mockApprovePendingConfirmation = vi.fn();
const mockRejectPendingConfirmation = vi.fn();
const mockVoiceRateCheck = vi.fn();

vi.mock('../../src/db/users.js', () => ({
  getPolicy: (...args: unknown[]) => mockGetPolicy(...args),
  getUserById: (...args: unknown[]) => mockGetUserById(...args),
}));

vi.mock('../../src/db/conversation-context.js', () => ({
  getConversationContext: (...args: unknown[]) => mockGetConversationContext(...args),
  getPendingEmailConfirmation: (...args: unknown[]) => mockGetPendingEmailConfirmation(...args),
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
  shareAvailabilityOnInvite: true,
};

describe('voice route — validation and happy path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVoiceRateCheck.mockResolvedValue({ allowed: true });
    mockGetPolicy.mockResolvedValue(basePolicy);
    mockGetUserById.mockResolvedValue({ id: USER_ID, email: 'host@test.com' });
    mockGetConversationContext.mockResolvedValue(null);
    mockGetPendingEmailConfirmation.mockResolvedValue(null);
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
    mockMapVoiceUtteranceToIntent.mockResolvedValue({
      intent: {
        intent: 'WARM_REDIRECT',
        confidence: 1,
        params: {},
        mappingMethod: 'direct',
        rawUtterance: 'tell me a joke',
      },
      meta: { haikuCalled: false, usedPendingTemplate: false, storedPendingTemplate: false, ambiguousFollowUpTime: false },
    });
    const res = await request(app()).post('/voice').send({ utterance: 'tell me a joke' });
    expect(res.status).toBe(200);
    expect(res.body.messageToUser).toMatch(/calendar/i);
    expect(mockOrchestrate).not.toHaveBeenCalled();
  });

  it('rescues warm redirect when pending email confirmation exists', async () => {
    mockGetPendingEmailConfirmation.mockResolvedValue({
      email: 'guest@test.com',
      originalIntent: 'OFFER_SPECIFIC',
      originalParams: {},
      originalUtterance: 'send booking link',
    });
    mockMapVoiceUtteranceToIntent.mockResolvedValue({
      intent: {
        intent: 'WARM_REDIRECT',
        confidence: 1,
        params: {},
        mappingMethod: 'direct',
        rawUtterance: 'yes',
      },
      meta: { haikuCalled: false, usedPendingTemplate: false, storedPendingTemplate: false, ambiguousFollowUpTime: false },
    });
    mockHandleEmailConfirmationGate.mockResolvedValue({
      proceed: true,
      parsed: {
        intent: 'OFFER_SPECIFIC',
        confidence: 0.7,
        params: { recipientEmail: 'guest@test.com' },
        mappingMethod: 'fuzzy',
        rawUtterance: 'yes',
      },
    });
    mockOrchestrate.mockResolvedValue({ intent: 'OFFER_SPECIFIC', success: true, schemaVersion: 1 });
    const res = await request(app()).post('/voice').send({ utterance: 'yes', source: 'text' });
    expect(res.status).toBe(200);
    expect(mockOrchestrate).toHaveBeenCalled();
  });

  it('orchestrates calendar query and sets x-request-id', async () => {
    const res = await request(app()).post('/voice').send({ utterance: 'what is on my calendar today' });
    expect(res.status).toBe(200);
    expect(res.headers['x-request-id']).toBe('req-voice-1');
    expect(mockOrchestrate).toHaveBeenCalledWith(
      expect.objectContaining({ intent: 'QUERY_CALENDAR' }),
      expect.objectContaining({ userId: USER_ID, requestId: 'req-voice-1' }),
    );
  });

  it('returns email gate result without orchestrating', async () => {
    mockHandleEmailConfirmationGate.mockResolvedValue({
      proceed: false,
      result: { intent: 'RESOLVE_MANUAL', success: true, messageToUser: 'Confirm email?', schemaVersion: 1 },
    });
    const res = await request(app()).post('/voice').send({ utterance: 'yes', source: 'text' });
    expect(res.status).toBe(200);
    expect(res.body.messageToUser).toMatch(/Confirm email/);
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
});
