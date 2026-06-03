import { describe, it, expect } from 'vitest';
import { isOffTopic, warmRedirectResult, offTopicResult, parseIntent, parseSchedulingLinkIntent } from '../../src/core/parser.js';

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

  it('allows email confirmation replies (yes/no)', () => {
    expect(isOffTopic('Yes')).toBe(false);
    expect(isOffTopic('yeah')).toBe(false);
    expect(isOffTopic('no that is wrong')).toBe(false);
    expect(isOffTopic('let me spell it')).toBe(false);
  });

  it('allows scheduling link requests with email', () => {
    expect(isOffTopic('Send a booking link to aniketde9@gmail.com')).toBe(false);
    expect(isOffTopic('Email a scheduling link to alex@example.com')).toBe(false);
  });
});

describe('golden utterance mapping (degraded)', () => {
  const cases: Array<{ utterance: string; notOffTopic: boolean }> = [
    { utterance: 'Block every Tuesday morning for deep work', notOffTopic: true },
    { utterance: 'Find 2 slots for Alex next week', notOffTopic: true },
    { utterance: 'Send a booking link to test@example.com', notOffTopic: true },
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

describe('scheduling link parsing', () => {
  it('keyword-parses booking link requests with recipient email', () => {
    const utterance = 'Send a booking link to aniketde9@gmail.com';
    const parsed = parseSchedulingLinkIntent(utterance);
    expect(parsed?.intent).toBe('OFFER_SPECIFIC');
    expect(parsed?.params.recipientEmail).toBe('aniketde9@gmail.com');
    expect(parsed?._warmRedirect).toBeFalsy();
  });

  it('parseIntent classifies booking link without warm redirect', async () => {
    const result = await parseIntent(
      'Send a booking link to aniketde9@gmail.com',
      'user-1111-1111-4111-8111-111111111111',
    );
    expect(result.intent).toBe('OFFER_SPECIFIC');
    expect(result.params.recipientEmail).toBe('aniketde9@gmail.com');
    expect(result._warmRedirect).toBeFalsy();
  });
});
