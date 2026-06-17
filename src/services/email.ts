import { config } from '../config.js';
import { logger } from '../logger.js';

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail(opts: SendEmailOptions): Promise<{ ok: boolean; skipped?: boolean }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    logger.info('Email skipped (no RESEND_API_KEY)', { to: opts.to, subject: opts.subject });
    return { ok: true, skipped: true };
  }

  const from = process.env.EMAIL_FROM ?? 'Caladdin <onboarding@caladdin.app>';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
      text: opts.text ?? opts.html.replace(/<[^>]+>/g, ''),
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    logger.error('Email send failed', { status: res.status, body });
    return { ok: false };
  }
  return { ok: true };
}

export function platformInviteEmailHtml(inviterName: string, inviteLink: string): string {
  return `
    <p>${inviterName} invited you to try Caladdin — a voice-enabled calendar assistant.</p>
    <p><a href="${inviteLink}">Join Caladdin</a></p>
    <p>Caladdin helps you schedule meetings in plain English and protect your time.</p>
  `;
}

export function schedulingLinkEmailHtml(hostName: string, link: string): string {
  return `<p>${hostName} picked two times that work for a meeting with you.</p><p><a href="${link}">Pick a time</a></p>`;
}

export function schedulingLinkEmailText(hostName: string, link: string): string {
  return `${hostName} picked two times that work for a meeting with you.\nPick a time: ${link}`;
}

export { config };
