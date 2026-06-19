import { google } from 'googleapis';
import { createHmac, timingSafeEqual } from 'crypto';
import { config } from '../config.js';
import { getGoogleTokens, saveGoogleTokens } from '../db/tokens.js';
import { logger } from '../logger.js';
import {
  exchangeAuthorizationCode,
  isAccessTokenFresh,
  refreshAccessToken,
} from './google_token_exchange.js';
import { fetchGoogleUserInfo } from './google_https.js';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

export function createOAuth2Client() {
  return new google.auth.OAuth2(
    config.googleClientId.trim(),
    config.googleClientSecret.trim(),
    config.googleRedirectUri.trim(),
  );
}

export function getAuthUrl(state: string): string {
  const client = createOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
    state,
  });
}

export function signOAuthState(payload: string): string {
  const sig = createHmac('sha256', config.oauthStateSecret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyOAuthState(state: string): boolean {
  const parts = state.split('.');
  if (parts.length !== 2) return false;
  const expected = createHmac('sha256', config.oauthStateSecret).update(parts[0]).digest('base64url');
  try {
    return timingSafeEqualStr(parts[1], expected);
  } catch {
    return false;
  }
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export async function exchangeCodeForTokens(code: string): Promise<{
  access_token: string;
  refresh_token?: string | null;
  expiry_date?: number | null;
}> {
  return exchangeAuthorizationCode(code, config.googleRedirectUri.trim());
}

/** Returns an OAuth2 client with a fresh access token (refresh via node:https, not gaxios). */
export async function getOAuth2AuthForUser(userId: string) {
  const stored = await getGoogleTokens(userId);
  if (!stored?.access_token) return null;

  let accessToken = stored.access_token;
  let refreshToken = stored.refresh_token;
  let expiryMs = stored.expiry ? new Date(stored.expiry).getTime() : null;

  if (!isAccessTokenFresh(stored.expiry)) {
    if (!stored.refresh_token) {
      logger.warn('OAuth token refresh failed', { userId, error: 'missing refresh_token' });
      return null;
    }
    try {
      const refreshed = await refreshAccessToken(stored.refresh_token);
      accessToken = refreshed.access_token;
      refreshToken = refreshed.refresh_token ?? stored.refresh_token;
      expiryMs = refreshed.expiry_date ?? null;
      await saveGoogleTokens(userId, {
        access_token: accessToken,
        refresh_token: refreshToken,
        expiry: expiryMs ? new Date(expiryMs) : null,
      });
    } catch (e) {
      logger.warn('OAuth token refresh failed', { userId, error: String(e) });
      return null;
    }
  }

  const auth = createOAuth2Client();
  auth.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken ?? undefined,
    expiry_date: expiryMs ?? undefined,
  });
  return auth;
}

export async function getOAuthClientForUser(userId: string): Promise<ReturnType<typeof google.calendar> | null> {
  const auth = await getOAuth2AuthForUser(userId);
  if (!auth) return null;
  return google.calendar({ version: 'v3', auth });
}

export async function persistTokensForUser(
  userId: string,
  tokens: { access_token: string; refresh_token?: string | null; expiry_date?: number | null },
): Promise<void> {
  const existing = await getGoogleTokens(userId);
  await saveGoogleTokens(userId, {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? existing?.refresh_token ?? null,
    expiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
  });
}

export async function getGoogleUserInfo(accessToken: string): Promise<{ email: string; name?: string }> {
  return fetchGoogleUserInfo(accessToken);
}

export function getAuthService() {
  return {
    getClientForUser: getOAuthClientForUser,
  };
}
