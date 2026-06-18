import { describe, it, expect } from 'vitest';
import { tryAssembleRecurringBlockFromTurns } from '../../src/agent/recurring-block-assembler.js';

describe('tryAssembleRecurringBlockFromTurns', () => {
  it('assembles daily meditation block from multi-turn voice follow-ups', () => {
    const turns = [
      'Block 30 minutes for meditation',
      'Everyday from 7 AM Texas time to 7:30 AM Texas time',
      'Meditation Time',
    ];
    const assembled = tryAssembleRecurringBlockFromTurns(turns, 'America/Chicago');
    expect(assembled).not.toBeNull();
    expect(assembled?.label).toBe('Meditation Time');
    expect(assembled?.startTime).toBe('07:00');
    expect(assembled?.endTime).toBe('07:30');
    expect(assembled?.daysOfWeek).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('assembles when recurring keyword arrives on a later turn', () => {
    const turns = [
      'Block 30 minutes for meditation',
      'Everyday from 7 AM to 7:30 AM',
      'Meditation Time',
      'Recurring every day',
    ];
    const assembled = tryAssembleRecurringBlockFromTurns(turns, 'America/Chicago');
    expect(assembled).not.toBeNull();
    expect(assembled?.label).toBe('Meditation Time');
    expect(assembled?.daysOfWeek).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('returns null when times are missing', () => {
    const assembled = tryAssembleRecurringBlockFromTurns(
      ['Block time for meditation', 'Meditation Time'],
      'America/Chicago',
    );
    expect(assembled).toBeNull();
  });
});
