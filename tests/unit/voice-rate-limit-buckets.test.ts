import { describe, expect, it } from 'vitest';
import { classifyVoiceRateLimitBucket } from '../../src/core/voice-rate-limit-bucket.js';
import { config } from '../../src/config.js';

describe('classifyVoiceRateLimitBucket', () => {
  it('classifies calendar queries as read', () => {
    expect(classifyVoiceRateLimitBucket("what's on my calendar today")).toBe('read');
    expect(classifyVoiceRateLimitBucket('am I free at 3pm')).toBe('read');
  });

  it('classifies scheduling link utterances as scheduling', () => {
    expect(
      classifyVoiceRateLimitBucket(
        'Find time with invitee.smoke@example.com tomorrow between 2pm and 6pm for a 30 minute meeting'
      )
    ).toBe('scheduling');
  });

  it('classifies create/modify as mutation', () => {
    expect(
      classifyVoiceRateLimitBucket('create a 30 minute meeting with alex@example.com tomorrow at 2pm')
    ).toBe('mutation');
    expect(classifyVoiceRateLimitBucket('move my 3pm call to Friday morning')).toBe('mutation');
  });

  it('uses mutation for empty utterance (audio path)', () => {
    expect(classifyVoiceRateLimitBucket('')).toBe('mutation');
    expect(classifyVoiceRateLimitBucket(undefined)).toBe('mutation');
  });
});

describe('voice rate limit thresholds', () => {
  it('allows a full smoke sequence within the shared /voice budget', () => {
    const smokeSteps = [
      { bucket: 'read' as const, count: 3 },
      { bucket: 'mutation' as const, count: 2 },
      { bucket: 'scheduling' as const, count: 1 },
    ];
    const total = smokeSteps.reduce((n, s) => n + s.count, 0);
    expect(total).toBeLessThanOrEqual(config.voiceHttpRateLimitMax);
  });
});
