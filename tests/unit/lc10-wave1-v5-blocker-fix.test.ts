/**
 * LC10 Wave 1 v5 — blocker fixes: ambiguous follow-up times, scheduling default, no blind AM/PM.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mapVoiceUtteranceToIntent } from '../../src/core/voice-intent-pipeline.js';
import {
  _resetPendingIntentStoreForTests,
  parseFollowUpHourRange,
} from '../../src/core/pending-intent-memory.js';
import { handleResolveManual } from '../../src/handlers/resolve-manual.js';
import { finalizeSchedulingLinkStructuredContract } from '../../src/core/scheduling-link-contract.js';
import { ParsedIntentSchema } from '../../src/core/adts.js';
import type { UserPolicyProfile } from '../../src/core/adts.js';

vi.mock('../../src/services/llm.js', async (importOriginal) => {
  const m = await importOriginal<typeof import('../../src/services/llm.js')>();
  return { ...m, classifyIntent: vi.fn() };
});

vi.mock('../../src/db/failures.js', () => ({
  insertFailureLog: vi.fn().mockResolvedValue(undefined),
}));

import { classifyIntent } from '../../src/services/llm.js';

const mockClassify = vi.mocked(classifyIntent);
const UID = '5bf20398-930a-4afc-8460-7668d7423916';
const TZ = 'America/Chicago';

const profile: UserPolicyProfile = {
  userId: UID,
  schemaVersion: 1,
  timezone: TZ,
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
};

describe('LC10 Wave 1 v5 — ambiguous follow-up times', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetPendingIntentStoreForTests();
  });

  it('1. lunch follow-up 1 to 2 → 13:00–14:00 with lunch context', () => {
    const r = parseFollowUpHourRange('1 to 2', 'block lunch every weekday');
    expect(r.status).toBe('resolved');
    if (r.status === 'resolved') {
      expect(r.startTime).toBe('13:00');
      expect(r.endTime).toBe('14:00');
    }
  });

  it('2. evening follow-up 7 to 8 → 19:00–20:00 with evening context', () => {
    const r = parseFollowUpHourRange('7 to 8', 'protect evenings for family');
    expect(r.status).toBe('resolved');
    if (r.status === 'resolved') {
      expect(r.startTime).toBe('19:00');
      expect(r.endTime).toBe('20:00');
    }
  });

  it('3. bare 1 to 2 without daypart context → ambiguous', () => {
    const r = parseFollowUpHourRange('1 to 2', 'block deep work every weekday');
    expect(r.status).toBe('ambiguous');
  });

  it('4. clarification path for unresolved ambiguity via voice pipeline', async () => {
    await mapVoiceUtteranceToIntent('block deep work every weekday', { userId: UID, timezone: TZ });
    const { intent, meta } = await mapVoiceUtteranceToIntent('1 to 2', { userId: UID, timezone: TZ });
    expect(intent.intent).toBe('RESOLVE_MANUAL');
    expect((intent.params as { reason?: string }).reason).toBe('protect_followup_time_ambiguous');
    expect(meta.ambiguousFollowUpTime).toBe(true);
    expect(meta.usedPendingTemplate).toBe(false);
  });

  it('5. resolve-manual message asks am vs pm', async () => {
    const intent = ParsedIntentSchema.parse({
      intent: 'RESOLVE_MANUAL',
      rawUtterance: 'block weekdays',
      confidence: 0.5,
      params: {
        reason: 'protect_followup_time_ambiguous',
        clarifyHourStart: 1,
        clarifyHourEnd: 2,
      },
      mappingMethod: 'resolve_manual',
    });
    const result = await handleResolveManual(intent, { userId: UID, requestId: 'req-1' }, null);
    expect(result.messageToUser).toMatch(/1am.*2am.*1pm.*2pm/i);
  });

  it('6. morning follow-up 9 to 12 stays AM (no blind PM)', async () => {
    await mapVoiceUtteranceToIntent('block tomorrow morning', { userId: UID, timezone: TZ });
    const { intent } = await mapVoiceUtteranceToIntent('9 to 12', { userId: UID, timezone: TZ });
    expect(intent.intent).toBe('PROTECT_BLOCK');
    expect((intent.params as { startTime?: string }).startTime).toBe('09:00');
    expect((intent.params as { endTime?: string }).endTime).toBe('12:00');
  });

  it('7. explicit am/pm follow-up never blind-guesses', () => {
    const r = parseFollowUpHourRange('1pm to 2pm', 'block lunch every weekday');
    expect(r.status).toBe('resolved');
    if (r.status === 'resolved') {
      expect(r.startTime).toBe('13:00');
      expect(r.endTime).toBe('14:00');
    }
  });

  it('8. integration: lunch weekday voice path', async () => {
    await mapVoiceUtteranceToIntent('block lunch every weekday', { userId: UID, timezone: TZ });
    const { intent } = await mapVoiceUtteranceToIntent('1 to 2', { userId: UID, timezone: TZ });
    expect(intent.intent).toBe('PROTECT_BLOCK');
    expect((intent.params as { startTime?: string }).startTime).toBe('13:00');
  });

  it('9. integration: evenings voice path', async () => {
    await mapVoiceUtteranceToIntent('protect evenings for family', { userId: UID, timezone: TZ });
    const { intent } = await mapVoiceUtteranceToIntent('7 to 8', { userId: UID, timezone: TZ });
    expect(intent.intent).toBe('PROTECT_BLOCK');
    expect((intent.params as { startTime?: string }).startTime).toBe('19:00');
  });
});

describe('LC10 Wave 1 v5 — scheduling default decision', () => {
  it('10. schedulingDefaultSearchWindow alone does not inject clock hours', () => {
    const draft = ParsedIntentSchema.parse({
      intent: 'SCHEDULING_LINK',
      rawUtterance: 'find time with a@b.com',
      confidence: 0.9,
      params: {
        inviteeEmail: 'a@b.com',
        schedulingDefaultSearchWindow: true,
        schedulingUnsupportedConstraints: [],
      },
      mappingMethod: 'direct',
    });
    const out = finalizeSchedulingLinkStructuredContract('find time with a@b.com', TZ, draft);
    expect(out.intent).toBe('SCHEDULING_LINK');
    expect((out.params as Record<string, unknown>)['windowStartHourLocal']).toBeUndefined();
    expect((out.params as Record<string, unknown>)['windowEndHourLocal']).toBeUndefined();
  });

  it('11. scheduling link regression: explicit range preserved', async () => {
    mockClassify.mockResolvedValue({
      intent: 'SCHEDULING_LINK',
      confidence: 0.92,
      params: {
        inviteeEmail: 'john@example.com',
        parsedSchedulingDateRange: { start: '2026-05-25', end: '2026-05-31' },
        schedulingUnsupportedConstraints: [],
        windowStartHourLocal: 9,
        windowEndHourLocal: 17,
      },
      mappingMethod: 'direct',
      rawUtterance: 'find time with john@example.com next week 9am to 5pm',
    });
    const { intent } = await mapVoiceUtteranceToIntent(
      'find time with john@example.com next week 9am to 5pm',
      { userId: UID, timezone: TZ }
    );
    expect(intent.intent).toBe('SCHEDULING_LINK');
    const pr = intent.params as { parsedSchedulingDateRange?: { start: string } };
    expect(pr.parsedSchedulingDateRange?.start).toBe('2026-05-25');
  });
});
