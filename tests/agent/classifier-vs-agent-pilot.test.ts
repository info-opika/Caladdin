/**
 * Side-by-side comparison harness (tests only — not production dual-run).
 * Documents behavioral differences between legacy Haiku classifier and scheduling agent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Message } from '@anthropic-ai/sdk/resources/messages/messages.mjs';
import type { ParsedIntent, UserPolicyProfile } from '../../src/core/adts.js';
import type { AgentContext } from '../../src/agent/types.js';
import { runSchedulingAgent } from '../../src/agent/scheduling-agent.js';
import { executeAgentTool } from '../../src/agent/tools/registry.js';

const mockGenerateSlots = vi.fn();
const mockCreateEventWithSync = vi.fn();
const mockLookupInvitee = vi.fn();
const mockProtectBlock = vi.fn();
const mockHandleOfferSpecific = vi.fn();
const mockGetOAuth = vi.fn();

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
  return { ...actual, checkSpecificSlot: vi.fn().mockReturnValue({ available: true, scope: 'host_only', conflicts: [] }) };
});

vi.mock('../../src/core/intents/protect-block.js', () => ({
  protectBlock: (...args: unknown[]) => mockProtectBlock(...args),
}));

vi.mock('../../src/handlers/offer-specific.js', () => ({
  handleOfferSpecific: (...args: unknown[]) => mockHandleOfferSpecific(...args),
}));

vi.mock('../../src/handlers/modify-event.js', () => ({ handleModifyEvent: vi.fn() }));
vi.mock('../../src/handlers/flush-range.js', () => ({ handleFlushRange: vi.fn() }));
vi.mock('../../src/handlers/undo.js', () => ({ handleUndo: vi.fn() }));

vi.mock('../../src/db/conversation-context.js', () => ({
  recordLastEvent: vi.fn().mockResolvedValue(undefined),
  getConversationContext: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../src/db/users.js', () => ({
  upsertPolicy: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/services/auth_service.js', () => ({
  getOAuth2AuthForUser: (...args: unknown[]) => mockGetOAuth(...args),
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
  requestId: 'req-pilot-compare',
  timezone: 'America/Chicago',
  cal: {} as import('googleapis').calendar_v3.Calendar,
  policy: BASE_POLICY,
  conversationContext: null,
};

const TZ = 'America/Chicago';
const UID = AGENT_CTX.userId;

function assistantMessage(text: string, toolUses?: Array<{ id: string; name: string; input: unknown }>): Message {
  const content: Message['content'] = [];
  if (text) content.push({ type: 'text', text });
  for (const t of toolUses ?? []) {
    content.push({ type: 'tool_use', id: t.id, name: t.name, input: t.input });
  }
  return {
    id: 'msg',
    type: 'message',
    role: 'assistant',
    model: 'test',
    stop_reason: toolUses?.length ? 'tool_use' : 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
    content,
  };
}

function mockAnthropic(sequence: Message[]) {
  let call = 0;
  return {
    create: vi.fn(async () => {
      const msg = sequence[call] ?? sequence[sequence.length - 1]!;
      call += 1;
      return msg;
    }),
  };
}

/** Stub classifier outputs — representative legacy Haiku mappings for comparison. */
function classifierIntentFor(utterance: string): ParsedIntent {
  const t = utterance.trim().toLowerCase();
  if (t === 'book a slot on my calendar') {
    return {
      intent: 'RESOLVE_MANUAL',
      confidence: 0.55,
      params: { reason: 'missing_fields' },
      mappingMethod: 'resolve_manual',
      rawUtterance: utterance,
    };
  }
  if (t.includes('invite jane@example.com')) {
    return {
      intent: 'OFFER_SPECIFIC',
      confidence: 0.85,
      params: { inviteeEmail: 'jane@example.com', durationMinutes: 30 },
      mappingMethod: 'fuzzy',
      rawUtterance: utterance,
    };
  }
  if (t.includes('deep work') && t.includes('tuesday')) {
    return {
      intent: 'PROTECT_BLOCK',
      confidence: 0.9,
      params: {
        label: 'Deep Work',
        startTime: '09:00',
        endTime: '11:00',
        daysOfWeek: [2],
        rangeEnd: '2026-12-31',
      },
      mappingMethod: 'direct',
      rawUtterance: utterance,
    };
  }
  return {
    intent: 'RESOLVE_MANUAL',
    confidence: 0.5,
    params: {},
    mappingMethod: 'resolve_manual',
    rawUtterance: utterance,
  };
}

describe('classifier vs agent pilot comparison (harness only)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOAuth.mockResolvedValue({});
    mockGenerateSlots.mockResolvedValue([
      { start: '2026-06-18T15:00:00.000-05:00', end: '2026-06-18T15:30:00.000-05:00', score: 1 },
    ]);
    mockLookupInvitee.mockResolvedValue({
      isCaladdinUser: false,
      hasCalendarConnected: false,
    });
    mockHandleOfferSpecific.mockResolvedValue({
      success: true,
      intent: 'OFFER_SPECIFIC',
      requiresConfirmation: false,
      messageToUser: 'Invite sent.',
      schedulingLink: 'http://localhost:3000/s/token',
    });
    mockProtectBlock.mockResolvedValue({
      success: true,
      intent: 'PROTECT_BLOCK',
      requiresConfirmation: false,
      messageToUser: 'Blocked.',
      eventsAffected: [],
    });
  });

  it('book a slot on my calendar — agent clarifies, classifier resolves manual', async () => {
    const utterance = 'book a slot on my calendar';
    const classifier = classifierIntentFor(utterance);

    const anthropic = mockAnthropic([
      assistantMessage('What should I call the meeting, and when works for you?'),
    ]);
    const agent = await runSchedulingAgent(
      utterance,
      { userId: UID, requestId: 'req-1', timezone: TZ },
      [],
      { anthropic, prebuiltContext: { ...AGENT_CTX, systemContextBlock: 'Today: Wednesday' } },
    );

    expect(classifier.intent).toBe('RESOLVE_MANUAL');
    expect(agent.reply).toMatch(/what|when|meeting|call/i);
    expect(agent.toolCalls).toHaveLength(0);
    expect(mockCreateEventWithSync).not.toHaveBeenCalled();
  });

  it('OFFER_SPECIFIC invite unknown — agent uses lookup + send_invite with honesty', async () => {
    const utterance = 'invite jane@example.com to a 30 minute meeting';
    const classifier = classifierIntentFor(utterance);

    const anthropic = mockAnthropic([
      assistantMessage('', [
        { id: 'tu1', name: 'lookup_user', input: { email: 'jane@example.com' } },
      ]),
      assistantMessage('', [
        { id: 'tu2', name: 'send_invite', input: { inviteeEmail: 'jane@example.com', durationMinutes: 30 } },
      ]),
      assistantMessage(
        'I sent Jane a link. Once she shares her availability I can find a mutual time.',
      ),
    ]);
    const agent = await runSchedulingAgent(
      utterance,
      { userId: UID, requestId: 'req-2', timezone: TZ },
      [],
      { anthropic, prebuiltContext: { ...AGENT_CTX, systemContextBlock: 'Today: Wednesday' } },
    );

    expect(classifier.intent).toBe('OFFER_SPECIFIC');
    expect(classifier.params.inviteeEmail).toBe('jane@example.com');
    const inviteCall = agent.toolCalls.find((t) => t.name === 'send_invite');
    expect(inviteCall?.result.ok).toBe(true);
    expect(inviteCall?.result.honesty?.slotSource).toBe('host-only');
    expect(inviteCall?.result.honesty?.mutualChecked).toBe(true);
  });

  it('PROTECT_BLOCK regression — duplicate block returns already protected', async () => {
    const utterance = 'block deep work every Tuesday 9 to 11';
    const classifier = classifierIntentFor(utterance);
    expect(classifier.intent).toBe('PROTECT_BLOCK');

    const policyWithBlock: UserPolicyProfile = {
      ...BASE_POLICY,
      protectedBlocks: [
        { label: 'Deep Work', daysOfWeek: [2], startTime: '09:00', endTime: '11:00' },
      ],
    };

    const toolResult = await executeAgentTool(
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

    expect(toolResult.ok).toBe(true);
    expect(toolResult.data).toMatchObject({ alreadyProtected: true });
    expect(mockProtectBlock).not.toHaveBeenCalled();
  });
});
