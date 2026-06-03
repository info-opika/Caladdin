import { describe, expect, it } from 'vitest';
import { CALENDAR_USER_SIMULATOR_CORPUS } from '../fixtures/calendar-user-simulator-corpus.js';
import { assertCorpusMinimums, countByCategory, MIN_TOTAL_UTTERANCES } from '../fixtures/calendar-user-simulator-invariants.js';

describe('calendar user simulator corpus — size and quotas', () => {
  it(`has at least ${MIN_TOTAL_UTTERANCES} utterances and category / axis minimums`, () => {
    const { total, byCategory } = assertCorpusMinimums(CALENDAR_USER_SIMULATOR_CORPUS);
    expect(total).toBeGreaterThanOrEqual(MIN_TOTAL_UTTERANCES);
    expect(byCategory.calendar_query).toBeGreaterThanOrEqual(40);
    expect(byCategory.availability).toBeGreaterThanOrEqual(40);
    expect(byCategory.create_event).toBeGreaterThanOrEqual(40);
    expect(byCategory.move_reschedule).toBeGreaterThanOrEqual(40);
    expect(byCategory.cancel_delete).toBeGreaterThanOrEqual(40);
    expect(byCategory.bulk_risky).toBeGreaterThanOrEqual(30);
    expect(byCategory.scheduling_link).toBeGreaterThanOrEqual(40);
    expect(byCategory.protect_block).toBeGreaterThanOrEqual(30);
    expect(byCategory.ambiguous_calendar).toBeGreaterThanOrEqual(30);
    expect(byCategory.non_calendar).toBeGreaterThanOrEqual(30);
  });

  it('exposes stable category counts for PROGRESS reporting', () => {
    const by = countByCategory(CALENDAR_USER_SIMULATOR_CORPUS);
    expect(Object.values(by).reduce((a, b) => a + b, 0)).toBe(CALENDAR_USER_SIMULATOR_CORPUS.length);
  });
});
