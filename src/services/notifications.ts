import { config } from '../config.js';
import { logger } from '../logger.js';

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

export async function sendHostBookingNotification(hostUserId: string, sessionToken: string): Promise<boolean> {
  return sendNtfy(
    'Caladdin - Meeting booked',
    `Someone picked a time from your scheduling link (${sessionToken.slice(0, 8)}…).`,
  );
}
