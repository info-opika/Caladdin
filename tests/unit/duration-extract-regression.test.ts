import { describe, it, expect } from 'vitest';
import { extractDurationMinutes } from '../../src/core/scheduling-link-prefilter.js';

describe('extractDurationMinutes — finish-line literals', () => {
  it('parses 45 minutes', () => {
    expect(extractDurationMinutes('Need a 45 minute slot with client')).toBe(45);
  });
  it('parses 120 minutes', () => {
    expect(extractDurationMinutes('Block 120 minutes for training')).toBe(120);
  });
});
