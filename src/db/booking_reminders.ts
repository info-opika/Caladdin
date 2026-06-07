import { DateTime } from 'luxon';
import { getSupabase, setUserContext } from './client.js';
import type { SchedulingSessionRow } from './scheduling_sessions.js';

export type ReminderType = 't24h' | 't1h';
export type ReminderStatus = 'pending' | 'sent' | 'skipped' | 'failed';

export interface BookingReminderRow {
  id: string;
  sessionId: string;
  reminderType: ReminderType;
  scheduledFor: string;
  status: ReminderStatus;
  sentAt: string | null;
  errorMessage: string | null;
  createdAt: string;
}

const memoryStore = new Map<string, BookingReminderRow>();

function useMemoryStore(): boolean {
  return process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
}

function memoryKey(sessionId: string, reminderType: ReminderType): string {
  return `${sessionId}:${reminderType}`;
}

function rowFromDb(data: Record<string, unknown>): BookingReminderRow {
  return {
    id: data.id as string,
    sessionId: data.session_id as string,
    reminderType: data.reminder_type as ReminderType,
    scheduledFor: data.scheduled_for as string,
    status: data.status as ReminderStatus,
    sentAt: (data.sent_at as string) ?? null,
    errorMessage: (data.error_message as string) ?? null,
    createdAt: data.created_at as string,
  };
}

export function reminderScheduledFor(slotStartIso: string, type: ReminderType): string {
  const start = DateTime.fromISO(slotStartIso, { setZone: true });
  const hours = type === 't24h' ? 24 : 1;
  return start.minus({ hours }).toUTC().toISO()!;
}

/** Service role — enqueue reminders after booking confirmation. */
export async function enqueueRemindersForSession(session: SchedulingSessionRow): Promise<void> {
  if (!session.selected_slot?.start) return;

  for (const reminderType of ['t24h', 't1h'] as ReminderType[]) {
    const scheduledFor = reminderScheduledFor(session.selected_slot.start, reminderType);
    await upsertReminderRow({
      sessionId: session.id,
      reminderType,
      scheduledFor,
    });
  }
}

async function upsertReminderRow(opts: {
  sessionId: string;
  reminderType: ReminderType;
  scheduledFor: string;
}): Promise<BookingReminderRow> {
  const row = {
    session_id: opts.sessionId,
    reminder_type: opts.reminderType,
    scheduled_for: opts.scheduledFor,
    status: 'pending' as ReminderStatus,
  };

  if (useMemoryStore()) {
    const key = memoryKey(opts.sessionId, opts.reminderType);
    const existing = memoryStore.get(key);
    const saved: BookingReminderRow = {
      id: existing?.id ?? `rem-${key}`,
      sessionId: opts.sessionId,
      reminderType: opts.reminderType,
      scheduledFor: opts.scheduledFor,
      status: existing?.status ?? 'pending',
      sentAt: existing?.sentAt ?? null,
      errorMessage: existing?.errorMessage ?? null,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    memoryStore.set(key, saved);
    return saved;
  }

  const { data, error } = await getSupabase()
    .from('booking_reminders')
    .upsert(row, { onConflict: 'session_id,reminder_type', ignoreDuplicates: true })
    .select()
    .maybeSingle();
  if (error) throw error;
  if (data) return rowFromDb(data as Record<string, unknown>);

  const { data: existing, error: fetchErr } = await getSupabase()
    .from('booking_reminders')
    .select('*')
    .eq('session_id', opts.sessionId)
    .eq('reminder_type', opts.reminderType)
    .maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!existing) throw new Error('reminder_upsert_failed');
  return rowFromDb(existing as Record<string, unknown>);
}

export async function listDueReminders(now = new Date()): Promise<BookingReminderRow[]> {
  if (useMemoryStore()) {
    const cutoff = now.toISOString();
    return [...memoryStore.values()].filter(
      (r) => r.status === 'pending' && r.scheduledFor <= cutoff,
    );
  }

  const { data, error } = await getSupabase()
    .from('booking_reminders')
    .select('*')
    .eq('status', 'pending')
    .lte('scheduled_for', now.toISOString());
  if (error) throw error;
  return (data ?? []).map((d) => rowFromDb(d as Record<string, unknown>));
}

export async function markReminderSent(id: string): Promise<void> {
  const patch = { status: 'sent' as ReminderStatus, sent_at: new Date().toISOString() };

  if (useMemoryStore()) {
    for (const [key, row] of memoryStore.entries()) {
      if (row.id === id) {
        memoryStore.set(key, { ...row, ...patch, sentAt: patch.sent_at });
        return;
      }
    }
    return;
  }

  const { error } = await getSupabase().from('booking_reminders').update(patch).eq('id', id);
  if (error) throw error;
}

export async function markReminderFailed(id: string, message: string): Promise<void> {
  const patch = { status: 'failed' as ReminderStatus, error_message: message };

  if (useMemoryStore()) {
    for (const [key, row] of memoryStore.entries()) {
      if (row.id === id) {
        memoryStore.set(key, { ...row, status: 'failed', errorMessage: message });
        return;
      }
    }
    return;
  }

  const { error } = await getSupabase().from('booking_reminders').update(patch).eq('id', id);
  if (error) throw error;
}

/** Host-scoped listing via setUserContext. */
export async function listRemindersForHost(hostUserId: string): Promise<BookingReminderRow[]> {
  if (useMemoryStore()) {
    return [...memoryStore.values()];
  }

  const db = await setUserContext(hostUserId);
  const { data, error } = await db.from('booking_reminders').select('*');
  if (error) throw error;
  return (data ?? []).map((d) => rowFromDb(d as Record<string, unknown>));
}

export function resetBookingRemindersForTests(): void {
  memoryStore.clear();
}
