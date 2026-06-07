import { randomBytes } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';
import { SESSION_COOKIE } from './session.js';

export const CSRF_COOKIE = 'caladdin_csrf';
export const CSRF_HEADER = 'x-csrf-token';

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/** Paths exempt from CSRF (API-key, guest token, OAuth, public booking). */
function isCsrfExempt(path: string): boolean {
  return (
    path.startsWith('/jobs') ||
    path.startsWith('/confirm') ||
    path.startsWith('/s/') ||
    path.startsWith('/book/') ||
    path.startsWith('/waitlist') ||
    path.startsWith('/invite') ||
    path === '/auth/start' ||
    path === '/auth/callback'
  );
}

export function generateCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

export function setCsrfCookie(res: Response, token: string): void {
  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false,
    secure: config.isProd,
    sameSite: 'lax',
    maxAge: 7 * 24 * 3600 * 1000,
  });
}

export function clearCsrfCookie(res: Response): void {
  res.clearCookie(CSRF_COOKIE);
}

/** Double-submit cookie check for session-authenticated mutations. */
export function csrfProtectionMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (process.env.VITEST === 'true' || process.env.NODE_ENV === 'test') {
    next();
    return;
  }

  if (!MUTATING_METHODS.has(req.method)) {
    next();
    return;
  }

  if (isCsrfExempt(req.path)) {
    next();
    return;
  }

  const sessionCookie = req.cookies?.[SESSION_COOKIE];
  if (!sessionCookie) {
    next();
    return;
  }

  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.headers[CSRF_HEADER];
  if (
    typeof cookieToken !== 'string' ||
    typeof headerToken !== 'string' ||
    cookieToken.length === 0 ||
    cookieToken !== headerToken
  ) {
    res.status(403).json({ error: 'Invalid or missing CSRF token' });
    return;
  }

  next();
}
