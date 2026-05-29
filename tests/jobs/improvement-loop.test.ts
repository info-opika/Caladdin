import { describe, it, expect } from 'vitest';
import { groupFailuresByIntent, filterByDateRange, renderImprovementReport } from '../../src/jobs/improvement-loop.js';

describe('improvement loop pure functions', () => {
  it('groups failures by intent', () => {
    const failures = [
      { attempted_intent: 'FLUSH_RANGE', raw_utterance: 'a', created_at: new Date().toISOString() },
      { attempted_intent: 'FLUSH_RANGE', raw_utterance: 'b', created_at: new Date().toISOString() },
      { attempted_intent: null, raw_utterance: 'c', created_at: new Date().toISOString() },
    ];
    const grouped = groupFailuresByIntent(failures);
    expect(grouped.get('FLUSH_RANGE')?.length).toBe(2);
    expect(grouped.get(null)?.length).toBe(1);
  });

  it('renders markdown report', () => {
    const grouped = new Map([['QUERY_CALENDAR', [{ raw_utterance: 'test', failure_reason: 'low conf', created_at: new Date().toISOString() }]]]);
    const md = renderImprovementReport(grouped, new Date(), new Date());
    expect(md).toContain('Improvement Report');
    expect(md).toContain('QUERY_CALENDAR');
  });
});
