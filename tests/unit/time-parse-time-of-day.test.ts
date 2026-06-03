import { describe, expect, it } from 'vitest';
import { parseClockTimeToken } from '../../src/core/time-parse.js';

describe('parseClockTimeToken - time-of-day phrases (P0 regression test)', () => {
  // P0 REGRESSION TEST: Time-of-day phrases should be deterministic (not LLM-dependent)
  // Founder self-test found: "Am I free tomorrow afternoon?" hit AI classifier outage error
  // These phrases MUST be recognized as valid time tokens, not fall through to LLM
  
  it('recognizes "morning" as 9am', () => {
    expect(parseClockTimeToken('morning')).toEqual({ hour: 9, minute: 0 });
  });
  
  it('recognizes "afternoon" as 2pm', () => {
    expect(parseClockTimeToken('afternoon')).toEqual({ hour: 14, minute: 0 });
  });
  
  it('recognizes "evening" as 6pm', () => {
    expect(parseClockTimeToken('evening')).toEqual({ hour: 18, minute: 0 });
  });
  
  it('recognizes "night" as 8pm', () => {
    expect(parseClockTimeToken('night')).toEqual({ hour: 20, minute: 0 });
  });
  
  it('still handles specific clock times', () => {
    expect(parseClockTimeToken('3pm')).toEqual({ hour: 15, minute: 0 });
    expect(parseClockTimeToken('10:30am')).toEqual({ hour: 10, minute: 30 });
    expect(parseClockTimeToken('3')).toEqual({ hour: 15, minute: 0 });
  });
});
