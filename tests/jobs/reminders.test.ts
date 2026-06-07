import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import {
  reminderScheduledFor,
  enqueueRemindersForSession,
  resetBookingRemindersForTests,
} from '../../src/db/booking_reminders.js';
import { buildReminderEmailHtml, processReminderRow } from '../../src/jobs/reminders.js';
import type { SchedulingSessionRow } from '../../src/db/scheduling_sessions.js';

const mockGetSessionById = vi.fn();
const mockGetBookingResponse = vi.fn();
const mockSendEmail = vi.fn();
const mockMarkSent = vi.fn();
const mockMarkFailed = vi.fn();

vi.mock('../../src/db/scheduling_sessions.js', () => ({
  getSchedulingSessionById: (...a: unknown[]) => mockGetSessionById(...a),
}));

vi.mock('../../src/db/booking_responses.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/db/booking_responses.js')>();
  return {
    ...actual,
    getBookingResponseForSession: (...a: unknown[]) => mockGetBookingResponse(...a),
  };
});

vi.mock('../../src/services/email.js', () => ({
  sendEmail: (...a: unknown[]) => mockSendEmail(...a),
}));

vi.mock('../../src/db/booking_reminders.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/db/booking_reminders.js')>();
  return {
    ...actual,
    markReminderSent: (...a: unknown[]) => mockMarkSent(...a),
    markReminderFailed: (...a: unknown[]) => mockMarkFailed(...a),
  };
});

function session(over: Partial<SchedulingSessionRow> = {}): SchedulingSessionRow {
  const slotStart = DateTime.utc().plus({ hours: 25 }).toISO()!;
  const slotEnd = DateTime.utc().plus({ hours: 26 }).toISO()!;
  return {
    id: 'sess-1',
    token: 'tok-1',
    host_user_id: 'host-1',
    host_name: 'Jane',
    host_timezone: 'America/Chicago',
    invitee_email: null,
    invitee_label: null,
    duration_minutes: 60,
    offered_slots: [],
    selected_slot: { start: slotStart, end: slotEnd, adjacentEventCount: 0, energyScore: 0.5, createsFragment: false },
    google_event_id: 'g1',
    proposed_alternatives: [],
    status: 'confirmed',
    expires_at: DateTime.utc().plus({ days: 2 }).toISO()!,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...over,
  };
}

describe('booking reminders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetBookingRemindersForTests();
    mockSendEmail.mockResolvedValue({ ok: true, skipped: true });
    mockMarkSent.mockResolvedValue(undefined);
    mockMarkFailed.mockResolvedValue(undefined);
    mockGetBookingResponse.mockResolvedValue({
      guestName: 'Guest',
      guestEmail: 'guest@example.com',
    });
  });

  it('computes T-24h and T-1h scheduled times', () => {
    const start = '2026-06-10T15:00:00.000Z';
    expect(reminderScheduledFor(start, 't24h')).toBe('2026-06-09T15:00:00.000Z');
    expect(reminderScheduledFor(start, 't1h')).toBe('2026-06-10T14:00:00.000Z');
  });

  it('enqueues pending reminders for confirmed session', async () => {
    await enqueueRemindersForSession(session());
    const { listRemindersForHost } = await import('../../src/db/booking_reminders.js');
    const rows = await listRemindersForHost('host-1');
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.reminderType).sort()).toEqual(['t1h', 't24h']);
    expect(rows.every((r) => r.status === 'pending')).toBe(true);
  });

  it('builds reminder email with cancel/reschedule links', () => {
    const { subject, html } = buildReminderEmailHtml({
      guestName: 'Guest',
      hostName: 'Jane',
      slotStart: '2026-06-10T15:00:00-05:00',
      hostTimezone: 'America/Chicago',
      sessionToken: 'tok-1',
      reminderType: 't24h',
    });
    expect(subject).toContain('Jane');
    expect(html).toContain('Reschedule');
    expect(html).toContain('Cancel');
    expect(html).toContain('/s/tok-1/');
  });

  it('processes due reminder and marks sent', async () => {
    mockGetSessionById.mockResolvedValueOnce(session());
    const outcome = await processReminderRow({
      id: 'rem-1',
      sessionId: 'sess-1',
      reminderType: 't24h',
      scheduledFor: new Date().toISOString(),
      status: 'pending',
      sentAt: null,
      errorMessage: null,
      createdAt: new Date().toISOString(),
    });
    expect(outcome).toBe('skipped');
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'guest@example.com' }),
    );
    expect(mockMarkSent).toHaveBeenCalledWith('rem-1');
  });
});
