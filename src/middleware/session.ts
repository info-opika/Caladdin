import { Request, Response, NextFunction } from 'express';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { config } from '../config.js';
import {
  deleteAuthSessionByTokenHash,
  getAuthSessionByTokenHash,
  hashSessionToken,
  insertAuthSession,
} from '../db/sessions.js';

const SESSION_COOKIE = 'caladdin_session';
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;

export interface SessionData {
  userId: string;
  email: string;
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function signSessionToken(userId: string): string {
  const ts = Date.now();
  const nonce = randomBytes(16).toString('base64url');
  const payload = Buffer.from(`${userId}:${ts}:${nonce}`).toString('base64url');
  const sig = createHmac('sha256', config.sessionSecret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifySessionTokenSignature(token: string): boolean {
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const expected = createHmac('sha256', config.sessionSecret).update(parts[0]).digest('base64url');
  try {
    return timingSafeEqualStr(parts[1], expected);
  } catch {
    return false;
  }
}

export async function createSession(userId: string, email: string): Promise<string> {
  const token = signSessionToken(userId);
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

  await insertAuthSession({
    token_hash: tokenHash,
    user_id: userId,
    email,
    expires_at: expiresAt,
  });

  return token;
}

export async function getSession(token: string | undefined): Promise<SessionData | null> {
  if (!token || !verifySessionTokenSignature(token)) return null;

  const row = await getAuthSessionByTokenHash(hashSessionToken(token));
  if (!row) return null;

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await deleteAuthSessionByTokenHash(row.token_hash);
    return null;
  }

  return { userId: row.user_id, email: row.email };
}

export async function destroySession(token: string): Promise<void> {
  if (!token) return;
  await deleteAuthSessionByTokenHash(hashSessionToken(token));
}

export async function requireSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.[SESSION_COOKIE] ?? req.headers.cookie?.match(/caladdin_session=([^;]+)/)?.[1];
  try {
    const session = await getSession(token);
    if (!session) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    (req as Request & { session: SessionData }).session = session;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const provided = req.headers['x-api-key'];
  if (typeof provided !== 'string' || !config.apiKey) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const a = Buffer.from(provided.padEnd(64));
  const b = Buffer.from(config.apiKey.padEnd(64));
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'lax',
    maxAge: SESSION_TTL_MS,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE);
}

export { SESSION_COOKIE };
