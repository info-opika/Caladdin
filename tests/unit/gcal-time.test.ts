import { describe, it, expect } from 'vitest';
import { normalizeGCalRange, parseOptionalIso } from '../../src/core/date-utils.js';

describe('gcal-time', () => {
  it('rejects empty LLM range strings', () => {
    const { timeMin, timeMax } = normalizeGCalRange('', '');
    expect(new Date(timeMax).getTime()).toBeGreaterThan(new Date(timeMin).getTime());
  });

  it('parses valid ISO', () => {
    expect(parseOptionalIso('2026-05-29T00:00:00.000Z')?.toISOString()).toBe('2026-05-29T00:00:00.000Z');
    expect(parseOptionalIso('')).toBeNull();
    expect(parseOptionalIso('not-a-date')).toBeNull();
  });
});
