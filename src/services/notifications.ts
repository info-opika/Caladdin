import { config } from '../config.js';
import { logger } from '../logger.js';

export async function sendNtfy(title: string, message: string, actions?: Array<{ action: string; label: string; url: string }>): Promise<boolean> {
  try {
    const headers: Record<string, string> = {
      Title: title,
      Tags: 'calendar',
    };
    if (actions?.length) {
      headers.Actions = actions.map((a) => `http, ${a.label}, ${a.url}, method=POST`).join('; ');
    }
    const res = await fetch(`https://ntfy.sh/${config.ntfyUserTopic}`, {
      method: 'POST',
      headers,
      body: message,
    });
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
  return sendNtfy('Caladdin — Confirm action', message, [
    { action: 'approve', label: 'Approve', url: approveUrl },
    { action: 'reject', label: 'Reject', url: rejectUrl },
  ]);
}

export async function notifyBuild(message: string): Promise<boolean> {
  try {
    const res = await fetch(`https://ntfy.sh/${config.ntfyTopic}`, {
      method: 'POST',
      headers: { Title: 'Caladdin Build' },
      body: message,
    });
    return res.ok;
  } catch {
    return false;
  }
}
