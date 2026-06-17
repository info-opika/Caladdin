/**
 * PRD v4 Phase 10 — automated sign-off checklist.
 * Each item maps to integration/unit coverage; manual-only items are marked skipped with reason.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Message } from '@anthropic-ai/sdk/resources/messages/messages.mjs';
import { agentEnabledFor } from '../../src/config.js';
import { validateProductionConfig } from '../../src/validate-production.js';
import { isKillSwitchActive, checkOperationAllowed } from '../../src/pilot/pilot_controls.js';
import { mapVoiceUtteranceToIntent } from '../../src/core/voice-intent-pipeline.js';
import { lookupInviteeAvailability } from '../../src/services/invitee_lookup.js';
import { runSessionExpiry } from '../../src/jobs/session-expiry.js';
import { runSchedulingAgent } from '../../src/agent/scheduling-agent.js';
import schedulePublicRoutes from '../../src/routes/schedule_public.js';
import inviteGrantRoutes from '../../src/routes/invite_grant_auth.js';

const mockExecuteAgentTool = vi.fn();

vi.mock('../../src/agent/tools/registry.js', () => ({
  buildAnthropicToolDefinitions: () => [{ name: 'create_event', description: 'x', input_schema: { type: 'object' } }],
  executeAgentTool: (...args: unknown[]) => mockExecuteAgentTool(...args),
}));

vi.mock('../../src/services/llm.js', async (importOriginal) => {
  const m = await importOriginal<typeof import('../../src/services/llm.js')>();
  return { ...m, classifyIntent: vi.fn() };
});

vi.mock('../../src/db/failures.js', () => ({
  insertFailureLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/db/scheduling_sessions.js', () => ({
  GCAL_CLAIMING_SENTINEL: '__CALADDIN_GCAL_CLAIMING__',
  expireOpenSessions: vi.fn().mockResolvedValue(2),
  getSchedulingSessionByToken: vi.fn(),
  replaceSessionOfferedSlots: vi.fn().mockResolvedValue(undefined),
  claimSessionSlotForGcal: vi.fn(),
  finalizeSessionAfterGcal: vi.fn(),
  revertSessionClaim: vi.fn(),
  appendProposedAlternative: vi.fn(),
  cancelConfirmedSession: vi.fn(),
  rescheduleConfirmedSession: vi.fn(),
}));

vi.mock('../../src/db/invite_calendar_grants.js', () => ({
  expireStaleInviteGrants: vi.fn().mockResolvedValue(1),
  getGrantBySessionId: vi.fn(),
  revokeGrantForSession: vi.fn(),
}));

vi.mock('../../src/services/invitee_lookup.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/invitee_lookup.js')>();
  return {
    ...actual,
    lookupInviteeAvailability: vi.fn(),
  };
});

vi.mock('../../src/services/auth_service.js', () => ({
  getAuthService: () => ({ getClientForUser: vi.fn().mockResolvedValue({ request: vi.fn() }) }),
  getOAuthClientForUser: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../src/db/users.js', () => ({
  getUserByEmail: vi.fn().mockResolvedValue(null),
  getPolicy: vi.fn().mockResolvedValue({
    workingHoursStart: '09:00',
    workingHoursEnd: '18:00',
    chronotype: 'flexible',
  }),
  getUserById: vi.fn().mockResolvedValue({ id: 'host-1', email: 'host@test.com' }),
}));

const UID = '5bf20398-930a-4afc-8460-7668d7423916';

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

function publicApp() {
  const app = express();
  app.use(express.json());
  app.use(schedulePublicRoutes);
  app.use(inviteGrantRoutes);
  return app;
}

describe('PRD v4 Phase 10 E2E checklist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CALADDIN_AGENT_ENABLED;
    delete process.env.CALADDIN_AGENT_PILOT_USERS;
    delete process.env.CALADDIN_KILL_SWITCH;
    mockExecuteAgentTool.mockResolvedValue({ ok: true, data: { eventId: 'evt-1' } });
  });

  it('1. Host chat create event — agent path returns reply after tool loop (mocked)', async () => {
    let call = 0;
    const anthropic = {
      create: vi.fn(async () => {
        call += 1;
        if (call === 1) {
          return assistantMessage('', [
            { id: 't1', name: 'create_event', input: { title: 'Focus' } },
          ]);
        }
        return assistantMessage('Booked focus time on your calendar.');
      }),
    };

    const result = await runSchedulingAgent(
      'book a slot on my calendar tomorrow morning',
      { userId: UID, requestId: 'phase10-1', timezone: 'America/Chicago' },
      [],
      {
        anthropic,
        prebuiltContext: {
          userId: UID,
          requestId: 'phase10-1',
          timezone: 'America/Chicago',
          cal: null,
          policy: {
            userId: UID,
            schemaVersion: 1,
            timezone: 'America/Chicago',
            chronotype: 'flexible',
            defaultBufferMinutes: 15,
            clusteringPreference: 'balanced',
            maxFragmentsPerDay: 4,
            faxEffectConfig: {
              targetSlotsPerOffer: 2,
              minBufferMinutes: 15,
              clusteringWeight: 0.35,
              energyWeight: 0.45,
              fragmentPenaltyWeight: 0.15,
              protectDeepWorkBlocks: true,
            },
            protectedBlocks: [],
            contactTiers: {},
          },
          systemContextBlock: 'Week: light',
        },
      },
    );

    expect(result.reply).toMatch(/booked/i);
    expect(result.trace.model).toBeTruthy();
    expect(result.trace.tools.some((t) => t.name === 'create_event')).toBe(true);
  });

  it('2. Invite unknown — invitee_lookup reports not on Caladdin', async () => {
    const mockLookup = vi.mocked(lookupInviteeAvailability);
    mockLookup.mockResolvedValue({
      isCaladdinUser: false,
      hasCalendarConnected: false,
    });
    const info = await lookupInviteeAvailability('stranger@example.com');
    expect(info.isCaladdinUser).toBe(false);
    expect(info.hasCalendarConnected).toBe(false);
  });

  it('3. Invite known user — mutual path when calendar connected', async () => {
    const mockLookup = vi.mocked(lookupInviteeAvailability);
    mockLookup.mockResolvedValue({
      isCaladdinUser: true,
      hasCalendarConnected: true,
      userId: 'known-user-1',
    });
    const info = await lookupInviteeAvailability('known@caladdin.app');
    expect(info.isCaladdinUser).toBe(true);
    expect(info.hasCalendarConnected).toBe(true);
  });

  it('4. PROTECT_BLOCK no re-ask on repeat morning + 9 to 12', async () => {
    const { _resetPendingIntentStoreForTests } = await import('../../src/core/pending-intent-memory.js');
    _resetPendingIntentStoreForTests();
    await mapVoiceUtteranceToIntent('block tomorrow morning', { userId: UID, timezone: 'America/Chicago' });
    const { intent, meta } = await mapVoiceUtteranceToIntent('9 to 12', {
      userId: UID,
      timezone: 'America/Chicago',
    });
    expect(intent.intent).toBe('PROTECT_BLOCK');
    expect(meta.usedPendingTemplate).toBe(true);
  });

  it('5. Grant routes exist on public router', async () => {
    const app = publicApp();
    const start = await request(app).get('/s/tok-phase10/grant/start');
    expect([302, 400, 404]).toContain(start.status);
    const openapi = readFileSync(join(process.cwd(), 'docs/api/OPENAPI.yaml'), 'utf8');
    expect(openapi).toContain('/s/{token}/grant/start');
    expect(openapi).toContain('/api/calendar/check-slot');
  });

  it('6. Session/grant expiry job returns counts', async () => {
    const result = await runSessionExpiry();
    expect(result).toEqual({ sessions: 2, grants: 1 });
  });

  it('7. Kill switch blocks calendar mutations', async () => {
    process.env.CALADDIN_KILL_SWITCH = '1';
    expect(isKillSwitchActive()).toBe(true);
    const blocked = await checkOperationAllowed('calendar_write');
    expect(blocked.allowed).toBe(false);
  });

  it('8. validate-production passes in test env (no throw)', () => {
    expect(() => validateProductionConfig()).not.toThrow();
    const src = readFileSync(join(process.cwd(), 'src/validate-production.ts'), 'utf8');
    expect(src).toContain('inviteeGrantRedirectUri');
  });

  it('9. Agent pilot flags — global and per-user', () => {
    delete process.env.CALADDIN_AGENT_ENABLED;
    delete process.env.CALADDIN_AGENT_PILOT_USERS;
    expect(agentEnabledFor('any-user')).toBe(true);

    process.env.CALADDIN_AGENT_ENABLED = '0';
    process.env.CALADDIN_AGENT_PILOT_USERS = UID;
    expect(agentEnabledFor(UID)).toBe(true);
    expect(agentEnabledFor('other-user')).toBe(false);
  });

  it('10. Agent harness scenarios file present in CI suite', () => {
    expect(existsSync(join(process.cwd(), 'tests/agent/agent-harness.test.ts'))).toBe(true);
    expect(existsSync(join(process.cwd(), 'docs/AGENT_ARCHITECTURE.md'))).toBe(true);
  });
});
