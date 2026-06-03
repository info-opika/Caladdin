import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import {
  buildHaikuDateAnchor,
  formatHaikuDateAnchorBlock,
} from '../../src/core/haiku-date-anchor.js';
import { buildHaikuMapperSystemPrompt } from '../../src/core/haiku-intent-mapper.js';

const TZ = 'America/Chicago';

describe('Haiku date anchor', () => {
  const anchorMs = DateTime.fromISO('2026-05-19T10:00:00', { zone: TZ }).toMillis();

  it('anchors to supplied wall clock in user timezone', () => {
    const a = buildHaikuDateAnchor(TZ, anchorMs);
    expect(a.isoDate).toBe('2026-05-19');
    expect(a.timezone).toBe(TZ);
    expect(a.isoTimestamp).toContain('2026-05-19');
  });

  it('prompt includes anchor block (no stale training-year instruction)', () => {
    const prompt = buildHaikuMapperSystemPrompt(TZ, anchorMs);
    expect(prompt).toContain('CURRENT DATE ANCHOR');
    expect(prompt).toContain('2026-05-19');
    expect(prompt).toContain('relative to the timestamp above');
    expect(prompt).not.toMatch(/2025|2024/);
  });

  it('format block lists today/tomorrow/next week guidance', () => {
    const block = formatHaikuDateAnchorBlock(buildHaikuDateAnchor(TZ, anchorMs));
    expect(block).toMatch(/today.*tomorrow.*next week/i);
    expect(block).toMatch(/next Monday/i);
    expect(block).toMatch(/in two weeks/i);
  });
});
