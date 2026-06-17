import { describe, it, expect, beforeEach } from 'vitest';
import {
  checkContextualSetup,
  fieldsRequiredForIntent,
  parseSetupAnswer,
} from '../../src/core/contextual-setup.js';
import { migratePolicy, type ParsedIntent, type UserPolicyProfile } from '../../src/core/adts.js';
import {
  _setSetupPendingStorageForTests,
  savePendingSetupIntent,
  getPendingSetupIntent,
  clearPendingSetupIntent,
} from '../../src/db/conversation-context.js';

const BASE_POLICY: UserPolicyProfile = migratePolicy({
  timezone: 'America/Chicago',
  workingHoursStart: '09:00',
  workingHoursEnd: '18:00',
  defaultMeetingLengthMinutes: 30,
  setupFieldsAnswered: [],
});

const OFFER_PARSED: ParsedIntent = {
  intent: 'OFFER_SPECIFIC',
  confidence: 0.9,
  rawUtterance: 'invite alex@example.com to meet',
  mappingMethod: 'direct',
  params: { recipientEmail: 'alex@example.com' },
};

describe('contextual setup', () => {
  beforeEach(() => {
    _setSetupPendingStorageForTests(true);
  });

  it('returns timezone as first missing field for OFFER_SPECIFIC', () => {
    const gap = checkContextualSetup(BASE_POLICY, 'OFFER_SPECIFIC', OFFER_PARSED);
    expect(gap?.field).toBe('timezone');
    expect(gap?.question).toMatch(/timezone/i);
  });

  it('skips answered fields and asks for workingHours next', () => {
    const policy: UserPolicyProfile = {
      ...BASE_POLICY,
      setupFieldsAnswered: ['timezone'],
    };
    const gap = checkContextualSetup(policy, 'OFFER_SPECIFIC', OFFER_PARSED);
    expect(gap?.field).toBe('workingHours');
  });

  it('does not ask defaultMeetingLength when duration is already parsed', () => {
    const policy: UserPolicyProfile = {
      ...BASE_POLICY,
      setupFieldsAnswered: ['timezone', 'workingHours', 'meetingTimePreference'],
    };
    const withDuration: ParsedIntent = {
      ...OFFER_PARSED,
      params: { ...OFFER_PARSED.params, durationMinutes: 45 },
    };
    expect(fieldsRequiredForIntent('OFFER_SPECIFIC', withDuration)).not.toContain('defaultMeetingLength');
    expect(checkContextualSetup(policy, 'OFFER_SPECIFIC', withDuration)).toBeNull();
  });

  it('returns null when all required setup fields are answered', () => {
    const policy: UserPolicyProfile = {
      ...BASE_POLICY,
      setupFieldsAnswered: ['timezone', 'workingHours', 'meetingTimePreference', 'defaultMeetingLength'],
    };
    expect(checkContextualSetup(policy, 'OFFER_SPECIFIC', OFFER_PARSED)).toBeNull();
  });

  it('parses working hours from natural language', () => {
    const answer = parseSetupAnswer('workingHours', '9am to 6pm');
    expect(answer?.workingHoursStart).toBe('09:00');
    expect(answer?.workingHoursEnd).toBe('18:00');
  });

  it('stores and retrieves pending setup intent', async () => {
    const userId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    await savePendingSetupIntent(userId, {
      setupField: 'timezone',
      deferredParsed: OFFER_PARSED,
      originalUtterance: OFFER_PARSED.rawUtterance,
    });
    const pending = await getPendingSetupIntent(userId);
    expect(pending?.setupField).toBe('timezone');
    expect(pending?.deferredParsed.intent).toBe('OFFER_SPECIFIC');
    await clearPendingSetupIntent(userId);
    expect(await getPendingSetupIntent(userId)).toBeNull();
  });
});
