/**
 * LC10 Wave 1 v3 — Haiku-only /voice semantic path (required product tests).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mapVoiceUtteranceToIntent } from '../../src/core/voice-intent-pipeline.js';
import {
  validateHaikuMapperOutput,
  validateHaikuJsonString,
} from '../../src/core/parsed-intent-validator.js';
import { _resetPendingIntentStoreForTests } from '../../src/core/pending-intent-memory.js';
import { orchestrate } from '../../src/core/orchestrator.js';

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

const SCHED_RANGE = {
  parsedSchedulingDateRange: { start: '2026-05-25', end: '2026-05-31' },
  schedulingUnsupportedConstraints: [] as string[],
  schedulingDefaultSearchWindow: true,
};

describe('LC10 Wave 1 v3 — voice pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetPendingIntentStoreForTests();
  });

  it('1. /voice uses Haiku ADT parser as semantic authority', async () => {
    mockClassify.mockResolvedValue({
      intent: 'QUERY_CALENDAR',
      confidence: 0.92,
      params: { queryType: 'tomorrow' },
      mappingMethod: 'direct',
      rawUtterance: "what's on tomorrow",
    });
    const { meta } = await mapVoiceUtteranceToIntent("what's on tomorrow", {
      userId: UID,
      timezone: TZ,
    });
    expect(mockClassify).not.toHaveBeenCalled();
    expect(meta.haikuCalled).toBe(false);
  });

  it('2. old parser brain is not imported by voice route', () => {
    const voiceSrc = readFileSync(join(process.cwd(), 'src/routes/voice.ts'), 'utf8');
    expect(voiceSrc).not.toMatch(/\bparseIntent\s*\(/);
    expect(voiceSrc).not.toMatch(/from ['"].*\/parser\.js['"]/);
    expect(voiceSrc).toContain('mapVoiceUtteranceToIntent');
  });

  it('3. parseIntent is not the /voice semantic path', () => {
    const pipelineSrc = readFileSync(join(process.cwd(), 'src/core/voice-intent-pipeline.ts'), 'utf8');
    expect(pipelineSrc).not.toMatch(/\bparseIntent\s*\(/);
    expect(pipelineSrc).not.toMatch(/from ['"].*\/parser\.js['"]/);
  });

  it('4. block tomorrow morning asks exact time', async () => {
    mockClassify.mockResolvedValue({
      intent: 'PROTECT_BLOCK',
      confidence: 0.95,
      params: {
        label: 'Morning',
        startTime: '09:00',
        endTime: '12:00',
        daysOfWeek: [1, 2, 3, 4, 5],
        rangeEnd: '2026-06-01',
      },
      mappingMethod: 'direct',
      rawUtterance: 'block tomorrow morning',
    });
    const { intent, meta } = await mapVoiceUtteranceToIntent('block tomorrow morning', {
      userId: UID,
      timezone: TZ,
    });
    expect(intent.intent).toBe('RESOLVE_MANUAL');
    expect((intent.params as { reason?: string }).reason).toBe('vague_protect_timing');
    expect(meta.storedPendingTemplate).toBe(true);
    expect(mockClassify).not.toHaveBeenCalled();
  });

  it('5. follow-up 9 to 12 completes pending intent', async () => {
    await mapVoiceUtteranceToIntent('block tomorrow morning', { userId: UID, timezone: TZ });
    const { intent, meta } = await mapVoiceUtteranceToIntent('9 to 12', {
      userId: UID,
      timezone: TZ,
    });
    expect(meta.usedPendingTemplate).toBe(true);
    expect(intent.intent).toBe('PROTECT_BLOCK');
    expect((intent.params as { startTime?: string }).startTime).toBe('09:00');
    expect((intent.params as { endTime?: string }).endTime).toBe('12:00');
    expect(intent.rawUtterance).toBe('block tomorrow morning');
  });

  it('6. block lunch every weekday asks clarification', async () => {
    mockClassify.mockResolvedValue({
      intent: 'PROTECT_BLOCK',
      confidence: 0.88,
      params: {
        label: 'Lunch',
        daysOfWeek: [1, 2, 3, 4, 5],
        rangeEnd: '2026-08-01',
        missingFields: ['startTime', 'endTime'],
      },
      mappingMethod: 'direct',
      rawUtterance: 'block lunch every weekday',
    });
    const { intent } = await mapVoiceUtteranceToIntent('block lunch every weekday', {
      userId: UID,
      timezone: TZ,
    });
    expect(intent.intent).toBe('RESOLVE_MANUAL');
    expect(['vague_protect_timing', 'haiku_missing_fields']).toContain(
      (intent.params as { reason?: string }).reason
    );
  });

  it('7. follow-up 1 to 2 completes lunch weekday pending as 1pm–2pm', async () => {
    mockClassify.mockResolvedValue({
      intent: 'PROTECT_BLOCK',
      confidence: 0.88,
      params: {
        label: 'Lunch',
        daysOfWeek: [1, 2, 3, 4, 5],
        rangeEnd: '2026-08-01',
        missingFields: ['startTime', 'endTime'],
      },
      mappingMethod: 'direct',
      rawUtterance: 'block lunch every weekday',
    });
    await mapVoiceUtteranceToIntent('block lunch every weekday', { userId: UID, timezone: TZ });
    const { intent } = await mapVoiceUtteranceToIntent('1 to 2', { userId: UID, timezone: TZ });
    expect(intent.intent).toBe('PROTECT_BLOCK');
    expect((intent.params as { startTime?: string }).startTime).toBe('13:00');
    expect((intent.params as { endTime?: string }).endTime).toBe('14:00');
  });

  it('8. protect evenings for family asks clarification', async () => {
    const { intent } = await mapVoiceUtteranceToIntent('protect evenings for family', {
      userId: UID,
      timezone: TZ,
    });
    expect(intent.intent).toBe('RESOLVE_MANUAL');
    expect((intent.params as { reason?: string }).reason).toBe('vague_protect_timing');
    expect(mockClassify).not.toHaveBeenCalled();
  });

  it('9. follow-up 7 to 8 completes family evenings pending as 7pm–8pm', async () => {
    await mapVoiceUtteranceToIntent('protect evenings for family', {
      userId: UID,
      timezone: TZ,
    });
    const { intent } = await mapVoiceUtteranceToIntent('7 to 8', { userId: UID, timezone: TZ });
    expect(intent.intent).toBe('PROTECT_BLOCK');
    expect((intent.params as { startTime?: string }).startTime).toBe('19:00');
    expect((intent.params as { endTime?: string }).endTime).toBe('20:00');
  });

  it('10. explicit weekday protect works without hidden defaults', async () => {
    mockClassify.mockResolvedValue({
      intent: 'PROTECT_BLOCK',
      confidence: 0.95,
      params: {
        label: 'Breathing',
        startTime: '19:00',
        endTime: '19:30',
        daysOfWeek: [1, 2, 3, 4, 5],
        rangeEnd: '2026-06-16',
        startDate: '2026-05-19',
      },
      mappingMethod: 'direct',
      rawUtterance:
        'block weekdays 7pm to 7:30pm for four weeks called Breathing',
    });
    const { intent } = await mapVoiceUtteranceToIntent(
      'block weekdays 7pm to 7:30pm for four weeks called Breathing',
      { userId: UID, timezone: TZ }
    );
    expect(intent.intent).toBe('PROTECT_BLOCK');
    expect((intent.params as { label?: string }).label).toBe('Breathing');
    expect((intent.params as { startTime?: string }).startTime).toBe('19:00');
  });

  it('11. find time with john@example.com next week → SCHEDULING_LINK', async () => {
    mockClassify.mockResolvedValue({
      intent: 'SCHEDULING_LINK',
      confidence: 0.92,
      params: { inviteeEmail: 'john@example.com', ...SCHED_RANGE },
      mappingMethod: 'direct',
      rawUtterance: 'find time with john@example.com next week',
    });
    const { intent } = await mapVoiceUtteranceToIntent('find time with john@example.com next week', {
      userId: UID,
      timezone: TZ,
    });
    expect(intent.intent).toBe('SCHEDULING_LINK');
    expect((intent.params as { inviteeEmail?: string }).inviteeEmail).toBe('john@example.com');
  });

  it('12. tell me a joke → WARM_REDIRECT via Haiku (no keyword pre-gate)', async () => {
    mockClassify.mockResolvedValue({
      intent: 'WARM_REDIRECT',
      confidence: 0.95,
      params: {},
      mappingMethod: 'direct',
      rawUtterance: 'tell me a joke',
    });
    const { intent, meta } = await mapVoiceUtteranceToIntent('tell me a joke', {
      userId: UID,
      timezone: TZ,
    });
    expect(intent.intent).toBe('WARM_REDIRECT');
    expect(meta.haikuCalled).toBe(false);
  });

  it('13. delete all meetings does not execute as benign intent', async () => {
    const { intent } = await mapVoiceUtteranceToIntent('delete all my meetings', {
      userId: UID,
      timezone: TZ,
    });
    expect(intent.intent).toBe('RESOLVE_MANUAL');
    expect((intent.params as { reason?: string }).reason).toBe('unbounded_delete');
    expect(mockClassify).not.toHaveBeenCalled();
  });

  it('14. malformed Haiku JSON safe fallback', () => {
    const r = validateHaikuJsonString('book something vague', '{ not json');
    expect(r.intent).toBe('RESOLVE_MANUAL');
    expect((r.params as { reason?: string }).reason).toBe('haiku_mapper_invalid_output');
  });

  it('15. invented Haiku fields rejected', () => {
    const r = validateHaikuMapperOutput('x', {
      intent: 'NOT_A_REAL_INTENT',
      confidence: 0.99,
      params: {},
    } as never);
    expect(r.intent).toBe('RESOLVE_MANUAL');
    expect((r.params as { reason?: string }).reason).toBe('haiku_invalid_intent');
  });

  it('16. no hardcoded vague-time defaults in voice pipeline source', () => {
    const src = readFileSync(join(process.cwd(), 'src/core/voice-intent-pipeline.ts'), 'utf8');
    expect(src).not.toMatch(/09:00.*12:00/);
    expect(src).not.toContain('inferImplicitSchedulingSearchWindowHours');
    expect(src).not.toContain('enrichSchedulingParamsFromUtterance');
  });

  it('17. scheduling link path preserved (no hidden daypart window)', async () => {
    mockClassify.mockResolvedValue({
      intent: 'SCHEDULING_LINK',
      confidence: 0.92,
      params: { inviteeEmail: 'john@example.com', ...SCHED_RANGE },
      mappingMethod: 'direct',
      rawUtterance: 'find time with john@example.com next week',
    });
    const { intent } = await mapVoiceUtteranceToIntent('find time with john@example.com next week', {
      userId: UID,
      timezone: TZ,
    });
    const p = intent.params as Record<string, unknown>;
    expect(p['windowStartHourLocal']).toBeUndefined();
    expect(p['windowEndHourLocal']).toBeUndefined();
    expect(typeof orchestrate).toBe('function');
  });

  it('18. block weekday from/to with timezone words → PROTECT_BLOCK (not calendar dump)', async () => {
    const { intent } = await mapVoiceUtteranceToIntent(
      'Block Tuesday Morning from 9 AM Texas Time to 9:30 AM Texas Time',
      { userId: UID, timezone: TZ },
    );
    expect(intent.intent).toBe('PROTECT_BLOCK');
    expect((intent.params as { startTime?: string }).startTime).toBe('09:00');
    expect((intent.params as { endTime?: string }).endTime).toBe('09:30');
    expect(mockClassify).not.toHaveBeenCalled();
  });

  it('19. vague "block a personal time" stores protect pending without Haiku', async () => {
    const { intent } = await mapVoiceUtteranceToIntent('Block a personal time', {
      userId: UID,
      timezone: TZ,
    });
    expect(intent.intent).toBe('RESOLVE_MANUAL');
    expect((intent.params as { reason?: string }).reason).toBe('vague_protect_timing');
    expect(mockClassify).not.toHaveBeenCalled();
  });
});
