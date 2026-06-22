import { describe, it, expect } from 'vitest';
import { deriveSessionKnowledge } from '../../src/agent/agent-context-assembler.js';
import { validateHonestReply } from '../../src/agent/honesty-validator.js';
import { selectToolsForUtterance } from '../../src/agent/tool-pruning.js';
import { checkWrongTool } from '../../src/agent/tool-call-guard.js';
import type { AgentMessage } from '../../src/agent/types.js';

describe('create event booking intelligence', () => {
  const timezoneTesterTurn =
    "Create an event named 'Timezone Tester' at 6 PM Phoenix Arizona Time in my calendar";

  it('marks create-an-event utterances ready to act on turn one', () => {
    const knowledge = deriveSessionKnowledge([], timezoneTesterTurn);
    expect(knowledge.intentCategory).toBe('book meeting');
    expect(knowledge.readyToAct).toBe(true);
    expect(knowledge.known.some((k) => k.includes('Timezone Tester'))).toBe(true);
  });

  it('selects book tools for create-an-event phrasing', () => {
    const tools = selectToolsForUtterance(timezoneTesterTurn, []);
    expect(tools).toContain('create_event');
  });

  it('marks yes-please after confirmation as ready to act', () => {
    const history: AgentMessage[] = [
      { role: 'user', content: timezoneTesterTurn },
      {
        role: 'assistant',
        content:
          'Just to confirm, you would like "Timezone Tester" at 6 PM Phoenix time on June 22 2026?',
      },
    ];
    const knowledge = deriveSessionKnowledge(history, 'Yes please');
    expect(knowledge.readyToAct).toBe(true);
    expect(knowledge.intentCategory).toBe('book meeting');
  });

  it('selects book tools on affirmation after booking conversation', () => {
    const history: AgentMessage[] = [
      { role: 'user', content: timezoneTesterTurn },
      {
        role: 'assistant',
        content: 'Would you like me to schedule "Timezone Tester" for 6 PM Phoenix time?',
      },
    ];
    const tools = selectToolsForUtterance('Yes please', history);
    expect(tools).toContain('create_event');
  });

  it('redirects read-only tools when user confirms a booking', () => {
    const history: AgentMessage[] = [
      { role: 'user', content: timezoneTesterTurn },
      { role: 'assistant', content: 'Shall I create that event for you?' },
    ];
    const check = checkWrongTool('Yes please', 'get_calendar_summary', history);
    expect(check.wrong).toBe(true);
    expect(check.expectedTools).toContain('create_event');
  });

  it('rejects false claims about missing create tools', () => {
    const reply =
      "I don't have a working event creation tool — I can only read calendar summaries.";
    const sanitized = validateHonestReply(reply, [], {
      readyToAct: true,
      activeTools: ['create_event', 'get_calendar_summary'],
    });
    expect(sanitized).not.toContain("don't have");
    expect(sanitized).toContain('create_event');
  });
});
