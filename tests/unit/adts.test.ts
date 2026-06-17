import { describe, it, expect } from 'vitest';
import {
  ParsedIntentSchema,
  IntentResultSchema,
  IntentEnum,
  migratePolicy,
  DESTRUCTIVE_VERB_RE,
} from '../../src/core/adts.js';

describe('ADTs', () => {
  it('parses all 11 intent values', () => {
    for (const intent of IntentEnum.options) {
      expect(IntentEnum.parse(intent)).toBe(intent);
    }
  });

  it('migrates policy without schemaVersion', () => {
    const p = migratePolicy({});
    expect(p.schemaVersion).toBe(1);
    expect(p.protectedBlocks).toEqual([]);
  });

  it('v3: defaults defaultMeetingLengthMinutes and setupFieldsAnswered', () => {
    const p = migratePolicy({});
    expect(p.defaultMeetingLengthMinutes).toBe(30);
    expect(p.setupFieldsAnswered).toEqual([]);
  });

  it('v3: maps chronotype evening to meetingTimePreference afternoon', () => {
    const p = migratePolicy({ chronotype: 'evening' });
    expect(p.meetingTimePreference).toBe('afternoon');
  });

  it('validates IntentResult', () => {
    const r = IntentResultSchema.parse({
      intent: 'QUERY_CALENDAR',
      success: true,
      requiresConfirmation: false,
      messageToUser: 'ok',
    });
    expect(r.intent).toBe('QUERY_CALENDAR');
  });

  it('destructive regex matches cancel', () => {
    expect(DESTRUCTIVE_VERB_RE.test('cancel tomorrow')).toBe(true);
  });

  it('ParsedIntent accepts destructive flag', () => {
    const p = ParsedIntentSchema.parse({
      intent: 'FLUSH_RANGE',
      confidence: 0.9,
      params: {},
      mappingMethod: 'direct',
      rawUtterance: 'cancel tomorrow',
      _destructivePreFilter: true,
    });
    expect(p._destructivePreFilter).toBe(true);
  });
});
