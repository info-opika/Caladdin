import { describe, it, expect } from 'vitest';
import {
  assembleAgentContext,
  deriveSessionKnowledge,
} from '../../src/agent/agent-context-assembler.js';
import { mergeSchedulingTask } from '../../src/agent/agent-scheduling-state.js';
import type { AgentContext, AgentMessage } from '../../src/agent/types.js';
import type { UserPolicyProfile } from '../../src/core/adts.js';

function mockPolicy(overrides: Partial<UserPolicyProfile> = {}): UserPolicyProfile {
  return {
    userId: 'user-1',
    timezone: 'America/Chicago',
    workingHoursStart: '09:00',
    workingHoursEnd: '18:00',
    chronotype: 'morning',
    defaultMeetingLengthMinutes: 30,
    defaultBufferMinutes: 15,
    clusteringPreference: 'balanced',
    protectedBlocks: [],
    meetingTimePreference: 'morning',
    ...overrides,
  } as UserPolicyProfile;
}

function mockAgentContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    userId: 'user-1',
    requestId: 'req-1',
    timezone: 'America/Chicago',
    cal: null,
    policy: mockPolicy(),
    conversationContext: null,
    ...overrides,
  };
}

describe('assembleAgentContext', () => {
  it('builds fresh-utterance context with timezone and policy', () => {
    const result = assembleAgentContext({
      userUtterance: 'What do I have tomorrow?',
      chatHistory: [],
      agentContext: mockAgentContext(),
      baseContextBlock: 'Today: Thursday\nCalendar connected: yes',
    });

    expect(result.enrichedContextBlock).toContain('Today: Thursday');
    expect(result.enrichedContextBlock).toContain('Timezone: America/Chicago');
    expect(result.enrichedContextBlock).toContain('Working hours: 09:00–18:00');
    expect(result.enrichedContextBlock).toContain('Chronotype: morning');
    expect(result.enrichedContextBlock).toContain('Fresh request');
    expect(result.enrichedContextBlock).toContain('get_calendar_summary');
    expect(result.userMessagePrefix).toBe('');
  });

  it('summarizes mid-clarification session without re-asking established facts', () => {
    const history: AgentMessage[] = [
      { role: 'user', content: 'Block 30 minutes for focus time' },
      {
        role: 'assistant',
        content: 'What time each day should I block, and what should I call it?',
      },
      { role: 'user', content: 'Every day from 7 AM to 7:30 AM' },
    ];

    const knowledge = deriveSessionKnowledge(history, 'Deep Work');
    expect(knowledge.known.some((k) => k.includes('time range'))).toBe(true);
    expect(knowledge.known.some((k) => k.includes('Deep Work'))).toBe(true);
    expect(knowledge.readyToAct).toBe(true);

    const result = assembleAgentContext({
      userUtterance: 'Deep Work',
      chatHistory: history,
      agentContext: mockAgentContext(),
      baseContextBlock: 'Calendar connected: yes',
    });

    expect(result.enrichedContextBlock).toContain('Already established');
    expect(result.enrichedContextBlock).toContain('do NOT re-ask');
    expect(result.enrichedContextBlock).toContain('enough information');
    expect(result.userMessagePrefix).toContain('enough information');
    expect(result.userMessagePrefix).toContain('Deep Work');
  });

  it('marks invite intent complete when email is present and includes pending frame', () => {
    const schedulingTask = mergeSchedulingTask(
      null,
      ['Invite alex@example.com for a sync Tuesday at 2pm'],
      'America/Chicago',
    );
    const result = assembleAgentContext({
      userUtterance: 'Invite alex@example.com for a sync Tuesday at 2pm',
      chatHistory: [],
      agentContext: mockAgentContext({
        conversationContext: {
          lastIntent: 'SEND_INVITE',
          lastUtterance: 'invite alex',
          updatedAt: new Date().toISOString(),
        },
      }),
      baseContextBlock: 'Calendar connected: yes',
      pendingIntent: {
        pendingIntent: 'SEND_INVITE',
        knownFields: { inviteeEmail: 'alex@example.com' },
        missingFields: ['proposedSlots'],
        originalUtterance: 'invite alex@example.com',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      },
      schedulingTask,
    });

    expect(result.enrichedContextBlock).toContain('Pending intent: SEND_INVITE');
    expect(result.enrichedContextBlock).not.toContain('aniket@opika.co');
    expect(result.enrichedContextBlock).toContain('alex@example.com');
    expect(result.enrichedContextBlock).toContain('Structured task state');
    expect(result.enrichedContextBlock).toContain('do NOT re-ask');
    expect(result.enrichedContextBlock).toContain('lookup_user');
    expect(result.enrichedContextBlock).toContain('Last intent: SEND_INVITE');
  });

  it('injects persisted invitee on follow-up day turn', () => {
    const history: AgentMessage[] = [
      { role: 'user', content: 'Invite aniket@opika.co to a meeting' },
      { role: 'assistant', content: 'What day and time?' },
    ];
    const schedulingTask = mergeSchedulingTask(
      { taskType: 'invite', inviteeEmail: 'aniket@opika.co', updatedAt: new Date().toISOString() },
      ['Invite aniket@opika.co to a meeting', 'monday at 10 pm ist'],
      'America/Chicago',
    );

    const result = assembleAgentContext({
      userUtterance: 'monday at 10 pm ist',
      chatHistory: history,
      agentContext: mockAgentContext(),
      baseContextBlock: 'Calendar connected: yes',
      schedulingTask,
    });

    expect(result.enrichedContextBlock).toContain('aniket@opika.co');
    expect(result.enrichedContextBlock).toContain('monday');
    expect(result.enrichedContextBlock).toContain('10 pm ist');
    expect(result.userMessagePrefix).toContain('aniket@opika.co');
  });
});
