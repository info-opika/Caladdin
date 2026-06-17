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
const mockInsertCommandLog = vi.fn();
const mockUpdateCommandLogParsed = vi.fn();
const mockVoiceRateCheck = vi.fn();

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
  approvePendingConfirmation: vi.fn(),
  rejectPendingConfirmation: vi.fn(),
}));

vi.mock('../../src/services/auth_service.js', () => ({
  getOAuthClientForUser: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../src/core/rate-limiter.js', () => ({
  voiceHttpRateLimiter: { check: (...args: unknown[]) => mockVoiceRateCheck(...args) },
}));

vi.mock('../../src/db/command_logs.js', () => ({
  insertCommandLog: (...args: unknown[]) => mockInsertCommandLog(...args),
  updateCommandLogParsed: (...args: unknown[]) => mockUpdateCommandLogParsed(...args),
  markCommandLogConfirmed: vi.fn(),
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
  getRequestId: () => 'req-cmdlog-1',
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
  setupFieldsAnswered: ['timezone', 'workingHours', 'meetingTimePreference', 'defaultMeetingLength'],
};

describe('voice route — command log instrumentation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVoiceRateCheck.mockResolvedValue({ allowed: true });
    mockGetConversationContext.mockResolvedValue(null);
    mockGetPendingEmailConfirmation.mockResolvedValue(null);
    mockGetPendingSetupIntent.mockResolvedValue(null);
    mockGetPolicy.mockResolvedValue(basePolicy);
    mockEnsureDefaultPolicy.mockResolvedValue(basePolicy);
    mockGetUserById.mockResolvedValue({ id: USER_ID, email: 'host@test.com' });
    mockApplyConversationContext.mockImplementation((p) => p);
    mockHandleEmailConfirmationGate.mockImplementation(async (p) => ({ proceed: true, parsed: p }));
    mockInsertCommandLog.mockResolvedValue('cmd-log-uuid-1');
    mockUpdateCommandLogParsed.mockResolvedValue(undefined);
  });

  it('inserts command log and updates parsed intent on happy path', async () => {
    const parsed = {
      intent: 'QUERY_CALENDAR',
      confidence: 1,
      rawUtterance: 'what is on my calendar',
      mappingMethod: 'direct',
      params: {},
    };
    mockMapVoiceUtteranceToIntent.mockResolvedValue({ intent: parsed });
    mockOrchestrate.mockResolvedValue({
      intent: 'QUERY_CALENDAR',
      success: true,
      requiresConfirmation: false,
      messageToUser: 'Nothing scheduled.',
      schemaVersion: 1,
    });

    const res = await request(app()).post('/voice').send({ utterance: 'what is on my calendar', source: 'text' });

    expect(res.status).toBe(200);
    expect(mockInsertCommandLog).toHaveBeenCalledWith({
      userId: USER_ID,
      rawInput: 'what is on my calendar',
      inputMode: 'text',
    });
    expect(mockUpdateCommandLogParsed).toHaveBeenCalledWith('cmd-log-uuid-1', {
      intent: 'QUERY_CALENDAR',
      params: {},
    });
    expect(mockOrchestrate).toHaveBeenCalledWith(
      expect.objectContaining({ intent: 'QUERY_CALENDAR' }),
      expect.objectContaining({ commandLogId: 'cmd-log-uuid-1' }),
    );
  });

  it('returns needs_setup when policy lacks answered fields', async () => {
    mockGetPolicy.mockResolvedValue({ ...basePolicy, setupFieldsAnswered: [] });
    mockEnsureDefaultPolicy.mockResolvedValue({ ...basePolicy, setupFieldsAnswered: [] });
    const parsed = {
      intent: 'OFFER_SPECIFIC',
      confidence: 0.95,
      rawUtterance: 'invite guest@example.com',
      mappingMethod: 'direct',
      params: { recipientEmail: 'guest@example.com' },
    };
    mockMapVoiceUtteranceToIntent.mockResolvedValue({ intent: parsed });

    const res = await request(app()).post('/voice').send({ utterance: parsed.rawUtterance });

    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('needs_setup');
    expect(res.body.setupField).toBe('timezone');
    expect(mockSavePendingSetupIntent).toHaveBeenCalled();
    expect(mockOrchestrate).not.toHaveBeenCalled();
  });
});
