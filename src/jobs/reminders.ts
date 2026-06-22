import { DateTime } from 'luxon';
import { getSchedulingSessionById } from '../db/scheduling_sessions.js';
import { formatTimezoneLabel } from '../services/schedule_formatting.js';
import { getBookingResponseForSession } from '../db/booking_responses.js';
import {
  listDueReminders,
  markReminderFailed,
  markReminderSent,
  type BookingReminderRow,
  type ReminderType,
} from '../db/booking_reminders.js';
import { sendEmail } from '../services/email.js';
import { config } from '../config.js';
import { guestActionUrl } from '../core/guest-action-token.js';
import { logger } from '../logger.js';

export interface ReminderRunResult {
  processed: number;
  sent: number;
  skipped: number;
  failed: number;
}

function reminderLabel(type: ReminderType): string {
  return type === 't24h' ? '24 hours' : '1 hour';
}

export function buildReminderEmailHtml(opts: {
  guestName: string;
  hostName: string;
  slotStart: string;
  hostTimezone: string;
  sessionToken: string;
  reminderType: ReminderType;
}): { subject: string; html: string } {
  const when = formatSlotTime(opts.slotStart, opts.hostTimezone);
  const cancelUrl = guestActionUrl(opts.sessionToken, 'cancel');
  const rescheduleUrl = guestActionUrl(opts.sessionToken, 'reschedule');
  const lead = reminderLabel(opts.reminderType);

  const subject = `Reminder (${lead}): meeting with ${opts.hostName}`;
  const html = `
    <p>Hi ${opts.guestName},</p>
    <p>Your meeting with ${opts.hostName} is in about ${lead}.</p>
    <p><strong>When:</strong> ${when}</p>
    <p>
      <a href="${rescheduleUrl}">Reschedule</a> ·
      <a href="${cancelUrl}">Cancel</a>
    </p>
    <p><small>Caladdin · ${config.baseUrl}</small></p>
  `;
  return { subject, html };
}

function formatSlotTime(iso: string, tz: string): string {
  const start = DateTime.fromISO(iso, { zone: tz });
  if (!start.isValid) return iso;
  const tzLabel = formatTimezoneLabel(tz, start.toJSDate());
  return `${start.toFormat('cccc, MMM d')} · ${start.toFormat('h:mm a')} ${tzLabel}`;
}

async function resolveGuestDetails(session: {
  id: string;
  host_user_id: string;
  invitee_email: string | null;
}): Promise<{ guestName: string; guestEmail: string | null }> {
  const response = await getBookingResponseForSession(session.host_user_id, session.id);
  return {
    guestName: response?.guestName ?? 'there',
    guestEmail: response?.guestEmail ?? session.invitee_email,
  };
}

export async function processReminderRow(row: BookingReminderRow): Promise<'sent' | 'skipped' | 'failed'> {
  const session = await getSchedulingSessionById(row.sessionId);
  if (!session || session.status !== 'confirmed' || !session.selected_slot) {
    await markReminderSent(row.id);
    return 'skipped';
  }

  const { guestName, guestEmail } = await resolveGuestDetails(session);
  if (!guestEmail) {
    logger.info('Reminder skipped — no guest email', {
      sessionId: session.id,
      reminderType: row.reminderType,
    });
    await markReminderSent(row.id);
    return 'skipped';
  }

  const { subject, html } = buildReminderEmailHtml({
    guestName,
    hostName: session.host_name ?? 'your host',
    slotStart: session.selected_slot.start,
    hostTimezone: session.host_timezone ?? 'America/Chicago',
    sessionToken: session.token,
    reminderType: row.reminderType,
  });

  logger.info('Queueing reminder email', {
    sessionId: session.id,
    reminderType: row.reminderType,
    to: guestEmail,
    subject,
  });

  const result = await sendEmail({ to: guestEmail, subject, html });
  if (!result.ok) {
    await markReminderFailed(row.id, 'email_send_failed');
    return 'failed';
  }

  await markReminderSent(row.id);
  return result.skipped ? 'skipped' : 'sent';
}

export async function runReminders(now = new Date()): Promise<ReminderRunResult> {
  const due = await listDueReminders(now);
  const result: ReminderRunResult = { processed: due.length, sent: 0, skipped: 0, failed: 0 };

  for (const row of due) {
    try {
      const outcome = await processReminderRow(row);
      if (outcome === 'sent') result.sent += 1;
      else if (outcome === 'skipped') result.skipped += 1;
      else result.failed += 1;
    } catch (err) {
      logger.error('Reminder processing error', { reminderId: row.id, error: String(err) });
      await markReminderFailed(row.id, String(err));
      result.failed += 1;
    }
  }

  if (result.processed > 0) {
    logger.info('Reminder job complete', { ...result });
  }

  return result;
}

export function reminderTypeLabel(type: ReminderType): string {
  return reminderLabel(type);
}
