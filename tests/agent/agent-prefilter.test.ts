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

  it('allows short follow-ups during an active session', async () => {
    mockExecute.mockResolvedValue({ ok: true, data: { message: 'Block created.' } });
    const history = [
      { role: 'user' as const, content: 'Block 30 minutes for meditation' },
      { role: 'assistant' as const, content: 'Which day and time?' },
      { role: 'user' as const, content: 'Everyday from 7 AM to 7:30 AM' },
      { role: 'assistant' as const, content: 'What label?' },
    ];
    const out = await runAgentPrefilter('Recurring every day', CTX, 'auto:smart', history);
    expect(out.bypassed).toBe(true);
    if (out.bypassed) {
      expect(out.prefilter).not.toBe('off_topic');
    }
  });

  it('bypasses LLM for bare calendar query defaulting to today', async () => {
    mockExecute.mockResolvedValue({ ok: true, data: { events: [] } });

    const out = await runAgentPrefilter('what is on my calendar', CTX, 'auto:caladdin-agent');
    expect(out.bypassed).toBe(true);
    if (out.bypassed) {
      expect(out.prefilter).toBe('query');
      expect(mockExecute).toHaveBeenCalledWith('get_calendar_summary', expect.any(Object), CTX);
    }
  });

  it('bypasses LLM for meeting count today', async () => {
    mockExecute.mockResolvedValue({
      ok: true,
      data: { events: [{ title: 'A' }, { title: 'B' }] },
    });

    const out = await runAgentPrefilter('how many meetings today', CTX, 'auto:caladdin-agent');
    expect(out.bypassed).toBe(true);
    if (out.bypassed) {
      expect(out.reply).toContain('2 meetings');
    }
  });

  it('executes completed scheduling task without LLM on day follow-up', async () => {
    mockExecute
      .mockResolvedValueOnce({ ok: true, data: { recognized: false } })
      .mockResolvedValueOnce({ ok: true, data: { message: 'Invite sent.' } });

    const history = [
      { role: 'user' as const, content: 'Invite aniket@opika.co Monday at 10 pm ist for sync' },
      { role: 'assistant' as const, content: 'What day works?' },
    ];
    const out = await runAgentPrefilter('monday', CTX, 'auto:smart', history);
    expect(out.bypassed).toBe(true);
    if (out.bypassed) {
      expect(['scheduling_execute', 'protect_block']).toContain(out.prefilter);
    }
  });

  it('assembles recurring block from merged session turns', async () => {
    mockExecute.mockResolvedValue({ ok: true, data: { message: 'Block created.' } });
    const history = [
      { role: 'user' as const, content: 'Block 30 minutes for meditation' },
      { role: 'assistant' as const, content: 'Which day and time?' },
      { role: 'user' as const, content: 'Everyday from 7 AM Texas time to 7:30 AM Texas time' },
      { role: 'assistant' as const, content: 'What label?' },
    ];
    const out = await runAgentPrefilter('Meditation Time', CTX, 'auto:smart', history);
    expect(out.bypassed).toBe(true);
    if (out.bypassed) {
      expect(out.prefilter).toBe('protect_block');
      expect(mockExecute).toHaveBeenCalledWith(
        'create_recurring_block',
        expect.objectContaining({
          label: 'Meditation Time',
          startTime: '07:00',
          endTime: '07:30',
        }),
        CTX,
      );
    }
  });

  it('skips scheduling link when invite flow is in progress without link phrasing', async () => {
    mockExecute.mockResolvedValue({ ok: true, data: { events: [] } });

    const out = await runAgentPrefilter(
      'Schedule a meeting with aniket@opika.co',
      CTX,
      'auto:caladdin-agent',
    );
    expect(out.bypassed).toBe(false);
    expect(mockExecute).not.toHaveBeenCalledWith('send_invite', expect.anything(), CTX);
  });

  it('bypasses LLM for find N slots OFFER_SPECIFIC request', async () => {
    mockExecute
      .mockResolvedValueOnce({ ok: true, data: { recognized: true } })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          message: 'Share this link: http://localhost:3001/s/abc123',
          schedulingLink: 'http://localhost:3001/s/abc123',
        },
      });

    const out = await runAgentPrefilter(
      'Find 2 slots for aniket@opika.co next week',
      CTX,
      'auto:caladdin-agent',
    );
    expect(out.bypassed).toBe(true);
    if (out.bypassed) {
      expect(out.prefilter).toBe('scheduling_link');
      expect(out.reply).toContain('/s/');
      expect(mockExecute).toHaveBeenCalledWith('send_invite', expect.any(Object), CTX);
    }
  });
});
