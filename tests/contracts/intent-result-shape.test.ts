import { describe, it, expect } from 'vitest';
import { IntentResultSchema, IntentEnum } from '../../src/core/adts.js';

const intents = IntentEnum.options.filter((i) => i !== 'RESOLVE_MANUAL');

describe('IntentResult shape contract', () => {
  for (const intent of intents) {
    it(`${intent} success shape validates`, () => {
      const result = IntentResultSchema.parse({
        intent,
        success: true,
        requiresConfirmation: false,
        messageToUser: 'done',
        schemaVersion: 1,
      });
      expect(result.intent).toBe(intent);
      expect(typeof result.requiresConfirmation).toBe('boolean');
    });

    it(`${intent} failure shape validates`, () => {
      const result = IntentResultSchema.parse({
        intent,
        success: false,
        requiresConfirmation: false,
        messageToUser: 'failed',
        schemaVersion: 1,
      });
      expect(result.success).toBe(false);
    });
  }
});
