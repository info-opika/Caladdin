/**
 * DB layer — conversation context frames (mocked Supabase).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const st = vi.hoisted(() => ({
  frames: [] as Array<{
    id: string;
    user_id: string;
    frame: Record<string, unknown>;
    expires_at: string;
    created_at: string;
  }>,
  nextId: 1,
}));

function rowsForUser(userId: string, onlyFuture = true) {
  const now = new Date().toISOString();
  return st.frames
    .filter((f) => f.user_id === userId && (!onlyFuture || f.expires_at > now))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

function eqChain(userId: string, onlyFuture: boolean) {
  const data = rowsForUser(userId, onlyFuture);
  const base = Promise.resolve({ data, error: null });
  return Object.assign(base, {
    gt: (_c2: string, now: string) => ({
      order: () => Promise.resolve({
        data: rowsForUser(userId).filter((f) => f.expires_at > now),
        error: null,
      }),
    }),
  });
}

vi.mock('../../../src/config.js', () => ({
  config: { conversationSessionMinutes: 10 },
}));

vi.mock('../../../src/db/client.js', () => ({
  getSupabase: () => ({
    from: (table: string) => {
      if (table !== 'pending_clarification_frames') throw new Error(table);
      return {
        delete: () => ({
          lt: async (_col: string, cutoff: string) => {
            st.frames = st.frames.filter((f) => f.expires_at >= cutoff);
            return { error: null };
          },
          eq: async (_col: string, id: string) => {
            st.frames = st.frames.filter((f) => f.id !== id);
            return { error: null };
          },
        }),
        select: (_cols?: string) => ({
          eq: (_col: string, userId: string) => eqChain(userId, false),
        }),
        insert: (row: Record<string, unknown>) => {
          st.frames.push({
            id: `frame-${st.nextId++}`,
            user_id: row.user_id as string,
            frame: row.frame as Record<string, unknown>,
            expires_at: row.expires_at as string,
            created_at: new Date().toISOString(),
          });
          return Promise.resolve({ error: null });
        },
      };
    },
  }),
}));

import {
  getConversationContext,
  saveConversationContext,
  recordLastEvent,
  getPendingEmailConfirmation,
  savePendingEmailConfirmation,
  clearPendingEmailConfirmation,
  savePendingClarification,
  expireConversationContexts,
} from '../../../src/db/conversation-context.js';

describe('conversation-context db', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const future = new Date(Date.now() + 3600_000).toISOString();

  beforeEach(() => {
    st.frames = [];
    st.nextId = 1;
  });

  it('returns null when no conversation frame exists', async () => {
    expect(await getConversationContext(userId)).toBeNull();
  });

  it('saves and reads conversation context', async () => {
    await saveConversationContext(userId, {
      lastIntent: 'CREATE_EVENT',
      lastUtterance: 'team sync tomorrow',
      lastEvent: { title: 'Team sync', gcalEventId: 'ev-1' },
    });
    const ctx = await getConversationContext(userId);
    expect(ctx?.lastIntent).toBe('CREATE_EVENT');
    expect(ctx?.lastEvent?.title).toBe('Team sync');
  });

  it('recordLastEvent delegates to saveConversationContext', async () => {
    await recordLastEvent(userId, 'MODIFY_EVENT', 'move it', { title: 'Standup' });
    const ctx = await getConversationContext(userId);
    expect(ctx?.lastIntent).toBe('MODIFY_EVENT');
    expect(ctx?.lastEvent?.title).toBe('Standup');
  });

  it('replaces prior conversation frame on save', async () => {
    await saveConversationContext(userId, { lastIntent: 'A', lastUtterance: 'a' });
    await saveConversationContext(userId, { lastIntent: 'B', lastUtterance: 'b' });
    const ctx = await getConversationContext(userId);
    expect(ctx?.lastIntent).toBe('B');
    expect(st.frames.filter((f) => (f.frame as { type?: string }).type === 'conversation')).toHaveLength(1);
  });

  it('pending email confirmation round-trip', async () => {
    st.frames.push({
      id: 'e1',
      user_id: userId,
      frame: {
        type: 'email_confirmation',
        email: 'guest@test.com',
        originalIntent: 'OFFER_SPECIFIC',
        originalParams: { recipientEmail: 'guest@test.com' },
        originalUtterance: 'send link',
      },
      expires_at: future,
      created_at: new Date().toISOString(),
    });
    const pending = await getPendingEmailConfirmation(userId);
    expect(pending?.email).toBe('guest@test.com');
    expect(pending?.originalIntent).toBe('OFFER_SPECIFIC');
  });

  it('savePendingEmailConfirmation clears prior email frames', async () => {
    await savePendingEmailConfirmation(userId, {
      email: 'a@test.com',
      originalIntent: 'CREATE_EVENT',
      originalParams: {},
    });
    await savePendingEmailConfirmation(userId, {
      email: 'b@test.com',
      originalIntent: 'MODIFY_EVENT',
      originalParams: {},
    });
    const pending = await getPendingEmailConfirmation(userId);
    expect(pending?.email).toBe('b@test.com');
  });

  it('clearPendingEmailConfirmation removes email frames only', async () => {
    await saveConversationContext(userId, { lastIntent: 'QUERY_CALENDAR', lastUtterance: 'today' });
    await savePendingEmailConfirmation(userId, {
      email: 'x@test.com',
      originalIntent: 'OFFER_SPECIFIC',
      originalParams: {},
    });
    await clearPendingEmailConfirmation(userId);
    expect(await getPendingEmailConfirmation(userId)).toBeNull();
    expect(await getConversationContext(userId)).not.toBeNull();
  });

  it('savePendingClarification inserts clarification frame', async () => {
    await savePendingClarification(userId, {
      pendingIntent: 'CREATE_EVENT',
      knownFields: { title: 'Lunch' },
      question: 'What time?',
    });
    const row = st.frames.find((f) => (f.frame as { type?: string }).type === 'clarification');
    expect(row?.frame).toMatchObject({ pendingIntent: 'CREATE_EVENT', question: 'What time?' });
  });

  it('expireConversationContexts deletes expired rows', async () => {
    st.frames.push({
      id: 'old',
      user_id: userId,
      frame: { type: 'conversation', lastIntent: 'UNDO' },
      expires_at: new Date(Date.now() - 60_000).toISOString(),
      created_at: new Date().toISOString(),
    });
    await expireConversationContexts();
    expect(st.frames).toHaveLength(0);
  });
});
