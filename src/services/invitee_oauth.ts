import { google } from 'googleapis';
import type { calendar_v3 } from 'googleapis';
import { randomBytes } from 'crypto';
import { config } from '../config.js';
import { signOAuthState, verifyOAuthState } from './auth_service.js';
import { exchangeAuthorizationCode } from './google_token_exchange.js';
import type { InviteCalendarGrantRow } from '../db/invite_calendar_grants.js';
import { logger } from '../logger.js';

/** Narrowest scope for invitee availability — free/busy only, no event titles. */
export const INVITEE_OAUTH_SCOPES = ['https://www.googleapis.com/auth/calendar.freebusy'];

export function inviteeGrantRedirectUri(): string {
  return (
    process.env.INVITEE_GRANT_REDIRECT_URI ??
    `${config.baseUrl.replace(/\/$/, '')}/s/grant/callback`
  );
}

export function createInviteeOAuth2Client() {
  return new google.auth.OAuth2(
    config.googleClientId,
    config.googleClientSecret,
    inviteeGrantRedirectUri(),
  );
}

function buildGrantStatePayload(sessionToken: string): string {
  return Buffer.from(
    JSON.stringify({
      kind: 'invite_grant',
      token: sessionToken,
      nonce: randomBytes(10).toString('base64url'),
    }),
  ).toString('base64url');
}

export function parseGrantState(state: string): { token: string } | null {
  const parts = state.split('.');
  if (parts.length !== 2 || !verifyOAuthState(state)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as {
      kind?: string;
      token?: string;
    };
    if (payload.kind !== 'invite_grant' || !payload.token) return null;
    return { token: payload.token };
  } catch {
    return null;
  }
}

export function getInviteeGrantAuthUrl(sessionToken: string): string {
  const client = createInviteeOAuth2Client();
  const state = signOAuthState(buildGrantStatePayload(sessionToken));
  return client.generateAuthUrl({
    access_type: 'offline',
    scope: INVITEE_OAUTH_SCOPES,
    prompt: 'consent',
    state,
  });
}

export async function exchangeInviteeGrantCode(code: string): Promise<{
  access_token: string;
  refresh_token?: string | null;
  expiry_date?: number | null;
}> {
  const tokens = await exchangeAuthorizationCode(code, inviteeGrantRedirectUri());
  if (!tokens.access_token) {
    throw new Error('missing_access_token');
  }
  return tokens;
}

export async function getInviteeCalendarClient(
  grant: InviteCalendarGrantRow,
): Promise<calendar_v3.Calendar | null> {
  if (!grant.oauth_access_token || grant.status !== 'active') return null;

  const auth = createInviteeOAuth2Client();
  auth.setCredentials({
    access_token: grant.oauth_access_token,
    refresh_token: grant.oauth_refresh_token ?? undefined,
    expiry_date: grant.oauth_expiry ? new Date(grant.oauth_expiry).getTime() : undefined,
  });

  try {
    await auth.getAccessToken();
  } catch (e) {
    logger.warn('Invitee grant token refresh failed', { grantId: grant.id, error: String(e) });
    return null;
  }

  return google.calendar({ version: 'v3', auth });
}
