import { describe, it, expect } from 'vitest';
import { prefilterDestructive } from '../../src/core/destructive-prefilter.js';

describe('prefilterDestructive (P0 safety-only)', () => {
  it('does not block neutral scheduling', () => {
    expect(prefilterDestructive('Schedule a meeting with Alex next Tuesday at 3pm').use).toBe('none');
  });

  it('cancel culture (phrase) is not a calendar cancel/delete', () => {
    expect(prefilterDestructive('I need a cancel culture article for class tomorrow').use).toBe('none');
  });

  it('delete dentist appointment tomorrow => Haiku path (no pre-Haiku MODIFY_EVENT)', () => {
    const d = prefilterDestructive('delete my dentist appointment tomorrow');
    expect(d.use).toBe('none');
  });

  it('cancel 3pm call => Haiku path', () => {
    const d = prefilterDestructive('cancel my 3pm call with Sam');
    expect(d.use).toBe('none');
  });

  it('remove lunch tomorrow => Haiku path', () => {
    const d = prefilterDestructive('remove lunch tomorrow');
    expect(d.use).toBe('none');
  });

  it('move 3pm call to Friday morning => Haiku path', () => {
    const d = prefilterDestructive('move my 3pm call to Friday morning');
    expect(d.use).toBe('none');
  });

  it('clear next week with exception => resolve manual', () => {
    const d = prefilterDestructive('clear next week except the investor call');
    expect(d.use).toBe('manual');
  });

  it('delete everything tomorrow => safety RESOLVE_MANUAL (not FLUSH_RANGE)', () => {
    const d = prefilterDestructive('delete everything tomorrow');
    expect(d.use).toBe('intent');
    if (d.use === 'intent') {
      expect(d.intent.intent).toBe('RESOLVE_MANUAL');
      expect((d.intent.params as { reason?: string }).reason).toBe('destructive_bulk_requires_confirmation');
    }
  });

  it('clear next week => safety RESOLVE_MANUAL bulk guard', () => {
    const d = prefilterDestructive('clear next week');
    expect(d.use).toBe('intent');
    if (d.use === 'intent') {
      expect(d.intent.intent).toBe('RESOLVE_MANUAL');
      expect((d.intent.params as { reason?: string }).reason).toBe('destructive_bulk_requires_confirmation');
    }
  });

  it('unbounded delete all => RESOLVE_MANUAL', () => {
    const d = prefilterDestructive('delete all my meetings');
    expect(d.use).toBe('intent');
    if (d.use === 'intent') {
      expect(d.intent.intent).toBe('RESOLVE_MANUAL');
      expect((d.intent.params as { reason?: string }).reason).toBe('unbounded_delete');
    }
  });
});
