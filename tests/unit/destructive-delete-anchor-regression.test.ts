import { describe, it, expect } from 'vitest';
import { prefilterDestructive } from '../../src/core/destructive-prefilter.js';

describe('prefilterDestructive — delete anchor (Bug family 10)', () => {
  it('bare "cancel tomorrow" → manual clarify', () => {
    expect(prefilterDestructive('Cancel tomorrow').use).toBe('manual');
  });

  it('delete with concrete event cue → Haiku semantic path (no pre-Haiku MODIFY_EVENT)', () => {
    const r = prefilterDestructive('Delete my 3pm dentist appointment');
    expect(r.use).toBe('none');
  });
});
