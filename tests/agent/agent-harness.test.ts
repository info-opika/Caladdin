import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { UserPolicyProfile } from '../../src/core/adts.js';
import type { AgentContext } from '../../src/agent/types.js';
import { runSchedulingAgent } from '../../src/agent/scheduling-agent.js';
import { executeAgentTool } from '../../src/agent/tools/registry.js';
import { buildSchedulingSystemPrompt } from '../../src/agent/prompts/system.js';
import { mockLlmClient } from './mock-llm-client.js';

const mockGenerateSlots = vi.fn();
const mockCreateEventWithSync = vi.fn();
const mockLookupInvitee = vi.fn();
const mockCheckSpecificSlot = vi.fn();
const mockProtectBlock = vi.fn();
const mockHandleOfferSpecific = vi.fn();
const mockGetOAuth = vi.fn();
const mockGetSessionByToken = vi.fn();
const mockReplaceSessionSlots = vi.fn();

vi.mock('../../src/core/slot-scoring.js', () => ({
  generateSlots: (...args: unknown[]) => mockGenerateSlots(...args),
}));

vi.mock('../../src/services/calendar_api.js', () => ({
  createEventWithSync: (...args: unknown[]) => mockCreateEventWithSync(...args),
  listEventsFromGCalSafe: vi.fn().mockResolvedValue({ events: [], error: null }),
  listBusyFromGCal: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/services/invitee_lookup.js', () => ({
  lookupInviteeAvailability: (...args: unknown[]) => mockLookupInvitee(...args),
}));

vi.mock('../../src/services/mutual_slot_engine.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/mutual_slot_engine.js')>();
  return {
    ...actual,
    checkSpecificSlot: (...args: unknown[]) => mockCheckSpecificSlot(...args),
  };
});

vi.mock('../../src/core/intents/protect-block.js', () => ({
  protectBlock: (...args: unknown[]) => mockProtectBlock(...args),
}));

vi.mock('../../src/handlers/offer-specific.js', () => ({
  handleOfferSpecific: (...args: unknown[]) => mockHandleOfferSpecific(...args),
}));

vi.mock('../../src/handlers/modify-event.js', () => ({
  handleModifyEvent: vi.fn(),
}));

vi.mock('../../src/handlers/flush-range.js', () => ({
  handleFlushRange: vi.fn(),
}));

vi.mock('../../src/handlers/undo.js', () => ({
  handleUndo: vi.fn(),
}));

vi.mock('../../src/db/conversation-context.js', () => ({
  recordLastEvent: vi.fn().mockResolvedValue(undefined),
  getConversationContext: vi.fn().mockResolvedValue(null),
  getPendingFrame: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../src/db/users.js', () => ({
  upsertPolicy: vi.fn().mockResolvedValue(undefined),
  getUserByEmail: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../src/services/auth_service.js', () => ({
  getOAuth2AuthForUser: (...args: unknown[]) => mockGetOAuth(...args),
}));

vi.mock('../../src/db/scheduling_sessions.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/db/scheduling_sessions.js')>();
  return {
    ...actual,
    getSchedulingSessionByToken: (...args: unknown[]) => mockGetSessionByToken(...args),
    replaceSessionOfferedSlots: (...args: unknown[]) => mockReplaceSessionSlots(...args),
  };
});

vi.mock('../../src/agent/agent-prefilter.js', () => ({
  runAgentPrefilter: vi.fn().mockResolvedValue({ bypassed: false }),
}));

const BASE_POLICY: UserPolicyProfile = {
  schemaVersion: 1,
  protectedBlocks: [],
  shapeRules: {},
  gatekeepRules: [],
  timezone: 'America/Chicago',
  workingHoursStart: '09:00',
  workingHoursEnd: '18:00',
  chronotype: 'morning',
  defaultBufferMinutes: 15,
  clusteringPreference: 'balanced',
  maxFragmentsPerDay: 4,
  contactTiers: {},
  shareAvailabilityOnInvite: true,
  onboardingComplete: true,
  defaultMeetingLengthMinutes: 30,
  setupFieldsAnswered: ['timezone', 'workingHours', 'defaultMeetingLength'],
};

const AGENT_CTX: AgentContext = {
  userId: '11111111-1111-4111-8111-111111111111',
  requestId: 'req-1',
  timezone: 'America/Chicago',
  cal: {} as import('googleapis').calendar_v3.Calendar,
  policy: BASE_POLICY,
  conversationContext: null,
};

describe('agent harness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOAuth.mockResolvedValue({});
    mockGetSessionByToken.mockResolvedValue({
      id: 'sess-1',
      token: 'tok-loop',
      host_user_id: AGENT_CTX.userId,
      status: 'pending',
    });
    mockReplaceSessionSlots.mockResolvedValue(true);
    mockGenerateSlots.mockResolvedValue([
      { start: '2026-06-18T15:00:00.000-05:00', end: '2026-06-18T15:30:00.000-05:00', score: 1 },
    ]);
    mockLookupInvitee.mockResolvedValue({
      isCaladdinUser: false,
      hasCalendarConnected: false,
    });
    mockCheckSpecificSlot.mockReturnValue({
      available: true,
      scope: 'host_only',
      conflicts: [],
    });
    mockProtectBlock.mockResolvedValue({
      success: true,
      intent: 'PROTECT_BLOCK',
      requiresConfirmation: false,
      messageToUser: 'Blocked.',
      eventsAffected: [],
    });
    mockHandleOfferSpecific.mockResolvedValue({
      success: true,
      intent: 'OFFER_SPECIFIC',
      requiresConfirmation: false,
      messageToUser: 'Invite sent.',
      schedulingLink: 'http://localhost:3000/s/token',
      sessionToken: 'token',
      slotSource: 'host_only_pending_grant',
      slots: [{ start: '2026-06-18T15:00:00.000-05:00', end: '2026-06-18T15:30:00.000-05:00' }],
      schemaVersion: 1,
    });
  });

  it('system prompt includes honesty and PROTECT_BLOCK rules', () => {
    const prompt = buildSchedulingSystemPrompt('Today: Wednesday');
    expect(prompt).toContain('NEVER claim an event was created');
    expect(prompt).toContain('mutual availability');
    expect(prompt).toContain('PROTECT_BLOCK');
    expect(prompt).toContain('ONE short clarifying question');
    expect(prompt).toContain('valid JSON');
  });

  it('book a slot on my calendar — agent asks clarifying question without hallucinating booking', async () => {
    const llm = mockLlmClient([
      { text: 'What should I call the meeting, and when works for you?' },
    ]);

    const result = await runSchedulingAgent(
      'book a slot on my calendar',
      { userId: AGENT_CTX.userId, requestId: 'req-1', timezone: AGENT_CTX.timezone },
      [],
      {
        llm,
        prebuiltContext: { ...AGENT_CTX, systemContextBlock: 'Today: Wednesday' },
      },
    );

    expect(result.reply).toMatch(/what|when|meeting|call/i);
    expect(result.toolCalls).toHaveLength(0);
    expect(mockCreateEventWithSync).not.toHaveBeenCalled();
  });

  it('invite unknown user — honest host-only framing via send_invite', async () => {
    mockLookupInvitee.mockResolvedValue({
      isCaladdinUser: false,
      hasCalendarConnected: false,
    });

    const llm = mockLlmClient([
      {
        toolCalls: [{ id: 'tu1', name: 'lookup_user', input: { email: 'jane@example.com' } }],
      },
      {
        toolCalls: [
          { id: 'tu2', name: 'send_invite', input: { inviteeEmail: 'jane@example.com', durationMinutes: 30 } },
        ],
      },
      {
        text: 'I sent Jane a link. Once she shares her availability I can find a mutual time — for now here is a slot on your calendar.',
      },
    ]);

    const result = await runSchedulingAgent(
      'invite jane@example.com to a 30 minute meeting',
      { userId: AGENT_CTX.userId, requestId: 'req-1' },
      [],
      {
        llm,
        prebuiltContext: { ...AGENT_CTX, systemContextBlock: 'Today: Wednesday' },
      },
    );

    expect(result.toolCalls.some((t) => t.name === 'lookup_user')).toBe(true);
    const inviteCall = result.toolCalls.find((t) => t.name === 'send_invite');
    expect(inviteCall?.result.ok).toBe(true);
    expect(inviteCall?.result.honesty?.slotSource).toBe('host-only');
    expect(inviteCall?.result.honesty?.mutualChecked).toBe(true);
    expect(inviteCall?.result.data).toMatchObject({
      slotSource: 'host_only_pending_grant',
      grantLinkRequired: true,
    });
    expect(inviteCall?.result.data?.messageTemplate).toMatch(/host_only_pending_grant|host-only/i);
  });

  it('does Tuesday 3pm work — uses check_specific_slot', async () => {
    mockCheckSpecificSlot.mockReturnValue({
      available: false,
      scope: 'host_only',
      conflicts: [{ party: 'host', start: '2026-06-17T15:00:00-05:00', end: '2026-06-17T16:00:00-05:00' }],
      reason: 'Host has a conflict at that time',
    });

    const llm = mockLlmClient([
      {
        toolCalls: [
          {
            id: 'tu1',
            name: 'check_specific_slot',
            input: { start: '2026-06-17T15:00:00-05:00', durationMinutes: 30 },
          },
        ],
      },
      { text: 'Tuesday at 3pm is not free on your calendar — you have a conflict then.' },
    ]);

    const result = await runSchedulingAgent(
      'does Tuesday 3pm work',
      { userId: AGENT_CTX.userId, requestId: 'req-1' },
      [],
      {
        llm,
        prebuiltContext: { ...AGENT_CTX, systemContextBlock: 'Today: Tuesday' },
      },
    );

    const check = result.toolCalls.find((t) => t.name === 'check_specific_slot');
    expect(check?.result.ok).toBe(true);
    expect(check?.result.data).toMatchObject({ available: false });
    expect(result.reply.toLowerCase()).toMatch(/not free|conflict|busy/);
  });

  it('proposed time rejected — check_specific_slot then find_available_slots and update_session_slots', async () => {
    mockCheckSpecificSlot.mockReturnValue({
      available: false,
      scope: 'host_only',
      conflicts: [{ party: 'host', start: '2026-06-17T15:00:00-05:00', end: '2026-06-17T16:00:00-05:00' }],
      reason: 'Host has a conflict at that time',
    });
    mockGenerateSlots.mockResolvedValue([
      { start: '2026-06-18T10:00:00.000-05:00', end: '2026-06-18T10:30:00.000-05:00', score: 1 },
      { start: '2026-06-18T14:00:00.000-05:00', end: '2026-06-18T14:30:00.000-05:00', score: 0.9 },
    ]);

    const llm = mockLlmClient([
      {
        toolCalls: [
          {
            id: 'tu1',
            name: 'check_specific_slot',
            input: {
              start: '2026-06-17T15:00:00-05:00',
              durationMinutes: 30,
              inviteeEmail: 'jane@example.com',
            },
          },
        ],
      },
      {
        toolCalls: [
          { id: 'tu2', name: 'find_available_slots', input: { inviteeEmail: 'jane@example.com', durationMinutes: 30 } },
        ],
      },
      {
        toolCalls: [
          {
            id: 'tu3',
            name: 'update_session_slots',
            input: {
              sessionToken: 'tok-loop',
              slots: [
                { start: '2026-06-18T10:00:00.000-05:00', end: '2026-06-18T10:30:00.000-05:00' },
                { start: '2026-06-18T14:00:00.000-05:00', end: '2026-06-18T14:30:00.000-05:00' },
              ],
            },
          },
        ],
      },
      {
        text: 'Tuesday 3pm does not work. I updated your invite with Thursday 10am and 2pm alternatives.',
      },
    ]);

    const checkResult = await executeAgentTool(
      'check_specific_slot',
      {
        start: '2026-06-17T15:00:00-05:00',
        durationMinutes: 30,
        inviteeEmail: 'jane@example.com',
      },
      AGENT_CTX,
    );
    expect(checkResult.ok).toBe(true);
    expect(checkResult.data).toMatchObject({ available: false });

    const slotsResult = await executeAgentTool(
      'find_available_slots',
      { inviteeEmail: 'jane@example.com', durationMinutes: 30 },
      AGENT_CTX,
    );
    expect(slotsResult.ok).toBe(true);
    expect(slotsResult.data?.slots).toHaveLength(2);

    const result = await runSchedulingAgent(
      'Tuesday 3pm does not work for jane@example.com — find alternatives for invite tok-loop',
      { userId: AGENT_CTX.userId, requestId: 'req-loop' },
      [],
      {
        llm,
        prebuiltContext: { ...AGENT_CTX, systemContextBlock: 'Today: Tuesday' },
      },
    );

    expect(result.toolCalls.map((t) => t.name)).toEqual([
      'check_specific_slot',
      'find_available_slots',
      'update_session_slots',
    ]);
    const updateCall = result.toolCalls.find((t) => t.name === 'update_session_slots');
    expect(updateCall?.result.ok).toBe(true);
    expect(mockReplaceSessionSlots).toHaveBeenCalled();
    expect(result.reply.toLowerCase()).toMatch(/does not work|not work|alternatives|10am|2pm/);
  });

  it('PROTECT_BLOCK regression — duplicate block returns already protected without re-ask', async () => {
    const policyWithBlock: UserPolicyProfile = {
      ...BASE_POLICY,
      protectedBlocks: [
        {
          label: 'Deep Work',
          daysOfWeek: [2],
          startTime: '09:00',
          endTime: '11:00',
        },
      ],
    };

    const result = await executeAgentTool(
      'create_recurring_block',
      {
        label: 'Deep Work',
        startTime: '09:00',
        endTime: '11:00',
        daysOfWeek: [2],
        rangeEnd: '2026-12-31',
      },
      { ...AGENT_CTX, policy: policyWithBlock },
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ alreadyProtected: true });
    expect(mockProtectBlock).not.toHaveBeenCalled();
  });

  it('tool failure — create_event error passed through, agent does not claim success', async () => {
    const toolResult = await executeAgentTool(
      'create_event',
      {
        title: 'Sync',
        start: '2026-06-18T15:00:00.000-05:00',
        attendeeEmail: 'not-an-email',
      },
      AGENT_CTX,
    );

    expect(toolResult.ok).toBe(false);
    expect(toolResult.error).toMatch(/Invalid email|Invalid attendee email/i);

    mockCreateEventWithSync.mockRejectedValue(new Error('Invalid attendee email'));

    const llm = mockLlmClient([
      {
        toolCalls: [
          {
            id: 'tu1',
            name: 'create_event',
            input: {
              title: 'Sync',
              start: '2026-06-18T15:00:00.000-05:00',
              attendeeEmail: 'guest@example.com',
            },
          },
        ],
      },
      { text: 'That did not work — Invalid attendee email. I did not create the event.' },
    ]);

    const agentResult = await runSchedulingAgent(
      'book Sync Tuesday 3pm with guest@example.com',
      { userId: AGENT_CTX.userId, requestId: 'req-1' },
      [],
      {
        llm,
        prebuiltContext: { ...AGENT_CTX, systemContextBlock: 'Today: Tuesday' },
      },
    );

    const createCall = agentResult.toolCalls.find((t) => t.name === 'create_event');
    expect(createCall?.result.ok).toBe(false);
    expect(createCall?.result.error).toMatch(/Invalid attendee email/);
    expect(agentResult.reply.toLowerCase()).not.toMatch(/booked|created successfully/);
    expect(agentResult.reply.toLowerCase()).toMatch(/invalid|did not|error|work/);
  });
});
