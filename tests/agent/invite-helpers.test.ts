import { describe, it, expect } from 'vitest';
import {
  normalizeSessionToken,
  normalizeSlotPairs,
  buildOfferedSlotsFromInviteInput,
} from '../../src/agent/tools/invite-helpers.js';

describe('invite helpers', () => {
  it('normalizeSessionToken extracts token from scheduling URL', () => {
    expect(
      normalizeSessionToken('http://localhost:3001/s/a71b77b7-d3a9-4073-9719-52a1bb7efa0c'),
    ).toBe('a71b77b7-d3a9-4073-9719-52a1bb7efa0c');
    expect(normalizeSessionToken('tok-invite')).toBe('tok-invite');
  });

  it('normalizeSlotPairs derives end from duration when omitted', () => {
    const result = normalizeSlotPairs([{ start: '2026-06-18T09:00:00-05:00', end: '' }], {
      defaultDurationMinutes: 30,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.slots[0]?.end).toBe('2026-06-18T09:30:00.000-05:00');
    }
  });

  it('buildOfferedSlotsFromInviteInput maps proposedSlots', () => {
    const slots = [
      { start: '2026-06-18T09:00:00-05:00', end: '2026-06-18T09:30:00-05:00' },
      { start: '2026-06-18T09:30:00-05:00', end: '2026-06-18T10:00:00-05:00' },
    ];
    const built = buildOfferedSlotsFromInviteInput({ proposedSlots: slots }, 30);
    expect(built.ok).toBe(true);
    if (built.ok && built.slots) {
      expect(built.slots).toHaveLength(2);
    }
  });
});
