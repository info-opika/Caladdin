import { describe, it, expect } from 'vitest';
import { applyConversationContext } from '../../src/core/conversation-context.js';

describe('applyConversationContext', () => {
  it('links invite follow-up to last event in session', () => {
    const parsed = applyConversationContext(
      {
        intent: 'RESOLVE_MANUAL',
        confidence: 0.4,
        params: {},
        mappingMethod: 'resolve_manual',
        rawUtterance: 'invite kanthatbww@gmail.com',
      },
      {
        updatedAt: new Date().toISOString(),
        lastIntent: 'CREATE_EVENT',
        lastUtterance: 'Create team sync tomorrow at 3pm',
        lastEvent: {
          title: 'Team sync',
          gcalEventId: 'abc123',
          start: '2026-05-30T15:00:00.000Z',
          end: '2026-05-30T16:00:00.000Z',
        },
      },
    );

    expect(parsed.intent).toBe('MODIFY_EVENT');
    expect(parsed.params.eventTitle).toBe('Team sync');
    expect(parsed.params.addInvitees).toEqual(['kanthatbww@gmail.com']);
    expect(parsed.params._useSessionEvent).toBe(true);
  });

  it('promotes create-event utterances with enriched params', () => {
    const parsed = applyConversationContext(
      {
        intent: 'RESOLVE_MANUAL',
        confidence: 0.4,
        params: {},
        mappingMethod: 'resolve_manual',
        rawUtterance: 'create a new event for lunch tomorrow at noon',
      },
      null,
    );
    expect(parsed.intent).toBe('CREATE_EVENT');
    expect(parsed.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it('resolves referential modify against session event', () => {
    const parsed = applyConversationContext(
      {
        intent: 'MODIFY_EVENT',
        confidence: 0.8,
        params: { newStart: '2026-06-10T12:00:00.000Z' },
        mappingMethod: 'fuzzy',
        rawUtterance: 'move it to noon',
      },
      {
        updatedAt: new Date().toISOString(),
        lastIntent: 'CREATE_EVENT',
        lastUtterance: 'lunch tomorrow',
        lastEvent: { title: 'Lunch', gcalEventId: 'ev-2' },
      },
    );
    expect(parsed.params.eventTitle).toBe('Lunch');
    expect(parsed.params._useSessionEvent).toBe(true);
  });

  it('returns parsed unchanged without session context', () => {
    const input = {
      intent: 'QUERY_CALENDAR' as const,
      confidence: 0.9,
      params: {},
      mappingMethod: 'direct' as const,
      rawUtterance: 'calendar today',
    };
    expect(applyConversationContext(input, null)).toEqual(input);
  });
});
