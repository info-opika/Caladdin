import { describe, it, expect } from 'vitest';
import { isOffTopic, warmRedirectResult, offTopicResult } from '../../src/core/parser.js';

describe('parser pre-LLM', () => {
  it('detects off-topic', () => {
    expect(isOffTopic('The weather is great today')).toBe(true);
    expect(isOffTopic('What is on my calendar today')).toBe(false);
    expect(isOffTopic('Who is the president of the USA')).toBe(true);
    expect(isOffTopic('Tell me a joke')).toBe(true);
  });

  it('off-topic result flagged and uses calendar-only message path', () => {
    const r = offTopicResult('who is the president');
    expect(r._warmRedirect).toBe(true);
    expect(r._offTopic).toBe(true);
  });

  it('warm redirect delegates to off-topic', () => {
    const r = warmRedirectResult('nice day');
    expect(r._offTopic).toBe(true);
  });

  it('allows calendar invite utterances with email', () => {
    expect(isOffTopic('invite kanthatbww@gmail.com')).toBe(false);
    expect(isOffTopic('add kanthatbww@gmail.com to the meeting')).toBe(false);
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
