import { describe, it, expect } from 'vitest';
import { isOffTopic, warmRedirectResult } from '../../src/core/parser.js';
import { WARM_REDIRECT_MESSAGE } from '../../src/core/adts.js';

describe('parser pre-LLM', () => {
  it('detects off-topic', () => {
    expect(isOffTopic('The weather is great today')).toBe(true);
    expect(isOffTopic('What is on my calendar today')).toBe(false);
  });

  it('warm redirect result flagged', () => {
    const r = warmRedirectResult('nice day');
    expect(r._warmRedirect).toBe(true);
  });
});

describe('golden utterance mapping (degraded)', () => {
  const cases: Array<{ utterance: string; notOffTopic: boolean }> = [
    { utterance: 'Block every Tuesday morning for deep work', notOffTopic: true },
    { utterance: 'Find 2 slots for Alex next week', notOffTopic: true },
    { utterance: 'Put dinner with Sarah at 7pm Friday', notOffTopic: true },
    { utterance: 'Cancel tomorrow', notOffTopic: true },
    { utterance: 'Move my 3pm to 4pm', notOffTopic: true },
    { utterance: 'No meetings before 9am', notOffTopic: true },
    { utterance: 'What\'s on my calendar today', notOffTopic: true },
    { utterance: 'Undo that', notOffTopic: true },
    { utterance: 'The weather is great', notOffTopic: false },
  ];

  for (const { utterance, notOffTopic } of cases) {
    it(`off-topic check: "${utterance.slice(0, 30)}..."`, () => {
      expect(isOffTopic(utterance)).toBe(!notOffTopic);
    });
  }
});
