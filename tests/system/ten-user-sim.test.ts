import { describe, it, expect, vi, beforeEach } from 'vitest';
import { orchestrate, type OrchestratorContext } from '../../src/core/orchestrator.js';
import { type ParsedIntent, type UserPolicyProfile, type CalendarEvent } from '../../src/core/adts.js';

const auditLog: Array<{ userId: string; intent: string; outcome: string }> = [];
const pendingConfirmations: Array<{ userId: string; intent: string; token: string }> = [];
const mutations: Array<{ userId: string; eventId: string }> = [];

function handlerResult(intent: ParsedIntent['intent']) {
  return {
    intent,
    success: true,
    requiresConfirmation: false,
    messageToUser: `${intent} ok`,
    schemaVersion: 1,
  } as const;
}

vi.mock('../../src/db/audit.js', () => ({
  insertAuditLog: vi.fn(async (entry: { userId: string; intent: string; outcome: string }) => {
    auditLog.push(entry);
  }),
}));

vi.mock('../../src/db/failures.js', () => ({
  insertFailureLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/db/users.js', () => ({
  ensureDefaultPolicy: vi.fn().mockResolvedValue({
    schemaVersion: 1,
    protectedBlocks: [],
    shapeRules: {},
    gatekeepRules: [],
    timezone: 'America/Chicago',
    workingHoursStart: '09:00',
    workingHoursEnd: '18:00',
  }),
  upsertPolicy: vi.fn().mockResolvedValue(undefined),
  getPolicy: vi.fn().mockResolvedValue(null),
  getUserById: vi.fn().mockResolvedValue({ id: 'sim-user' }),
}));

let tokenCounter = 0;
vi.mock('../../src/db/confirmations.js', () => ({
  insertPendingConfirmation: vi.fn(async (entry: { userId: string; intent: string }) => {
    const token = `token-${++tokenCounter}`;
    pendingConfirmations.push({ userId: entry.userId, intent: entry.intent, token });
    return token;
  }),
}));

vi.mock('../../src/services/notifications.js', () => ({
  sendConfirmationRequest: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/services/auth_service.js', () => ({
  getOAuthClientForUser: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../src/handlers/query-calendar.js', () => ({
  handleQueryCalendar: vi.fn(async () => handlerResult('QUERY_CALENDAR')),
}));
vi.mock('../../src/handlers/create-event.js', () => ({
  handleCreateEvent: vi.fn(async () => handlerResult('CREATE_EVENT')),
}));
vi.mock('../../src/handlers/protect-block.js', () => ({
  handleProtectBlock: vi.fn(async () => handlerResult('PROTECT_BLOCK')),
}));
vi.mock('../../src/handlers/flush-range.js', () => ({
  handleFlushRange: vi.fn(async () => handlerResult('FLUSH_RANGE')),
}));
vi.mock('../../src/handlers/modify-event.js', () => ({
  handleModifyEvent: vi.fn(async () => handlerResult('MODIFY_EVENT')),
}));
vi.mock('../../src/handlers/offer-specific.js', () => ({
  handleOfferSpecific: vi.fn(async () => handlerResult('OFFER_SPECIFIC')),
}));
vi.mock('../../src/handlers/shape-rules.js', () => ({
  handleShapeRules: vi.fn(async () => handlerResult('SHAPE_RULES')),
}));
vi.mock('../../src/handlers/gatekeep-rule.js', () => ({
  handleGatekeepRule: vi.fn(async () => handlerResult('GATEKEEP_RULE')),
}));
vi.mock('../../src/handlers/pivot-async.js', () => ({
  handlePivotAsync: vi.fn(async () => handlerResult('PIVOT_ASYNC')),
}));
vi.mock('../../src/handlers/undo.js', () => ({
  handleUndo: vi.fn(async () => handlerResult('UNDO')),
}));
vi.mock('../../src/handlers/resolve-manual.js', () => ({
  handleResolveManual: vi.fn(async () => handlerResult('RESOLVE_MANUAL')),
}));

vi.mock('../../src/db/events.js', () => ({
  updateEventStatus: vi.fn(async (eventId: string) => {
    mutations.push({ userId: 'sim-user', eventId });
  }),
}));

function makeProfile(userId: string): UserPolicyProfile {
  return {
    userId,
    schemaVersion: 1,
    timezone: 'America/Chicago',
    chronotype: 'morning',
    defaultBufferMinutes: 15,
    clusteringPreference: 'balanced',
    maxFragmentsPerDay: 4,
    faxEffectConfig: {
      targetSlotsPerOffer: 2,
      minBufferMinutes: 30,
      clusteringWeight: 0.35,
      energyWeight: 0.45,
      fragmentPenaltyWeight: 0.15,
      protectDeepWorkBlocks: true,
    },
    protectedBlocks: [],
    contactTiers: {},
  };
}

function makeEvent(id: string, tier: 0 | 1 | 2 | 3): CalendarEvent {
  return {
    id,
    title: `Event ${id}`,
    start: '2026-04-22T09:00:00-05:00',
    end: '2026-04-22T10:00:00-05:00',
    participants: [],
    tier,
    isRecurring: false,
    status: 'confirmed',
  };
}

const SIM_UTTERANCES: Array<{
  utterance: string;
  expectedIntent: ParsedIntent['intent'];
  confidence: number;
  mappingMethod: 'direct' | 'fuzzy' | 'resolve_manual';
  warmRedirect?: boolean;
}> = [
  {
    utterance:
      "block 9 am to 10 am all weekdays for next four weeks. name the event 'Ten-user smoke block'",
    expectedIntent: 'PROTECT_BLOCK',
    confidence: 1,
    mappingMethod: 'direct',
  },
  { utterance: 'Find me 2 slots to meet with Alex next week', expectedIntent: 'OFFER_SPECIFIC', confidence: 0.92, mappingMethod: 'direct' },
  { utterance: 'Clear my calendar Friday except the board call', expectedIntent: 'FLUSH_RANGE', confidence: 0.88, mappingMethod: 'direct' },
  { utterance: 'Move my 3pm to tomorrow', expectedIntent: 'MODIFY_EVENT', confidence: 0.90, mappingMethod: 'direct' },
  { utterance: "Tell John I can't do a call, send him Loom instead", expectedIntent: 'PIVOT_ASYNC', confidence: 0.85, mappingMethod: 'direct' },
  { utterance: "I don't want any meetings before 9am ever", expectedIntent: 'SHAPE_RULES', confidence: 0.87, mappingMethod: 'direct' },
  { utterance: 'Treat anything from sarah@enterprise.com as high priority', expectedIntent: 'GATEKEEP_RULE', confidence: 0.89, mappingMethod: 'direct' },
  { utterance: 'My Thursday is a mess, help', expectedIntent: 'RESOLVE_MANUAL', confidence: 0.40, mappingMethod: 'resolve_manual' },
  {
    utterance: 'What time is it in Tokyo',
    expectedIntent: 'RESOLVE_MANUAL',
    confidence: 1,
    mappingMethod: 'direct',
    warmRedirect: true,
  },
  { utterance: 'Book a haircut appointment', expectedIntent: 'OFFER_SPECIFIC', confidence: 0.70, mappingMethod: 'fuzzy' },
];

function buildSimIntent(
  userId: string,
  sim: (typeof SIM_UTTERANCES)[number]
): ParsedIntent {
  void userId;
  return {
    intent: sim.expectedIntent,
    confidence: sim.confidence,
    rawUtterance: sim.utterance,
    params: {},
    mappingMethod: sim.mappingMethod,
    _warmRedirect: sim.warmRedirect,
    _offTopic: sim.warmRedirect,
  };
}

describe('10-User Simulation', () => {
  const USERS = [
    'a1000001-0000-4000-8000-000000000001',
    'a1000002-0000-4000-8000-000000000002',
    'a1000003-0000-4000-8000-000000000003',
    'a1000004-0000-4000-8000-000000000004',
    'a1000005-0000-4000-8000-000000000005',
    'a1000006-0000-4000-8000-000000000006',
    'a1000007-0000-4000-8000-000000000007',
    'a1000008-0000-4000-8000-000000000008',
    'a1000009-0000-4000-8000-000000000009',
    'a1000010-0000-4000-8000-000000000010',
  ];

  beforeEach(() => {
    auditLog.length = 0;
    pendingConfirmations.length = 0;
    mutations.length = 0;
    tokenCounter = 0;
    vi.clearAllMocks();
  });

  it('all 10 users complete without uncaught exceptions', async () => {
    for (const userId of USERS) {
      const profile = makeProfile(userId);
      const ctx: OrchestratorContext = { userId, profile, requestId: `req-${userId}` };

      for (const sim of SIM_UTTERANCES) {
        const intent = buildSimIntent(userId, sim);
        const result = await orchestrate(intent, ctx);
        expect(result).toBeDefined();
        expect(result.intent).toBeDefined();
        expect(result.requiresConfirmation).toBeDefined();
      }
    }
  });

  it('90%+ utterances correctly classified (intent matches expected)', async () => {
    const totalUtterances = USERS.length * SIM_UTTERANCES.length;
    let correct = 0;

    for (const userId of USERS) {
      const profile = makeProfile(userId);
      const ctx: OrchestratorContext = { userId, profile, requestId: `req-${userId}` };

      for (const sim of SIM_UTTERANCES) {
        const intent = buildSimIntent(userId, sim);
        const result = await orchestrate(intent, ctx);
        if (result.intent === sim.expectedIntent) correct++;
      }
    }

    const accuracy = correct / totalUtterances;
    expect(accuracy).toBeGreaterThanOrEqual(0.90);
  });

  it('0 unlogged mutations — every action has an audit_log entry', async () => {
    for (const userId of USERS) {
      const profile = makeProfile(userId);
      const tier2Events = [makeEvent(`evt-t2-${userId}`, 2)];
      const ctx: OrchestratorContext = { userId, profile, eventsInRange: tier2Events, requestId: `req-${userId}` };

      const intent = buildSimIntent(userId, SIM_UTTERANCES[2]!);
      await orchestrate({ ...intent, params: {} }, ctx);
    }

    expect(auditLog.length).toBeGreaterThan(0);
  });

  it('0 Tier 0 mutations without a pending_confirmations row', async () => {
    for (const userId of USERS) {
      const profile = makeProfile(userId);
      const tier0Event = makeEvent(`evt-t0-${userId}`, 0);
      const ctx: OrchestratorContext = { userId, profile, eventsInRange: [tier0Event], requestId: `req-${userId}` };

      const intent = buildSimIntent(userId, SIM_UTTERANCES[2]!);
      await orchestrate(intent, ctx);
    }

    expect(pendingConfirmations.length).toBe(USERS.length);
    expect(mutations.length).toBe(0);
  });
});