import { describe, it, expect } from 'vitest';
import {
  markSlotsWithBusyConflicts,
  buildInviteeConflictWarnings,
} from '../../src/services/invitee_slot_conflicts.js';

describe('invitee_slot_conflicts', () => {
  it('marks inviteeConflict when slot overlaps invitee busy time', () => {
    const slots = [
      { start: '2026-06-02T10:00:00-05:00', end: '2026-06-02T11:00:00-05:00' },
      { start: '2026-06-02T14:00:00-05:00', end: '2026-06-02T15:00:00-05:00' },
    ];
    const inviteeBusy = [
      { start: '2026-06-02T09:30:00-05:00', end: '2026-06-02T10:30:00-05:00' },
    ];

    const marked = markSlotsWithBusyConflicts(slots, [], inviteeBusy, 'America/Chicago');
    expect(marked[0]?.inviteeConflict).toBe(true);
    expect(marked[1]?.inviteeConflict).toBe(false);
  });

  it('buildInviteeConflictWarnings describes conflicting slots', () => {
    const warning = buildInviteeConflictWarnings(
      'jane@co.com',
      [
        {
          start: '2026-06-02T14:00:00-05:00',
          end: '2026-06-02T15:00:00-05:00',
          inviteeConflict: true,
          hostConflict: false,
        },
      ],
      'America/Chicago',
    );
    expect(warning).toContain('jane@co.com is on Caladdin');
    expect(warning).toMatch(/2:00 PM/i);
    expect(warning).toContain('conflicts with their calendar');
  });
});
