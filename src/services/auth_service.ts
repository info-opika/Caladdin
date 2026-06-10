import { google } from 'googleapis';
import { createHmac, timingSafeEqual } from 'crypto';
import { config } from '../config.js';
import { getGoogleTokens, saveGoogleTokens } from '../db/tokens.js';
import { logger } from '../logger.js';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

export function createOAuth2Client() {
  return new google.auth.OAuth2(
    config.googleClientId,
    config.googleClientSecret,
    config.googleRedirectUri,
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
  const client = createOAuth2Client();
  const { tokens } = await client.getToken(code);
  return {
    access_token: tokens.access_token!,
    refresh_token: tokens.refresh_token,
    expiry_date: tokens.expiry_date,
  };
}

/** Returns a refreshed OAuth2 client for direct GCal API calls (recurring events, etc.). */
export async function getOAuth2AuthForUser(userId: string) {
  const stored = await getGoogleTokens(userId);
  if (!stored?.access_token) return null;

  const auth = createOAuth2Client();
  auth.setCredentials({
    access_token: stored.access_token,
    refresh_token: stored.refresh_token ?? undefined,
    expiry_date: stored.expiry ? new Date(stored.expiry).getTime() : undefined,
  });

  auth.on('tokens', async (tokens) => {
    if (tokens.access_token) {
      await saveGoogleTokens(userId, {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token ?? stored.refresh_token,
        expiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      }).catch((e) => logger.warn('Token refresh save failed', { error: String(e) }));
    }
  });

  try {
    await auth.getAccessToken();
  } catch (e) {
    logger.warn('OAuth token refresh failed', { userId, error: String(e) });
    return null;
  }

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
  await saveGoogleTokens(userId, {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
  });
}

export async function getGoogleUserInfo(accessToken: string): Promise<{ email: string; name?: string }> {
  const auth = createOAuth2Client();
  auth.setCredentials({ access_token: accessToken });
  const oauth2 = google.oauth2({ version: 'v2', auth });
  const { data } = await oauth2.userinfo.get();
  return { email: data.email!, name: data.name ?? undefined };
}

export function getAuthService() {
  return {
    getClientForUser: getOAuthClientForUser,
  };
}
