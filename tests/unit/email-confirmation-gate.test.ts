/**
 * Email confirmation voice gate — yes / no / spell paths and intent merging.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ParsedIntentSchema } from '../../src/core/adts.js';

const pendingStore = vi.hoisted(() => ({
  value: null as {
    email: string;
    originalIntent: string;
    originalParams: Record<string, unknown>;
    originalUtterance: string;
  } | null,
}));

const usageLog = vi.hoisted(() => [] as { type: string; meta: Record<string, unknown> }[]);

vi.mock('../../src/db/conversation-context.js', () => ({
  getPendingEmailConfirmation: vi.fn(async () => pendingStore.value),
  savePendingEmailConfirmation: vi.fn(async (_userId: string, data: typeof pendingStore.value) => {
    pendingStore.value = data;
  }),
  clearPendingEmailConfirmation: vi.fn(async () => {
    pendingStore.value = null;
  }),
}));

vi.mock('../../src/db/usage_events.js', () => ({
  recordUsageEvent: vi.fn(async (_userId: string, eventType: string, metadata: Record<string, unknown> = {}) => {
    usageLog.push({ type: eventType, meta: metadata });
  }),
}));

import {
  handleEmailConfirmationGate,
  intentNeedsEmailConfirmation,
  collectEmailsFromIntent,
} from '../../src/core/email-confirmation.js';

const USER = 'user-1111-1111-4111-8111-111111111111';

function intent(over: Partial<ReturnType<typeof ParsedIntentSchema.parse>> = {}) {
  return ParsedIntentSchema.parse({
    intent: 'CREATE_EVENT',
    confidence: 0.85,
    params: { participants: ['alex@example.com'] },
    mappingMethod: 'direct',
    rawUtterance: 'Schedule with alex@example.com',
    ...over,
  });
}

describe('handleEmailConfirmationGate', () => {
  beforeEach(() => {
    pendingStore.value = null;
    usageLog.length = 0;
    vi.clearAllMocks();
  });

  describe('new confirmation prompt', () => {
    it('prompts for voice when intent needs email confirmation', async () => {
      const result = await handleEmailConfirmationGate(intent(), USER, null, 'voice');
      expect(result.proceed).toBe(false);
      if (!result.proceed) {
        expect(result.result.messageToUser).toMatch(/alex@example.com/i);
        expect(result.result.messageToUser).toMatch(/yes, no, or spell/i);
      }
      expect(pendingStore.value?.email).toBe('alex@example.com');
    });

    it('skips gate for text without @ in utterance', async () => {
      const parsed = intent({ rawUtterance: 'Schedule a meeting tomorrow' });
      const result = await handleEmailConfirmationGate(parsed, USER, null, 'text');
      expect(result.proceed).toBe(true);
    });

    it('skips gate when intent does not need confirmation', async () => {
      const parsed = intent({ intent: 'QUERY_CALENDAR', params: {} });
      const result = await handleEmailConfirmationGate(parsed, USER, null, 'voice');
      expect(result.proceed).toBe(true);
    });
  });

  describe('pending — yes', () => {
    beforeEach(() => {
      pendingStore.value = {
        email: 'alex@example.com',
        originalIntent: 'CREATE_EVENT',
        originalParams: { participants: ['alex@example.com'] },
        originalUtterance: 'Schedule with alex@example.com',
      };
    });

    it('accepts yes and merges confirmed email into params', async () => {
      const result = await handleEmailConfirmationGate(
        intent({ rawUtterance: 'yes that is correct' }),
        USER,
        null,
        'voice',
      );
      expect(result.proceed).toBe(true);
      if (result.proceed) {
        expect(result.parsed.params.participants).toEqual(['alex@example.com']);
        expect(result.parsed.confidence).toBeGreaterThanOrEqual(0.9);
      }
      expect(pendingStore.value).toBeNull();
      expect(usageLog).toContainEqual({
        type: 'email_confirm_accepted',
        meta: { email: 'alex@example.com' },
      });
    });

    it('accepts yeah/yep/confirm variants', async () => {
      for (const u of ['yeah', 'yep', 'confirm', 'okay']) {
        pendingStore.value = {
          email: 'a@b.com',
          originalIntent: 'OFFER_SPECIFIC',
          originalParams: { recipientEmail: 'a@b.com' },
          originalUtterance: 'offer to a@b.com',
        };
        const r = await handleEmailConfirmationGate(intent({ rawUtterance: u }), USER, null, 'voice');
        expect(r.proceed).toBe(true);
      }
    });
  });

  describe('pending — no / spell', () => {
    beforeEach(() => {
      pendingStore.value = {
        email: 'wrong@example.com',
        originalIntent: 'INVITE_PLATFORM',
        originalParams: { inviteeEmail: 'wrong@example.com' },
        originalUtterance: 'invite wrong@example.com',
      };
    });

    it('rejects on no and asks user to spell email', async () => {
      const result = await handleEmailConfirmationGate(intent({ rawUtterance: 'no that is wrong' }), USER, null, 'voice');
      expect(result.proceed).toBe(false);
      if (!result.proceed) {
        expect(result.result.messageToUser).toMatch(/spell out the email/i);
      }
      expect(usageLog).toContainEqual({
        type: 'email_confirm_rejected',
        meta: { email: 'wrong@example.com' },
      });
    });

    it('rejects when user asks to spell', async () => {
      const result = await handleEmailConfirmationGate(intent({ rawUtterance: 'let me spell it' }), USER, null, 'voice');
      expect(result.proceed).toBe(false);
      if (!result.proceed) expect(result.result.success).toBe(false);
    });

    it('updates pending email when spelled out', async () => {
      const result = await handleEmailConfirmationGate(
        intent({ rawUtterance: 'jane at example dot com' }),
        USER,
        null,
        'voice',
      );
      expect(result.proceed).toBe(false);
      if (!result.proceed) {
        expect(result.result.messageToUser).toMatch(/jane@example.com/i);
      }
      expect(pendingStore.value?.email).toBe('jane@example.com');
    });
  });

  describe('pending — ambiguous reply', () => {
    it('re-prompts when utterance is neither yes nor no nor spell', async () => {
      pendingStore.value = {
        email: 'x@y.com',
        originalIntent: 'MODIFY_EVENT',
        originalParams: { addInvitees: ['x@y.com'] },
        originalUtterance: 'add x@y.com',
      };
      const result = await handleEmailConfirmationGate(intent({ rawUtterance: 'maybe tomorrow' }), USER, null, 'voice');
      expect(result.proceed).toBe(false);
      if (!result.proceed) {
        expect(result.result.messageToUser).toMatch(/x@y.com/i);
        expect(result.result.messageToUser).toMatch(/yes, no, or spell/i);
      }
    });
  });

  describe('intent detection helpers', () => {
    it('OFFER_SPECIFIC with recipient needs confirmation', () => {
      const p = intent({
        intent: 'OFFER_SPECIFIC',
        params: { recipientEmail: 'r@example.com' },
        rawUtterance: 'offer times to r@example.com',
      });
      expect(intentNeedsEmailConfirmation(p)).toBe(true);
      expect(collectEmailsFromIntent(p)).toContain('r@example.com');
    });

    it('MODIFY_EVENT with addInvitees needs confirmation', () => {
      const p = intent({
        intent: 'MODIFY_EVENT',
        params: { addInvitees: ['new@example.com'] },
        rawUtterance: 'add new@example.com',
      });
      expect(intentNeedsEmailConfirmation(p)).toBe(true);
    });

    it('CREATE_EVENT without emails skips confirmation', () => {
      const p = intent({ params: {}, rawUtterance: 'block focus time' });
      expect(intentNeedsEmailConfirmation(p)).toBe(false);
    });
  });
});
