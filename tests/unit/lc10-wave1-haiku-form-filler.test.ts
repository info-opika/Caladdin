/**
 * LC10 Wave 1 — Haiku form-filler + strict validator contract tests (P0 voice pipeline).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import { mapVoiceUtteranceToIntent } from '../../src/core/voice-intent-pipeline.js';
import { _resetPendingIntentStoreForTests } from '../../src/core/pending-intent-memory.js';
import {
  validateHaikuMapperOutput,
  validateHaikuJsonString,
} from '../../src/core/parsed-intent-validator.js';

vi.mock('../../src/services/llm.js', () => ({
  classifyIntent: vi.fn(),
  isCalendarRelated: vi.fn(),
}));

vi.mock('../../src/db/failures.js', () => ({
  insertFailureLog: vi.fn().mockResolvedValue(undefined),
}));

import { classifyIntent, isCalendarRelated } from '../../src/services/llm.js';

const mockClassify = vi.mocked(classifyIntent);
const mockIsCalendar = vi.mocked(isCalendarRelated);

const UID = '5bf20398-930a-4afc-8460-7668d7423916';
const TZ = 'America/Chicago';

describe('LC10 Wave 1 — Haiku pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetPendingIntentStoreForTests();
    mockIsCalendar.mockReturnValue(true);
  });

  it('1. what’s on my calendar tomorrow → QUERY_CALENDAR (prefilter, no Haiku)', async () => {
    const { intent: r } = await mapVoiceUtteranceToIntent("what's on my calendar tomorrow", {
      userId: UID,
      timezone: TZ,
    });
    expect(r.intent).toBe('QUERY_CALENDAR');
    expect((r.params as { queryType?: string }).queryType).toBe('tomorrow');
    expect(mockClassify).not.toHaveBeenCalled();
  });

  it('2. find time with john@example.com next week → SCHEDULING_LINK (Haiku)', async () => {
    mockClassify.mockResolvedValue({
      intent: 'SCHEDULING_LINK',
      confidence: 0.9,
      params: {
        inviteeEmail: 'john@example.com',
        parsedSchedulingDateRange: { start: '2026-05-25', end: '2026-05-31' },
        schedulingUnsupportedConstraints: [],
      },
      mappingMethod: 'direct',
      rawUtterance: 'find time with john@example.com next week',
    });
    const { intent: r } = await mapVoiceUtteranceToIntent('find time with john@example.com next week', {
      userId: UID,
      timezone: TZ,
    });
    expect(r.intent).toBe('SCHEDULING_LINK');
    expect((r.params as { inviteeEmail?: string }).inviteeEmail).toBe('john@example.com');
    expect(mockClassify).toHaveBeenCalled();
  });

  it('3. block tomorrow morning → clarification, no hardcoded time', async () => {
    const { intent: r } = await mapVoiceUtteranceToIntent('block tomorrow morning', {
      userId: UID,
      timezone: TZ,
    });
    expect(r.intent).toBe('RESOLVE_MANUAL');
    expect((r.params as { reason?: string }).reason).toBe('vague_protect_timing');
    expect((r.params as { startTime?: string }).startTime).toBeUndefined();
    expect(mockClassify).not.toHaveBeenCalled();
  });

  it('4. block lunch every weekday → clarification, no lunch default', async () => {
    const { intent: r } = await mapVoiceUtteranceToIntent('block lunch every weekday', {
      userId: UID,
      timezone: TZ,
    });
    expect(r.intent).toBe('RESOLVE_MANUAL');
    expect((r.params as { reason?: string }).reason).toBe('vague_protect_timing');
    expect((r.params as { startTime?: string }).startTime).toBeUndefined();
    expect(mockClassify).not.toHaveBeenCalled();
  });

  it('5. protect evenings for family → clarification, no evening default', async () => {
    const { intent: r } = await mapVoiceUtteranceToIntent('protect evenings for family', {
      userId: UID,
      timezone: TZ,
    });
    expect(r.intent).toBe('RESOLVE_MANUAL');
    expect((r.params as { reason?: string }).reason).toBe('vague_protect_timing');
    expect(mockClassify).not.toHaveBeenCalled();
  });

  it('6. block weekdays 7pm–7:30pm for four weeks called Breathing → PROTECT_BLOCK exact times', async () => {
    mockClassify.mockResolvedValue({
      intent: 'PROTECT_BLOCK',
      confidence: 0.95,
      params: {
        label: 'Breathing',
        startTime: '19:00',
        endTime: '19:30',
        daysOfWeek: [1, 2, 3, 4, 5],
        rangeEnd: DateTime.now().setZone(TZ).plus({ weeks: 4 }).toISODate()!,
      },
      mappingMethod: 'direct',
      rawUtterance: 'block weekdays 7pm to 7:30pm for four weeks called Breathing',
    });
    const { intent: r } = await mapVoiceUtteranceToIntent(
      'block weekdays 7pm to 7:30pm for four weeks called Breathing',
      { userId: UID, timezone: TZ }
    );
    expect(r.intent).toBe('PROTECT_BLOCK');
    expect((r.params as { label?: string }).label).toBe('Breathing');
    expect((r.params as { startTime?: string }).startTime).toBe('19:00');
    expect((r.params as { endTime?: string }).endTime).toBe('19:30');
    const expectedUntil = DateTime.now().setZone(TZ).plus({ weeks: 4 }).toISODate()!;
    expect((r.params as { rangeEnd?: string }).rangeEnd).toBe(expectedUntil);
    expect(mockClassify).toHaveBeenCalled();
  });

  it('7. tell me a joke → WARM_REDIRECT, no calendar execution path', async () => {
    mockIsCalendar.mockReturnValue(false);
    const { intent: r } = await mapVoiceUtteranceToIntent('tell me a joke', {
      userId: UID,
      timezone: TZ,
    });
    expect(r.intent).toBe('WARM_REDIRECT');
    expect(mockClassify).not.toHaveBeenCalled();
  });

  it('8. destructive ambiguous request → RESOLVE_MANUAL confirmation path', async () => {
    const { intent: r } = await mapVoiceUtteranceToIntent('delete everything on my calendar', {
      userId: UID,
      timezone: TZ,
    });
    expect(r.intent).toBe('RESOLVE_MANUAL');
    expect((r.params as { reason?: string }).reason).toBe('unbounded_delete');
    expect(mockClassify).not.toHaveBeenCalled();
  });

  it('9. malformed Haiku JSON → validator safe fallback', () => {
    const r = validateHaikuJsonString('book something vague', '{ not json');
    expect(r.intent).toBe('RESOLVE_MANUAL');
    expect((r.params as { reason?: string }).reason).toBe('haiku_mapper_invalid_output');
  });

  it('10. invented Haiku top-level field → stripped / safe fallback', () => {
    const r = validateHaikuMapperOutput('schedule lunch with bob@x.com', {
      intent: 'NOT_A_REAL_INTENT',
      confidence: 0.99,
      params: {},
      evilBackdoor: true,
    } as any);
    expect(r.intent).toBe('RESOLVE_MANUAL');
    expect((r.params as { reason?: string }).reason).toBe('haiku_invalid_intent');
  });

  it('10b. Haiku PROTECT_BLOCK with fabricated times on vague utterance → clarify', () => {
    const r = validateHaikuMapperOutput('block tomorrow morning', {
      intent: 'PROTECT_BLOCK',
      confidence: 0.95,
      params: {
        label: 'Morning',
        startTime: '09:00',
        endTime: '12:00',
        daysOfWeek: [1, 2, 3, 4, 5],
        rangeEnd: '2026-06-01',
      },
    });
    expect(r.intent).toBe('RESOLVE_MANUAL');
    expect((r.params as { reason?: string }).reason).toBe('vague_protect_timing');
  });

  it('Haiku path: incomplete PROTECT_BLOCK from classifier → resolve after finalize', async () => {
    mockClassify.mockResolvedValue({
      intent: 'PROTECT_BLOCK',
      confidence: 0.92,
      params: {},
      mappingMethod: 'direct',
    });
    const { intent: r } = await mapVoiceUtteranceToIntent('some vague protect from haiku only', {
      userId: UID,
      timezone: TZ,
    });
    expect(r.intent).toBe('RESOLVE_MANUAL');
    expect((r.params as { reason?: string }).reason).toBe('protect_block_incomplete');
    expect(mockClassify).toHaveBeenCalled();
  });
});
