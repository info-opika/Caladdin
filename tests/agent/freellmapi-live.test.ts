import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { UserPolicyProfile } from '../../src/core/adts.js';
import type { AgentContext } from '../../src/agent/types.js';
import { runSchedulingAgent } from '../../src/agent/scheduling-agent.js';
import { createLlmClient } from '../../src/services/llm/index.js';

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
}));

vi.mock('../../src/db/users.js', () => ({
  upsertPolicy: vi.fn().mockResolvedValue(undefined),
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
  requestId: 'live-req',
  timezone: 'America/Chicago',
  cal: {} as import('googleapis').calendar_v3.Calendar,
  policy: BASE_POLICY,
  conversationContext: null,
};

const live =
  process.env.FREELLMAPI_LIVE === '1' && Boolean(process.env.FREELLMAPI_API_KEY?.trim());

const REPEATS = Number.parseInt(process.env.FREELLMAPI_LIVE_REPEATS ?? '1', 10);

type LiveScenario = {
  name: string;
  utterance: string;
  assert: (result: Awaited<ReturnType<typeof runSchedulingAgent>>) => void;
};

const SCENARIOS: LiveScenario[] = [
  {
    name: 'vague booking asks clarifying question',
    utterance: 'book a slot on my calendar',
    assert: (result) => {
      expect(result.reply.length).toBeGreaterThan(5);
      expect(mockCreateEventWithSync).not.toHaveBeenCalled();
    },
  },
  {
    name: 'off-topic weather refused without tool spam',
    utterance: 'what is the weather in Austin tomorrow',
    assert: (result) => {
      expect(result.toolCalls).toHaveLength(0);
      expect(result.trace.prefilterBypass).toBe(true);
    },
  },
  {
    name: 'invite flow uses lookup and send_invite',
    utterance: 'invite jane@example.com to a 30 minute meeting',
    assert: (result) => {
      const names = result.toolCalls.map((t) => t.name);
      expect(names).toContain('lookup_user');
      expect(names).toContain('send_invite');
    },
  },
];

describe.skipIf(!live)('freellmapi live open routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOAuth.mockResolvedValue({});
    mockGetSessionByToken.mockResolvedValue({
      id: 'sess-live',
      token: 'tok-live',
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
    mockHandleOfferSpecific.mockResolvedValue({
      success: true,
      intent: 'OFFER_SPECIFIC',
      requiresConfirmation: false,
      messageToUser: 'Invite sent.',
      schedulingLink: 'http://localhost:3000/s/live',
      sessionToken: 'token',
      slotSource: 'host_only_pending_grant',
      slots: [{ start: '2026-06-18T15:00:00.000-05:00', end: '2026-06-18T15:30:00.000-05:00' }],
      schemaVersion: 1,
    });
  });

  for (const scenario of SCENARIOS) {
    it(`${scenario.name} (open routing)`, async () => {
      for (let i = 0; i < REPEATS; i += 1) {
        const result = await runSchedulingAgent(
          scenario.utterance,
          { userId: AGENT_CTX.userId, requestId: `live-${scenario.name}-${i}`, timezone: AGENT_CTX.timezone },
          [],
          {
            llm: createLlmClient(),
            prebuiltContext: { ...AGENT_CTX, systemContextBlock: 'Today: Wednesday, June 18, 2026' },
          },
        );

        scenario.assert(result);
        expect(result.trace.requestedModel).toBeTruthy();
        if (result.trace.routedViaRounds?.length) {
          expect(result.trace.routedViaRounds[0]).toBeTruthy();
        }
      }
    }, 120_000);
  }
});
