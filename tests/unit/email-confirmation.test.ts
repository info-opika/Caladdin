import { describe, it, expect, vi, beforeEach } from 'vitest';
import { collectEmailsFromIntent, intentNeedsEmailConfirmation } from '../../src/core/email-confirmation.js';
import { ParsedIntentSchema } from '../../src/core/adts.js';

describe('email confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('detects emails on CREATE_EVENT', () => {
    const parsed = ParsedIntentSchema.parse({
      intent: 'CREATE_EVENT',
      confidence: 0.9,
      params: { participants: ['a@b.com'] },
      mappingMethod: 'direct',
      rawUtterance: 'Schedule meeting and invite a@b.com',
    });
    expect(intentNeedsEmailConfirmation(parsed)).toBe(true);
    expect(collectEmailsFromIntent(parsed)).toContain('a@b.com');
  });

  it('detects INVITE_PLATFORM emails', () => {
    const parsed = ParsedIntentSchema.parse({
      intent: 'INVITE_PLATFORM',
      confidence: 0.9,
      params: { inviteeEmail: 'x@y.com' },
      mappingMethod: 'direct',
      rawUtterance: 'Invite x@y.com to Caladdin',
    });
    expect(intentNeedsEmailConfirmation(parsed)).toBe(true);
  });
});
