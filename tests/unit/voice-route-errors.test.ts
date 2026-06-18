import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockGetPolicy = vi.fn();
const mockLoggerError = vi.fn();
const mockVoiceRateCheck = vi.fn();
const mockInsertCommandLog = vi.fn();
const mockRunSchedulingAgent = vi.fn();

vi.mock('../../src/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/config.js')>();
  return { ...actual, agentEnabledFor: vi.fn().mockReturnValue(true) };
});

vi.mock('../../src/agent/scheduling-agent.js', () => ({
  runSchedulingAgent: (...args: unknown[]) => mockRunSchedulingAgent(...args),
}));

vi.mock('../../src/db/users.js', () => ({
  getPolicy: (...args: unknown[]) => mockGetPolicy(...args),
  getUserById: vi.fn().mockResolvedValue({ id: 'u1', email: 'u@test.com' }),
}));

vi.mock('../../src/db/command_logs.js', () => ({
  insertCommandLog: (...args: unknown[]) => mockInsertCommandLog(...args),
  updateCommandLogParsed: vi.fn(),
  updateCommandLogAgentTrace: vi.fn(),
}));

vi.mock('../../src/core/system-mode.js', () => ({
  resolveSystemMode: vi.fn().mockResolvedValue('FULL'),
}));

vi.mock('../../src/core/rate-limiter.js', () => ({
  voiceHttpRateLimiter: { check: (...args: unknown[]) => mockVoiceRateCheck(...args) },
}));

vi.mock('../../src/core/voice-rate-limit-bucket.js', () => ({
  classifyVoiceRateLimitBucket: vi.fn().mockReturnValue('mutation'),
}));

vi.mock('../../src/middleware/session.js', () => ({
  requireSession: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { session: { userId: string; email: string } }).session = {
      userId: '77a22c75-4e6b-47ca-aee6-2f4ace21be53',
      email: 'test@test.com',
    };
    next();
  },
}));

vi.mock('../../src/middleware/requestId.js', () => ({
  getRequestId: () => 'req-voice-err-1',
}));

vi.mock('../../src/logger.js', () => ({
  logger: {
    error: (...args: unknown[]) => mockLoggerError(...args),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import { voiceRouter } from '../../src/routes/voice.js';

function app() {
  const x = express();
  x.use(express.json());
  x.use('/voice', voiceRouter);
  return x;
}

describe('voice route error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVoiceRateCheck.mockResolvedValue({ allowed: true });
    mockInsertCommandLog.mockResolvedValue('cmd-log-1');
    mockRunSchedulingAgent.mockResolvedValue({
      reply: 'ok',
      toolCalls: [],
      rounds: 1,
      trace: { model: 'test', rounds: 1, totalLatencyMs: 1, tools: [] },
    });
  });

  it('logs and returns 503 with x-request-id when pipeline throws', async () => {
    mockGetPolicy.mockRejectedValue(new Error('db unavailable'));
    const res = await request(app())
      .post('/voice')
      .send({ utterance: 'what is on my calendar' });
    expect(res.status).toBe(503);
    expect(res.headers['x-request-id']).toBe('req-voice-err-1');
    expect(res.body.error).toMatch(/temporarily unavailable/i);
    expect(mockLoggerError).toHaveBeenCalledWith(
      'Voice pipeline failed',
      expect.objectContaining({
        requestId: 'req-voice-err-1',
        userId: '77a22c75-4e6b-47ca-aee6-2f4ace21be53',
        error: expect.stringContaining('db unavailable'),
      }),
    );
  });
});
