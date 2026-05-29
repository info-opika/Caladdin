import { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { config } from '../config.js';

const SESSION_COOKIE = 'caladdin_session';

export interface SessionData {
  userId: string;
  email: string;
}

const sessions = new Map<string, SessionData>();

export function createSession(userId: string, email: string): string {
  const token = Buffer.from(`${userId}:${Date.now()}:${Math.random()}`).toString('base64url');
  sessions.set(token, { userId, email });
  return token;
}

export function getSession(token: string | undefined): SessionData | null {
  if (!token) return null;
  return sessions.get(token) ?? null;
}

export function destroySession(token: string): void {
  sessions.delete(token);
}

export function requireSession(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.[SESSION_COOKIE] ?? req.headers.cookie?.match(/caladdin_session=([^;]+)/)?.[1];
  const session = getSession(token);
  if (!session) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  (req as Request & { session: SessionData }).session = session;
  next();
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
    maxAge: 7 * 24 * 3600 * 1000,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE);
}

export { SESSION_COOKIE };
