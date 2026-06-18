import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentContext } from '../../src/agent/types.js';
import type { UserPolicyProfile } from '../../src/core/adts.js';
import { runAgentPrefilter } from '../../src/agent/agent-prefilter.js';

const mockExecute = vi.fn();

vi.mock('../../src/agent/tools/registry.js', () => ({
  executeAgentTool: (...args: unknown[]) => mockExecute(...args),
}));

const POLICY: UserPolicyProfile = {
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
  setupFieldsAnswered: [],
};

const CTX: AgentContext = {
  userId: '11111111-1111-4111-8111-111111111111',
  requestId: 'req-pf',
  timezone: 'America/Chicago',
  cal: {} as import('googleapis').calendar_v3.Calendar,
  policy: POLICY,
  conversationContext: null,
};

describe('runAgentPrefilter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns off-topic refusal without LLM for weather', async () => {
    const out = await runAgentPrefilter('what is the weather in Paris', CTX, 'auto:caladdin-agent');
    expect(out.bypassed).toBe(true);
    if (out.bypassed) {
      expect(out.prefilter).toBe('off_topic');
      expect(out.toolCalls).toHaveLength(0);
    }
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('bypasses LLM for obvious calendar today query', async () => {
    mockExecute.mockResolvedValue({
      ok: true,
      data: { events: [{ title: 'Standup', start: '2026-06-18T09:00:00-05:00', end: '2026-06-18T09:30:00-05:00' }] },
    });

    const out = await runAgentPrefilter("what's on my calendar today", CTX, 'auto:caladdin-agent');
    expect(out.bypassed).toBe(true);
    if (out.bypassed) {
      expect(out.prefilter).toBe('query');
      expect(mockExecute).toHaveBeenCalledWith('get_calendar_summary', expect.any(Object), CTX);
    }
  });
});
