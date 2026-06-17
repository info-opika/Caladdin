import { describe, it, expect, vi, beforeEach } from 'vitest';

const st = vi.hoisted(() => ({
  events: [] as Record<string, unknown>[],
}));

function rowFromInsert(row: Record<string, unknown>) {
  return {
    id: `ev-${st.events.length + 1}`,
    user_id: row.user_id,
    title: row.title,
    start_at: row.start_at,
    end_at: row.end_at,
    tier: row.tier ?? 2,
    status: row.status ?? 'confirmed',
    participants: row.participants ?? [],
    is_recurring: row.is_recurring ?? false,
    gcal_event_id: row.gcal_event_id ?? null,
    proposed_for_session: row.proposed_for_session ?? null,
    description: row.description ?? null,
  };
}

vi.mock('../../../src/db/client.js', () => ({
  getSupabase: () => ({
    from: (table: string) => {
      if (table !== 'events') throw new Error(table);
      return {
        select: () => ({
          eq: (col: string, val: string) => {
            const chain = {
              neq: (_c: string, status: string) => ({
                gte: (_c2: string, start: string) => ({
                  lte: (_c3: string, end: string) => ({
                    order: async () => ({
                      data: st.events.filter((e) => {
                        if (col === 'user_id' && e.user_id !== val) return false;
                        if (e.status === status) return false;
                        if (start && (e.start_at as string) < start) return false;
                        if (end && (e.start_at as string) > end) return false;
                        return true;
                      }),
                      error: null,
                    }),
                  }),
                }),
                order: async () => ({
                  data: st.events.filter((e) => e.user_id === val && e.status !== status),
                  error: null,
                }),
              }),
              maybeSingle: async () => ({
                data: st.events.find((e) => e[col] === val) ?? null,
                error: null,
              }),
            };
            return chain;
          },
        }),
        insert: (row: Record<string, unknown>) => ({
          select: () => ({
            single: async () => {
              const saved = rowFromInsert(row);
              st.events.push(saved);
              return { data: saved, error: null };
            },
          }),
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: (_c: string, id: string) => ({
            select: () => ({
              single: async () => {
                const row = st.events.find((e) => e.id === id);
                if (row) Object.assign(row, patch);
                return { data: row, error: null };
              },
            }),
          }),
        }),
      };
    },
  }),
}));

import {
  listEvents,
  insertEvent,
  updateEvent,
  getEventById,
  cancelEvent,
  dedupeCalendarEvents,
} from '../../../src/db/events.js';
import type { CalendarEvent } from '../../../src/core/adts.js';

describe('events db', () => {
  beforeEach(() => {
    st.events = [];
  });

  it('insertEvent and getEventById round-trip', async () => {
    const ev = await insertEvent('user-1', {
      title: 'Sync',
      start: '2026-06-10T15:00:00.000Z',
      end: '2026-06-10T16:00:00.000Z',
      tier: 2,
      status: 'confirmed',
    });
    expect(ev.title).toBe('Sync');
    const loaded = await getEventById(ev.id);
    expect(loaded?.userId).toBe('user-1');
  });

  it('listEvents excludes cancelled', async () => {
    await insertEvent('user-1', {
      title: 'Active',
      start: '2026-06-10T15:00:00.000Z',
      end: '2026-06-10T16:00:00.000Z',
      status: 'confirmed',
    });
    const cancelled = await insertEvent('user-1', {
      title: 'Gone',
      start: '2026-06-11T15:00:00.000Z',
      end: '2026-06-11T16:00:00.000Z',
      status: 'cancelled',
    });
    await cancelEvent(cancelled.id);
    const rows = await listEvents('user-1');
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Active');
  });

  it('updateEvent patches fields', async () => {
    const ev = await insertEvent('user-1', {
      title: 'Old',
      start: '2026-06-10T15:00:00.000Z',
      end: '2026-06-10T16:00:00.000Z',
    });
    const updated = await updateEvent(ev.id, { title: 'New title' });
    expect(updated.title).toBe('New title');
  });
});

describe('dedupeCalendarEvents', () => {
  const base: CalendarEvent = {
    id: '1',
    userId: 'u1',
    title: 'Vibecoding',
    start: '2026-06-17T01:30:00.000Z',
    end: '2026-06-17T02:00:00.000Z',
    participants: [],
    tier: 2,
    isRecurring: false,
    status: 'confirmed',
    gcalEventId: 'gcal-abc',
    proposedForSession: null,
    description: null,
  };

  it('collapses rows with the same gcal_event_id', () => {
    const dupes = [
      base,
      { ...base, id: '2' },
      { ...base, id: '3' },
    ];
    expect(dedupeCalendarEvents(dupes)).toHaveLength(1);
    expect(dedupeCalendarEvents(dupes)[0].id).toBe('1');
  });

  it('collapses rows with same slot when no gcal id', () => {
    const noGcal = { ...base, gcalEventId: null };
    const dupes = [noGcal, { ...noGcal, id: '2' }];
    expect(dedupeCalendarEvents(dupes)).toHaveLength(1);
  });

  it('keeps distinct events', () => {
    const other = { ...base, id: '2', gcalEventId: 'gcal-xyz', title: 'Other' };
    expect(dedupeCalendarEvents([base, other])).toHaveLength(2);
  });
});
