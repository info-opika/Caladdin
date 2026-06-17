import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRunSchedulingAgent = vi.fn();
const mockAgentEnabledFor = vi.fn();

vi.mock('../../src/agent/scheduling-agent.js', () => ({
  runSchedulingAgent: (...args: unknown[]) => mockRunSchedulingAgent(...args),
}));

vi.mock('../../src/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/config.js')>();
  return {
    ...actual,
    agentEnabledFor: (...args: unknown[]) => mockAgentEnabledFor(...args),
    config: {
      ...actual.config,
      nodeEnv: 'test',
      baseUrl: 'http://localhost:3000',
    },
  };
});

describe('voice agent stream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAgentEnabledFor.mockReturnValue(true);
    mockRunSchedulingAgent.mockResolvedValue({
      reply: 'Hello from agent.',
      toolCalls: [{ name: 'lookup_user', input: {}, result: { ok: true } }],
      rounds: 1,
      trace: {
        model: 'claude-sonnet-4-20250514',
        rounds: 1,
        totalLatencyMs: 5,
        tools: [{ name: 'lookup_user', latencyMs: 3, ok: true }],
      },
    });
  });

  it('runAgentStream yields tokens and result when agent enabled for user', async () => {
    const { runAgentStream } = await import('../../src/core/voice-agent-stream.js');
    const events = [];
    for await (const event of runAgentStream({
      userId: 'user-1',
      utterance: 'invite jane@example.com',
      requestId: 'req-1',
      timezone: 'America/Chicago',
    })) {
      events.push(event);
    }

    expect(mockRunSchedulingAgent).toHaveBeenCalled();
    expect(events.some((e) => e.type === 'token')).toBe(true);
    const result = events.find((e) => e.type === 'result');
    expect(result?.payload).toMatchObject({
      success: true,
      messageToUser: 'Hello from agent.',
      agentRounds: 1,
    });
  });

  it('runAgentStream reuses precomputed body without calling runSchedulingAgent again', async () => {
    const { runAgentStream } = await import('../../src/core/voice-agent-stream.js');
    const events = [];
    for await (const event of runAgentStream(
      {
        userId: 'user-1',
        utterance: 'ignored',
        requestId: 'req-1',
        timezone: 'America/Chicago',
      },
      {
        intent: 'RESOLVE_MANUAL',
        success: true,
        messageToUser: 'Cached agent reply.',
        agentRounds: 2,
        schemaVersion: 1,
      },
    )) {
      events.push(event);
    }

    expect(mockRunSchedulingAgent).not.toHaveBeenCalled();
    expect(events.some((e) => e.type === 'token')).toBe(true);
    const result = events.find((e) => e.type === 'result');
    expect(result?.payload).toMatchObject({ messageToUser: 'Cached agent reply.', agentRounds: 2 });
  });

  it('runAgentStream yields nothing when agent disabled for user', async () => {
    mockAgentEnabledFor.mockReturnValue(false);
    const { runAgentStream } = await import('../../src/core/voice-agent-stream.js');
    const events = [];
    for await (const event of runAgentStream({
      userId: 'user-1',
      utterance: 'hello',
      requestId: 'req-1',
      timezone: 'America/Chicago',
    })) {
      events.push(event);
    }

    expect(events).toHaveLength(0);
    expect(mockRunSchedulingAgent).not.toHaveBeenCalled();
  });
});
