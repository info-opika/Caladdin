import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveModifyEventTarget, hydrateModifyIntentContract } from '../../src/core/modify-event-target.js';
import type { CalendarEvent, ParsedIntent } from '../../src/core/adts.js';

const TZ = 'America/Chicago';

function ev(p: Partial<CalendarEvent> & Pick<CalendarEvent, 'id' | 'title' | 'start' | 'end'>): CalendarEvent {
  return {
    tier: 2,
    status: 'confirmed',
    participants: [],
    isRecurring: false,
    ...p,
  };
}

describe('resolveModifyEventTarget', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-26T12:00:00.000-05:00'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renameFrom: single match', () => {
    const intent: ParsedIntent = {
      intent: 'MODIFY_EVENT',
      confidence: 0.9,
      rawUtterance: 'rename lunch to investor call',
      params: { renameFrom: 'lunch', newTitle: 'investor call' },
      mappingMethod: 'direct',
    };
    const events = [
      ev({ id: 'a', title: 'Team lunch', start: '2026-04-28T17:00:00-05:00', end: '2026-04-28T18:00:00-05:00' }),
    ];
    const r = resolveModifyEventTarget(hydrateModifyIntentContract(intent), events, TZ);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.target.id).toBe('a');
      expect(r.paramPatch.newTitle).toBe('investor call');
    }
  });

  it('renameFrom: ambiguous', () => {
    const intent: ParsedIntent = {
      intent: 'MODIFY_EVENT',
      confidence: 0.9,
      rawUtterance: 'rename lunch to X',
      params: { renameFrom: 'lunch', newTitle: 'X' },
      mappingMethod: 'direct',
    };
    const events = [
      ev({ id: 'a', title: 'lunch with Sam', start: '2026-04-28T12:00:00-05:00', end: '2026-04-28T13:00:00-05:00' }),
      ev({ id: 'b', title: 'lunch with Pat', start: '2026-04-29T12:00:00-05:00', end: '2026-04-29T13:00:00-05:00' }),
    ];
    const r = resolveModifyEventTarget(hydrateModifyIntentContract(intent), events, TZ);
    expect(r.kind).toBe('ambiguous');
  });

  it('delete: matches 3pm tomorrow uniquely', () => {
    const intent: ParsedIntent = {
      intent: 'MODIFY_EVENT',
      confidence: 0.88,
      rawUtterance: 'cancel my 3pm meeting tomorrow',
      params: { operation: 'delete' },
      mappingMethod: 'direct',
    };
    const events = [
      ev({ id: 'x', title: 'Sync', start: '2026-04-27T15:00:00-05:00', end: '2026-04-27T15:30:00-05:00' }),
      ev({ id: 'y', title: 'Other', start: '2026-04-28T15:00:00-05:00', end: '2026-04-28T15:30:00-05:00' }),
    ];
    const r = resolveModifyEventTarget(hydrateModifyIntentContract(intent), events, TZ);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(r.target.id).toBe('x');
  });

  it('duration: resolve by 3pm + meeting', () => {
    const intent: ParsedIntent = {
      intent: 'MODIFY_EVENT',
      confidence: 0.9,
      rawUtterance: 'make my 3pm meeting 30 minutes',
      params: { newDurationMinutes: 30 },
      mappingMethod: 'direct',
    };
    const events = [
      ev({ id: 'm', title: 'Client meeting', start: '2026-04-27T15:00:00-05:00', end: '2026-04-27T16:00:00-05:00' }),
    ];
    const r = resolveModifyEventTarget(hydrateModifyIntentContract(intent), events, TZ);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.target.id).toBe('m');
      expect(r.paramPatch.newDurationMinutes).toBe(30);
    }
  });
});
