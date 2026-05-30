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
});
