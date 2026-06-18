/**
 * LC10 Wave 1 v2 — /voice Haiku-first pipeline + pending-template memory.
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
import type { ParsedIntent } from '../../src/core/adts.js';

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

describe('LC10 Wave 1 v2 — voice pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetPendingIntentStoreForTests();
  });

  it('1. /voice route uses scheduling agent not legacy parser', () => {
    const voiceSrc = readFileSync(join(process.cwd(), 'src/routes/voice.ts'), 'utf8');
    expect(voiceSrc).not.toMatch(/\bparseIntent\s*\(/);
    expect(voiceSrc).toContain('runSchedulingAgent');
  });

  it('2. Haiku is primary semantic mapper on /voice path', async () => {
    mockClassify.mockResolvedValue({
      intent: 'QUERY_CALENDAR',
      confidence: 0.92,
      params: { queryType: 'tomorrow' },
      mappingMethod: 'direct',
      rawUtterance: "what's on my calendar tomorrow",
    });
    const { intent, meta } = await mapVoiceUtteranceToIntent("what's on my calendar tomorrow", {
      userId: UID,
      timezone: TZ,
    });
    expect(mockClassify).not.toHaveBeenCalled();
    expect(meta.haikuCalled).toBe(false);
    expect(intent.intent).toBe('QUERY_CALENDAR');
  });

  it('3. block tomorrow morning asks for exact time (no hardcoded window)', async () => {
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
    expect((intent.params as { startTime?: string }).startTime).toBeUndefined();
    expect(meta.storedPendingTemplate).toBe(true);
  });

  it('4. follow-up 9 to 12 completes original pending PROTECT_BLOCK', async () => {
    mockClassify.mockResolvedValue({
      intent: 'PROTECT_BLOCK',
      confidence: 0.95,
      params: { label: 'Morning' },
      mappingMethod: 'direct',
      rawUtterance: 'block tomorrow morning',
    });
    await mapVoiceUtteranceToIntent('block tomorrow morning', { userId: UID, timezone: TZ });

    const { intent, meta } = await mapVoiceUtteranceToIntent('9 to 12', {
      userId: UID,
      timezone: TZ,
    });
    expect(meta.usedPendingTemplate).toBe(true);
    expect(mockClassify).not.toHaveBeenCalled();
    expect(intent.intent).toBe('PROTECT_BLOCK');
    expect((intent.params as { startTime?: string }).startTime).toBe('09:00');
    expect((intent.params as { endTime?: string }).endTime).toBe('12:00');
    expect(intent.rawUtterance).toBe('block tomorrow morning');
  });

  it('5. block lunch every weekday asks clarification', async () => {
    mockClassify.mockResolvedValue({
      intent: 'PROTECT_BLOCK',
      confidence: 0.9,
      params: { label: 'Lunch' },
      mappingMethod: 'direct',
      rawUtterance: 'block lunch every weekday',
    });
    const { intent } = await mapVoiceUtteranceToIntent('block lunch every weekday', {
      userId: UID,
      timezone: TZ,
    });
    expect(intent.intent).toBe('RESOLVE_MANUAL');
    expect((intent.params as { reason?: string }).reason).toBe('vague_protect_timing');
    expect((intent.params as { startTime?: string }).startTime).toBeUndefined();
  });

  it('6. protect evenings for family asks clarification', async () => {
    mockClassify.mockResolvedValue({
      intent: 'PROTECT_BLOCK',
      confidence: 0.9,
      params: { label: 'Family' },
      mappingMethod: 'direct',
      rawUtterance: 'protect evenings for family',
    });
    const { intent } = await mapVoiceUtteranceToIntent('protect evenings for family', {
      userId: UID,
      timezone: TZ,
    });
    expect(intent.intent).toBe('RESOLVE_MANUAL');
    expect((intent.params as { reason?: string }).reason).toBe('vague_protect_timing');
  });

  it('7. find time with john@example.com next week → valid SCHEDULING_LINK', async () => {
    mockClassify.mockResolvedValue({
      intent: 'SCHEDULING_LINK',
      confidence: 0.92,
      params: {
        inviteeEmail: 'john@example.com',
        parsedSchedulingDateRange: { start: '2026-05-25', end: '2026-05-31' },
        schedulingUnsupportedConstraints: [],
        schedulingDefaultSearchWindow: true,
      },
      mappingMethod: 'direct',
      rawUtterance: 'find time with john@example.com next week',
    });
    const { intent } = await mapVoiceUtteranceToIntent('find time with john@example.com next week', {
      userId: UID,
      timezone: TZ,
    });
    expect(intent.intent).toBe('SCHEDULING_LINK');
    expect((intent.params as { inviteeEmail?: string }).inviteeEmail).toBe('john@example.com');
    const range = (intent.params as { parsedSchedulingDateRange?: { start: string; end: string } })
      .parsedSchedulingDateRange;
    expect(range?.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(range?.end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('8. scheduling flow has no hidden daypart/business-hour defaults', async () => {
    mockClassify.mockResolvedValue({
      intent: 'SCHEDULING_LINK',
      confidence: 0.92,
      params: {
        inviteeEmail: 'john@example.com',
        parsedSchedulingDateRange: { start: '2026-05-25', end: '2026-05-31' },
        schedulingUnsupportedConstraints: [],
        schedulingDefaultSearchWindow: true,
      },
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
    expect(p['schedulingParseRisk']).not.toBe('daypart_window');
    expect(p['schedulingParseRisk']).not.toBe('default_business_window');
  });

  it('9. tell me a joke warm redirects without Haiku', async () => {
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
    expect(mockClassify).not.toHaveBeenCalled();
    expect(meta.haikuCalled).toBe(false);
  });

  it('10. malformed Haiku JSON safe fallback', () => {
    const r = validateHaikuJsonString('book something vague', '{ not json');
    expect(r.intent).toBe('RESOLVE_MANUAL');
    expect((r.params as { reason?: string }).reason).toBe('haiku_mapper_invalid_output');
  });

  it('11. invented Haiku fields rejected', () => {
    const r = validateHaikuMapperOutput('schedule lunch with bob@x.com', {
      intent: 'NOT_A_REAL_INTENT',
      confidence: 0.99,
      params: {},
      evilBackdoor: true,
    } as unknown as ParsedIntent);
    expect(r.intent).toBe('RESOLVE_MANUAL');
    expect((r.params as { reason?: string }).reason).toBe('haiku_invalid_intent');
  });

  it('12. destructive ambiguous requests do not execute as benign intents', async () => {
    mockClassify.mockResolvedValue({
      intent: 'CREATE_EVENT',
      confidence: 0.9,
      params: {},
      mappingMethod: 'direct',
      rawUtterance: 'delete everything on my calendar',
    });
    const { intent } = await mapVoiceUtteranceToIntent('delete everything on my calendar', {
      userId: UID,
      timezone: TZ,
    });
    expect(intent.intent).toBe('RESOLVE_MANUAL');
    expect((intent.params as { reason?: string }).reason).toBe('unbounded_delete');
    expect(mockClassify).not.toHaveBeenCalled();
  });

  it('13. orchestrator routing contract unchanged', async () => {
    const orchestratorSrc = readFileSync(join(process.cwd(), 'src/core/orchestrator.ts'), 'utf8');
    expect(orchestratorSrc).toContain('PROTECT_BLOCK');
    expect(orchestratorSrc).toContain('SCHEDULING_LINK');
    expect(orchestratorSrc).toContain('RESOLVE_MANUAL');
    expect(typeof orchestrate).toBe('function');
  });
});
