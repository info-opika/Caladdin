import { getSupabase, setUserContext } from './client.js';

export interface BookingResponseRow {
  id: string;
  sessionId: string;
  guestName: string;
  guestEmail: string;
  notes: string | null;
  answers: Record<string, unknown>;
  createdAt: string;
}

export interface GuestIntakePayload {
  name: string;
  email: string;
  notes?: string;
  answers?: Record<string, unknown>;
}

function rowFromDb(data: Record<string, unknown>): BookingResponseRow {
  return {
    id: data.id as string,
    sessionId: data.session_id as string,
    guestName: data.guest_name as string,
    guestEmail: data.guest_email as string,
    notes: (data.notes as string) ?? null,
    answers: (data.answers as Record<string, unknown>) ?? {},
    createdAt: data.created_at as string,
  };
}

const memoryStore = new Map<string, BookingResponseRow>();

function useMemoryStore(): boolean {
  return process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
}

export function isValidGuestEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function validateGuestIntake(guest: GuestIntakePayload | undefined): string | null {
  if (!guest?.name?.trim()) return 'name_required';
  if (!guest.email?.trim()) return 'email_required';
  if (!isValidGuestEmail(guest.email.trim())) return 'email_invalid';
  return null;
}

/** Guest booking flow — service role (public token route). */
export async function upsertBookingResponse(opts: {
  sessionId: string;
  guest: GuestIntakePayload;
}): Promise<BookingResponseRow> {
  const row = {
    session_id: opts.sessionId,
    guest_name: opts.guest.name.trim(),
    guest_email: opts.guest.email.trim().toLowerCase(),
    notes: opts.guest.notes?.trim() || null,
    answers: opts.guest.answers ?? {},
  };

  if (useMemoryStore()) {
    const existing = [...memoryStore.values()].find((r) => r.sessionId === opts.sessionId);
    const saved: BookingResponseRow = {
      id: existing?.id ?? `br-${opts.sessionId}`,
      sessionId: opts.sessionId,
      guestName: row.guest_name,
      guestEmail: row.guest_email,
      notes: row.notes,
      answers: row.answers,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    memoryStore.set(saved.id, saved);
    return saved;
  }

  const { data, error } = await getSupabase()
    .from('booking_responses')
    .upsert(row, { onConflict: 'session_id' })
    .select()
    .single();
  if (error) throw error;
  return rowFromDb(data as Record<string, unknown>);
}

/** Host-scoped read via setUserContext. */
export async function getBookingResponseForSession(
  hostUserId: string,
  sessionId: string,
): Promise<BookingResponseRow | null> {
  if (useMemoryStore()) {
    return [...memoryStore.values()].find((r) => r.sessionId === sessionId) ?? null;
  }

  const db = await setUserContext(hostUserId);
  const { data, error } = await db
    .from('booking_responses')
    .select('*')
    .eq('session_id', sessionId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return rowFromDb(data as Record<string, unknown>);
}

export function resetBookingResponsesForTests(): void {
  memoryStore.clear();
}
