import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/db/failures.js', () => ({
  insertFailureLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { parseIntent, isCalendarRelated } from '../../src/core/parser.js';

describe('parser — degraded keyword paths', () => {
  it('classifies block utterances as PROTECT_BLOCK', async () => {
    const result = await parseIntent('Block every Tuesday morning for deep work', 'user-1');
    expect(result.intent).toBe('PROTECT_BLOCK');
    expect(result.mappingMethod).toBe('fuzzy');
  });

  it('classifies query calendar utterances', async () => {
    const result = await parseIntent("What's on my calendar today", 'user-1');
    expect(result.intent).toBe('QUERY_CALENDAR');
  });

  it('classifies undo utterances', async () => {
    const result = await parseIntent('undo that', 'user-1');
    expect(result.intent).toBe('UNDO');
  });

  it('classifies invite platform utterances with email', async () => {
    const result = await parseIntent('invite alex@example.com to Caladdin', 'user-1');
    expect(result.intent).toBe('INVITE_PLATFORM');
    expect(result.params.inviteeEmail ?? result.params.email).toBe('alex@example.com');
  });

  it('classifies modify event rename', async () => {
    const result = await parseIntent('rename team sync to standup', 'user-1');
    expect(result.intent).toBe('MODIFY_EVENT');
  });

  it('classifies flush range cancel', async () => {
    const result = await parseIntent('cancel tomorrow', 'user-1');
    expect(result.intent).toBe('FLUSH_RANGE');
  });

  it('isCalendarRelated detects scheduling vocabulary', () => {
    expect(isCalendarRelated('book lunch Friday')).toBe(true);
    expect(isCalendarRelated('who is the president')).toBe(false);
  });
});

describe('parser — keyword-only path (LLM retired)', () => {
  const userId = '22222222-2222-4222-8222-222222222222';

  it('uses keyword/degraded parse for dinner booking utterances', async () => {
    const result = await parseIntent('Put dinner with Sarah at 7pm Friday', userId, 'req-1');
    expect(result.intent).toBe('CREATE_EVENT');
  });

  it('falls back to degraded parse for block utterances', async () => {
    const result = await parseIntent('Block Friday afternoon', userId, 'req-2');
    expect(result.intent).toBe('PROTECT_BLOCK');
  });

  it('keyword rescue for find-time utterances', async () => {
    const result = await parseIntent('find time for jane@example.com next week', userId);
    expect(result.intent).toBe('OFFER_SPECIFIC');
    expect(result.params.recipientEmail).toBe('jane@example.com');
  });

  it('keyword rescue for move/reschedule utterances', async () => {
    const result = await parseIntent('move my 3pm to 4pm', userId);
    expect(result.intent).toBe('MODIFY_EVENT');
  });
});
