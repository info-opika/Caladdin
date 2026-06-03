import { describe, expect, it } from 'vitest';
import {
  tryMatchSchedulingLink,
  schedulingLinkNeedsLatestEndClarification,
  extractSchedulingSearchWindowHours,
} from '../../src/core/scheduling-link-prefilter.js';

describe('tryMatchSchedulingLink', () => {
  it('matches find time with real-domain email (live regression)', () => {
    const r = tryMatchSchedulingLink('Find time with kanth.miriyala@gmail.com next week 9am to 5pm');
    expect(r).toEqual({ inviteeEmail: 'kanth.miriyala@gmail.com' });
  });

  it('returns null for calendar queries that mention an email', () => {
    expect(
      tryMatchSchedulingLink('what meetings do I have with kanth.miriyala@gmail.com next week')
    ).toBeNull();
  });

  it('returns null with no @ address', () => {
    expect(tryMatchSchedulingLink('find time with Raj next week')).toBeNull();
  });
});

describe('extractSchedulingSearchWindowHours', () => {
  it('parses 9am to 5pm and between 2pm and 6pm', () => {
    expect(extractSchedulingSearchWindowHours('next week 9am to 5pm')).toEqual({
      startHour: 9,
      endHour: 17,
    });
    expect(extractSchedulingSearchWindowHours('between 2pm and 6pm')).toEqual({
      startHour: 14,
      endHour: 18,
    });
  });

  it('parses 12 noon end bound (LC12 follow-up)', () => {
    expect(extractSchedulingSearchWindowHours('mornings 9 am to 12 noon')).toEqual({
      startHour: 9,
      endHour: 12,
    });
    expect(extractSchedulingSearchWindowHours('yes, 9am to 5pm')).toEqual({
      startHour: 9,
      endHour: 17,
    });
  });
});

describe('scheduling window clarification (P0)', () => {
  it('needs clarification for vague daypart OR without numeric window', () => {
    expect(
      schedulingLinkNeedsLatestEndClarification(
        'find time with guest1@example.test afternoon or evening next week'
      )
    ).toBe(true);
  });

  it('does not ask when explicit start–end window present', () => {
    expect(
      schedulingLinkNeedsLatestEndClarification(
        'find time with guest1@example.test afternoon or evening 9am to 5pm next week'
      )
    ).toBe(false);
  });
});
