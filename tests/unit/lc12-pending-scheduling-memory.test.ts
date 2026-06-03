import { describe, it, expect, beforeEach } from 'vitest';
import {
  _resetPendingIntentStoreForTests,
  storePendingSchedulingWindowClarification,
  tryCompletePendingIntent,
} from '../../src/core/pending-intent-memory.js';
import { ParsedIntentSchema } from '../../src/core/adts.js';

const UID = '5bf20398-930a-4afc-8460-7668d7423916';

describe('LC12 pending scheduling memory', () => {
  beforeEach(() => {
    _resetPendingIntentStoreForTests();
  });

  it('merges follow-up clock window into original SCHEDULING_LINK utterance', async () => {
    const draft = ParsedIntentSchema.parse({
      intent: 'SCHEDULING_LINK',
      rawUtterance: 'Find time with kanth.miriyala@gmail.com next week',
      confidence: 0.9,
      params: {
        inviteeEmail: 'kanth.miriyala@gmail.com',
        parsedSchedulingDateRange: { start: '2026-05-25', end: '2026-05-31' },
        schedulingUnsupportedConstraints: [],
        schedulingDefaultSearchWindow: true,
      },
      mappingMethod: 'direct',
    });
    await storePendingSchedulingWindowClarification(UID, draft);
    const completed = await tryCompletePendingIntent(UID, 'yes, 9am to 5pm', 'America/Chicago');
    expect(completed?.intent).toBe('SCHEDULING_LINK');
    expect(completed?.rawUtterance).toBe('Find time with kanth.miriyala@gmail.com next week');
    expect((completed?.params as { windowStartHourLocal?: number }).windowStartHourLocal).toBe(9);
    expect((completed?.params as { windowEndHourLocal?: number }).windowEndHourLocal).toBe(17);
  });
});
