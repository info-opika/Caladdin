import { createHmac, timingSafeEqual } from 'crypto';
import { config } from '../config.js';

export type GuestAction = 'cancel' | 'reschedule';

function timingSafeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function signPayload(payload: string): string {
  return createHmac('sha256', config.sessionSecret).update(payload).digest('base64url');
}

/** Signed token for guest cancel/reschedule links (no session cookie required). */
export function signGuestActionToken(sessionToken: string, action: GuestAction): string {
  const payload = Buffer.from(`${sessionToken}:${action}`).toString('base64url');
  return `${payload}.${signPayload(payload)}`;
}

export function verifyGuestActionToken(
  sessionToken: string,
  action: GuestAction,
  token: string | undefined,
): boolean {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;

  let decoded: string;
  try {
    decoded = Buffer.from(parts[0], 'base64url').toString('utf8');
  } catch {
    return false;
  }

  const expectedPayload = `${sessionToken}:${action}`;
  if (decoded !== expectedPayload) return false;

  const expectedSig = signPayload(parts[0]);
  try {
    return timingSafeEqualStr(parts[1], expectedSig);
  } catch {
    return false;
  }
}

export function guestActionUrl(sessionToken: string, action: GuestAction): string {
  const actionToken = signGuestActionToken(sessionToken, action);
  return `${config.baseUrl}/s/${sessionToken}/${action}?actionToken=${encodeURIComponent(actionToken)}`;
}
