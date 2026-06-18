import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockGetPolicy = vi.fn();
const mockGetUserById = vi.fn();
const mockInsertCommandLog = vi.fn();
const mockUpdateCommandLogParsed = vi.fn();
const mockUpdateCommandLogAgentTrace = vi.fn();
const mockVoiceRateCheck = vi.fn();
const mockRunSchedulingAgent = vi.fn();
const mockAgentEnabledFor = vi.fn();

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
}));

vi.mock('../../src/core/system-mode.js', () => ({
  resolveSystemMode: vi.fn().mockResolvedValue('FULL'),
}));

vi.mock('../../src/core/voice-rate-limit-bucket.js', () => ({
  classifyVoiceRateLimitBucket: vi.fn().mockReturnValue('mutation'),
}));

vi.mock('../../src/core/confirmation-actions.js', () => ({
  approvePendingConfirmation: vi.fn(),
  rejectPendingConfirmation: vi.fn(),
}));

vi.mock('../../src/core/rate-limiter.js', () => ({
  voiceHttpRateLimiter: { check: (...args: unknown[]) => mockVoiceRateCheck(...args) },
}));

vi.mock('../../src/db/command_logs.js', () => ({
  insertCommandLog: (...args: unknown[]) => mockInsertCommandLog(...args),
  updateCommandLogParsed: (...args: unknown[]) => mockUpdateCommandLogParsed(...args),
  updateCommandLogAgentTrace: (...args: unknown[]) => mockUpdateCommandLogAgentTrace(...args),
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

const mockAgentTrace = {
  model: 'auto:caladdin-agent',
  rounds: 1,
  totalLatencyMs: 12,
  tools: [] as Array<{ name: string; latencyMs: number; ok: boolean }>,
};

describe('voice route — command log instrumentation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAgentEnabledFor.mockReturnValue(true);
    mockVoiceRateCheck.mockResolvedValue({ allowed: true });
    mockGetPolicy.mockResolvedValue(basePolicy);
    mockGetUserById.mockResolvedValue({ id: USER_ID, email: 'host@test.com' });
    mockInsertCommandLog.mockResolvedValue('cmd-log-uuid-1');
    mockUpdateCommandLogParsed.mockResolvedValue(undefined);
    mockUpdateCommandLogAgentTrace.mockResolvedValue(undefined);
    mockRunSchedulingAgent.mockResolvedValue({
      reply: 'Nothing scheduled.',
      toolCalls: [],
      rounds: 1,
      trace: mockAgentTrace,
    });
  });

  it('inserts command log and updates agent trace on happy path', async () => {
    const res = await request(app()).post('/voice').send({ utterance: 'what is on my calendar', source: 'text' });

    expect(res.status).toBe(200);
    expect(mockInsertCommandLog).toHaveBeenCalledWith({
      userId: USER_ID,
      rawInput: 'what is on my calendar',
      inputMode: 'text',
    });
    expect(mockUpdateCommandLogParsed).toHaveBeenCalledWith('cmd-log-uuid-1', {
      intent: 'RESOLVE_MANUAL',
      params: { agentPath: true, agentRounds: 1 },
    });
    expect(mockUpdateCommandLogAgentTrace).toHaveBeenCalledWith('cmd-log-uuid-1', mockAgentTrace);
    expect(mockRunSchedulingAgent).toHaveBeenCalled();
  });
});
