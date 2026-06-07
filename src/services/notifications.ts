import { config } from '../config.js';
import { logger } from '../logger.js';
import { sendEmail } from './email.js';
import { getUserById } from '../db/users.js';

/** ntfy HTTP headers must be ISO-8859-1 (ByteString); Unicode chars like em-dash break fetch(). */
export function toNtfyHeaderValue(text: string): string {
  return text
    .replace(/\u2013|\u2014|\u2015/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[^\x00-\xFF]/g, '?');
}

export async function sendNtfy(title: string, message: string, actions?: Array<{ action: string; label: string; url: string }>): Promise<boolean> {
  try {
    const headers: Record<string, string> = {
      Title: toNtfyHeaderValue(title),
      Tags: 'calendar',
    };
    if (actions?.length) {
      headers.Actions = toNtfyHeaderValue(
        actions.map((a) => `http, ${a.label}, ${a.url}, method=POST`).join('; '),
      );
    }
    const res = await fetch(`https://ntfy.sh/${config.ntfyUserTopic}`, {
      method: 'POST',
      headers,
      body: message,
    });
    if (!res.ok) {
      logger.warn('ntfy send returned non-ok', { status: res.status, topic: config.ntfyUserTopic });
    }
    return res.ok;
  } catch (e) {
    logger.warn('ntfy send failed', { error: String(e) });
    return false;
  }
}

export async function sendConfirmationRequest(
  token: string,
  message: string,
): Promise<boolean> {
  const base = config.baseUrl.replace(/\/$/, '');
  const approveUrl = `${base}/confirm/${token}/approve`;
  const rejectUrl = `${base}/confirm/${token}/reject`;
  return sendNtfy('Caladdin - Confirm action', message, [
    { action: 'approve', label: 'Approve', url: approveUrl },
    { action: 'reject', label: 'Reject', url: rejectUrl },
  ]);
}

export async function notifyBuild(message: string): Promise<boolean> {
  try {
    const res = await fetch(`https://ntfy.sh/${config.ntfyTopic}`, {
      method: 'POST',
      headers: { Title: toNtfyHeaderValue('Caladdin Build') },
      body: message,
    });
    return res.ok;
  } catch {
    return false;
  }
}

export type HostBookingNotificationKind = 'booked' | 'proposed' | 'cancelled' | 'rescheduled';

export interface HostBookingNotificationInput {
  hostUserId: string;
  sessionToken: string;
  kind: HostBookingNotificationKind;
  proposedDate?: string;
  proposedTimeWindow?: string;
  note?: string;
}

function subjectForKind(kind: HostBookingNotificationKind): string {
  switch (kind) {
    case 'proposed':
      return 'Caladdin — guest suggested another time';
    case 'cancelled':
      return 'Caladdin — meeting cancelled';
    case 'rescheduled':
      return 'Caladdin — meeting rescheduled';
    default:
      return 'Caladdin — guest booked a time';
  }
}

function bodyForKind(input: HostBookingNotificationInput): string {
  const link = `${config.baseUrl.replace(/\/$/, '')}/s/${input.sessionToken}`;
  switch (input.kind) {
    case 'proposed':
      return `A guest suggested another time (${input.proposedDate ?? 'date TBD'}, ${input.proposedTimeWindow ?? 'flexible'}).${input.note ? ` Note: ${input.note}` : ''}\n\nView session: ${link}`;
    case 'cancelled':
      return `A guest cancelled their meeting.\n\nView session: ${link}`;
    case 'rescheduled':
      return `A guest rescheduled their meeting.\n\nView session: ${link}`;
    default:
      return `Someone picked a time from your scheduling link.\n\nView session: ${link}`;
  }
}

export async function sendHostBookingNotification(input: HostBookingNotificationInput): Promise<boolean> {
  const subject = subjectForKind(input.kind);
  const text = bodyForKind(input);
  const short = `${input.kind} (${input.sessionToken.slice(0, 8)}…)`;

  logger.info('Host booking notification', {
    hostUserId: input.hostUserId,
    kind: input.kind,
    sessionToken: input.sessionToken.slice(0, 8),
  });

  const host = await getUserById(input.hostUserId);
  if (host?.email) {
    await sendEmail({
      to: host.email,
      subject,
      html: `<p>${text.replace(/\n/g, '<br/>')}</p>`,
      text,
    });
  }

  return sendNtfy(`Caladdin - ${subject}`, short);
}
