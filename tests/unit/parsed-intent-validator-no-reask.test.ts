import { describe, it, expect } from 'vitest';
import {
  stripKnownFieldsFromMissingFields,
  validateHaikuMapperOutput,
} from '../../src/core/parsed-intent-validator.js';

describe('parsed-intent-validator no-re-ask', () => {
  it('stripKnownFieldsFromMissingFields removes fields already in params', () => {
    const stripped = stripKnownFieldsFromMissingFields(
      ['startTime', 'label', 'durationMinutes'],
      { startTime: '09:00', label: 'Focus', durationMinutes: 30 },
    );
    expect(stripped).toEqual([]);
  });

  it('validateHaikuMapperOutput proceeds when only stripped missing fields remain', () => {
    const result = validateHaikuMapperOutput('block focus 9-10 weekdays', {
      intent: 'PROTECT_BLOCK',
      confidence: 0.9,
      params: {
        label: 'Focus',
        startTime: '09:00',
        endTime: '10:00',
        missingFields: ['label', 'startTime'],
      },
      mappingMethod: 'direct',
    });
    expect(result.intent).toBe('PROTECT_BLOCK');
    expect(result.confidence).toBeGreaterThanOrEqual(0.85);
  });
});
