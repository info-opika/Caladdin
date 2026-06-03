import { describe, expect, it } from 'vitest';
import { tryMatchQueryCalendar, normalizeCalendarQueryText } from '../../src/core/query-prefilter.js';

describe('query-prefilter canonical + phrase families', () => {
  it('maps full-sentence tomorrow query', () => {
    expect(tryMatchQueryCalendar('What is on my calendar tomorrow?')).toEqual({
      queryType: 'tomorrow',
      day: 'tomorrow',
    });
    expect(normalizeCalendarQueryText('What is on my calendar tomorrow?')).toBe('what is on my calendar tomorrow');
  });

  it('maps “what about tomorrow” follow-up', () => {
    expect(tryMatchQueryCalendar('What about tomorrow?')).toEqual({ queryType: 'tomorrow', day: 'tomorrow' });
  });

  it('maps schedule / next / availability variants from gauntlet list', () => {
    expect(tryMatchQueryCalendar("Tomorrow's schedule?")).toEqual({ queryType: 'tomorrow', day: 'tomorrow' });
    expect(tryMatchQueryCalendar('next meeting')).toEqual({ queryType: 'next' });
    expect(tryMatchQueryCalendar('what have i got today?')).toEqual({ queryType: 'today', day: 'today' });
    expect(tryMatchQueryCalendar('do I have anything at 3pm?')).toEqual({
      queryType: 'availability',
      timeText: '3pm',
    });
  });

  describe('NEXT family', () => {
    it.each([
      'when is my next meeting',
      "when's my next meeting",
      'when is my next event',
      "when's my next event",
      'when do i meet next',
      'what is my next appointment',
      'next call',
      'next event',
      'next appointment',
    ])('%s → next', (u) => {
      expect(tryMatchQueryCalendar(u)).toEqual({ queryType: 'next' });
    });
  });

  describe('TODAY family', () => {
    it.each([
      'what is on my calendar today',
      'what do i have today',
      'today schedule',
      "today's schedule",
      'meetings today',
      'events today',
      'appointments today',
    ])('%s → today', (u) => {
      expect(tryMatchQueryCalendar(u)).toEqual({ queryType: 'today', day: 'today' });
    });
  });

  describe('TOMORROW family', () => {
    it.each([
      'what is on my calendar tomorrow',
      'what do i have tomorrow',
      'tomorrow schedule',
      "tomorrow's schedule",
      'meetings tomorrow',
      'events tomorrow',
      'appointments tomorrow',
      'what about tomorrow',
      "What's on tomorrow?",
      'um so like whats on my cal tomorrow',
      'like do i have anything tomorrow or',
    ])('%s → tomorrow', (u) => {
      expect(tryMatchQueryCalendar(u)).toEqual({ queryType: 'tomorrow', day: 'tomorrow' });
    });
  });

  describe('AVAILABILITY family', () => {
    it.each([
      ['am i free at 3pm', '3pm'],
      ['am i available at 3', '3'],
      ['do i have anything at 3pm', '3pm'],
      ['anything at 10:30am', '10:30am'],
    ])('%s → availability with time', (u, t) => {
      expect(tryMatchQueryCalendar(u)).toEqual({ queryType: 'availability', timeText: t });
    });
    
    // P0 REGRESSION TEST: Time-of-day phrases should be deterministic (not LLM-dependent)
    // Founder self-test found: "Am I free tomorrow afternoon?" hit AI classifier outage error
    it.each([
      ['Am I free tomorrow afternoon?', 'afternoon'],
      ['am i free tomorrow morning', 'morning'],
      ['am i available tomorrow evening', 'evening'],
      ['am i open tomorrow night', 'night'],
      ['do i have anything tomorrow afternoon', 'afternoon'],
      ['anything tomorrow morning', 'morning'],
    ])('%s → availability with time-of-day phrase', (u, t) => {
      const result = tryMatchQueryCalendar(u);
      const exp: Record<string, unknown> = { queryType: 'availability', timeText: t };
      if (/\btomorrow\b/i.test(u)) exp.availabilityDay = 'tomorrow';
      else if (/\btoday\b/i.test(u)) exp.availabilityDay = 'today';
      expect(result).toMatchObject(exp);
      expect(result).not.toBeNull(); // MUST NOT fall through to LLM classifier
    });
  });

  describe('WEEK_RANGE meetings listing', () => {
    it('what meetings … next week with attendee email → week_range', () => {
      expect(
        tryMatchQueryCalendar('What meetings do I have with priya@example.com next week'),
      ).toEqual({
        queryType: 'week_range',
        weekRangeKind: 'next_week',
        attendeeEmailSubstring: 'priya@example.com',
      });
    });
  });

  describe('false positives — must not match QUERY_CALENDAR via prefilter', () => {
    it.each(['what is the capital of France', "what is tomorrow's weather", 'write me a poem about tomorrow', 'next president', 'next football game'])(
      '%s',
      (u) => {
        expect(tryMatchQueryCalendar(u)).toBeNull();
      }
    );
  });
});
