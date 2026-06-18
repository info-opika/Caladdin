import { describe, it, expect } from 'vitest';
import { shouldClearAgentChatSession } from '../../src/agent/scheduling-agent.js';
import type { SchedulingAgentResult } from '../../src/agent/types.js';

function resultWithTool(
  name: string,
  ok: boolean,
  data?: unknown,
): SchedulingAgentResult {
  return {
    reply: 'ok',
    toolCalls: [{ name, input: {}, result: { ok, data } }],
    rounds: 1,
    trace: { model: 'auto:smart', rounds: 1, totalLatencyMs: 0, tools: [] },
  };
}

describe('shouldClearAgentChatSession', () => {
  it('clears after a real block creation', () => {
    expect(
      shouldClearAgentChatSession(
        resultWithTool('create_recurring_block', true, { message: 'Block created.' }),
      ),
    ).toBe(true);
  });

  it('keeps session when block was already protected', () => {
    expect(
      shouldClearAgentChatSession(
        resultWithTool('create_recurring_block', true, {
          alreadyProtected: true,
          message: 'That block is already protected.',
        }),
      ),
    ).toBe(false);
  });

  it('keeps session when tools failed', () => {
    expect(shouldClearAgentChatSession(resultWithTool('create_recurring_block', false))).toBe(
      false,
    );
  });
});
