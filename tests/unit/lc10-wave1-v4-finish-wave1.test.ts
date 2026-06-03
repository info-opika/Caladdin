/**
 * LC10 Wave 1 v4 — finish gate tests (Haiku-first /voice, legacy quarantine, safety-only destructive).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { mapVoiceUtteranceToIntent } from '../../src/core/voice-intent-pipeline.js';
import { _resetPendingIntentStoreForTests } from '../../src/core/pending-intent-memory.js';
import { buildHaikuMapperSystemPrompt } from '../../src/core/haiku-intent-mapper.js';
import { prefilterDestructive } from '../../src/core/destructive-prefilter.js';

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
const ANCHOR_MS = Date.parse('2026-05-19T15:00:00-05:00');

describe('LC10 Wave 1 v4 — finish wave 1', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetPendingIntentStoreForTests();
  });

  it('1. P0 voice route imports pipeline not legacy parser', () => {
    const voiceSrc = readFileSync(join(process.cwd(), 'src/routes/voice.ts'), 'utf8');
    expect(voiceSrc).toContain('mapVoiceUtteranceToIntent');
    expect(voiceSrc).not.toMatch(/from ['"].*\/parser\.js['"]/);
    expect(voiceSrc).not.toMatch(/\bparseIntent\s*\(/);
  });

  it('2. legacy parser brain deleted — no parser.ts or parser-legacy.ts', () => {
    const coreDir = join(process.cwd(), 'src/core');
    expect(() => readFileSync(join(coreDir, 'parser.ts'), 'utf8')).toThrow();
    expect(() => readFileSync(join(coreDir, 'parser-legacy.ts'), 'utf8')).toThrow();
    expect(() => readFileSync(join(coreDir, 'parser-preflight.ts'), 'utf8')).toThrow();
  });

  it('3. no P0 route imports legacy parser brain', () => {
    const grep = execSync(
      `grep -r "from ['\\\"].*parser\\.js" src/routes src/middleware 2>/dev/null || true`,
      { encoding: 'utf8', cwd: process.cwd() }
    );
    expect(grep.trim()).toBe('');
  });

  it('4. Haiku prompt anchors relative dates to current clock', () => {
    const prompt = buildHaikuMapperSystemPrompt(TZ, ANCHOR_MS);
    expect(prompt).toContain('2026-05-19');
    expect(prompt).toContain('CURRENT DATE ANCHOR');
  });

  it('5. deterministic query bypasses Haiku', async () => {
    const { intent, meta } = await mapVoiceUtteranceToIntent("What's on my calendar today?", {
      userId: UID,
      timezone: TZ,
    });
    expect(intent.intent).toBe('QUERY_CALENDAR');
    expect(meta.haikuCalled).toBe(false);
    expect(mockClassify).not.toHaveBeenCalled();
  });

  it('6. destructive prefilter is safety-only (no FLUSH_RANGE before Haiku)', () => {
    const d = prefilterDestructive('clear next week');
    expect(d.use).toBe('intent');
    if (d.use === 'intent') {
      expect(d.intent.intent).toBe('RESOLVE_MANUAL');
    }
  });

  it('7. scheduling link without when clarifies after Haiku', async () => {
    mockClassify.mockResolvedValue({
      intent: 'SCHEDULING_LINK',
      confidence: 0.9,
      params: { inviteeEmail: 'support@app.com' },
      mappingMethod: 'direct',
      rawUtterance: 'send scheduling link to support@app.com',
    });
    const { intent } = await mapVoiceUtteranceToIntent('send scheduling link to support@app.com', {
      userId: UID,
      timezone: TZ,
    });
    expect(intent.intent).toBe('RESOLVE_MANUAL');
    expect((intent.params as { reason?: string }).reason).toBe('scheduling_when_needed');
  });

  it('8. multi-turn protect: morning then 9 to 12', async () => {
    await mapVoiceUtteranceToIntent('block tomorrow morning', { userId: UID, timezone: TZ });
    const { intent, meta } = await mapVoiceUtteranceToIntent('9 to 12', { userId: UID, timezone: TZ });
    expect(intent.intent).toBe('PROTECT_BLOCK');
    expect(meta.usedPendingTemplate).toBe(true);
    expect(mockClassify).not.toHaveBeenCalled();
  });

  it('9. lunch then 1 to 2 completes pending as 1pm–2pm (not 1am)', async () => {
    await mapVoiceUtteranceToIntent('block lunch every weekday', { userId: UID, timezone: TZ });
    const { intent } = await mapVoiceUtteranceToIntent('1 to 2', { userId: UID, timezone: TZ });
    expect(intent.intent).toBe('PROTECT_BLOCK');
    const p = intent.params as { startTime?: string; endTime?: string };
    expect(p.startTime).toBe('13:00');
    expect(p.endTime).toBe('14:00');
  });

  it('10. scheduling link with explicit range preserved', async () => {
    mockClassify.mockResolvedValue({
      intent: 'SCHEDULING_LINK',
      confidence: 0.92,
      params: {
        inviteeEmail: 'john@example.com',
        parsedSchedulingDateRange: { start: '2026-05-25', end: '2026-05-31' },
        schedulingUnsupportedConstraints: [],
      },
      mappingMethod: 'direct',
      rawUtterance: 'find time with john@example.com next week',
    });
    const { intent } = await mapVoiceUtteranceToIntent('find time with john@example.com next week', {
      userId: UID,
      timezone: TZ,
    });
    expect(intent.intent).toBe('SCHEDULING_LINK');
    const pr = intent.params as { parsedSchedulingDateRange?: { start: string } };
    expect(pr.parsedSchedulingDateRange?.start).toBe('2026-05-25');
  });
});
