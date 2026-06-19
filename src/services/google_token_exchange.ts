import { config } from '../config.js';
import { logger } from '../logger.js';
import {
  googleHttpsRequest,
  googleHttpsRequestWithRetry,
  isRetryableNetworkError,
  sleep,
} from './google_https.js';

const TOKEN_HOST = 'oauth2.googleapis.com';
const TOKEN_PATH = '/token';

export type GoogleTokenPayload = {
  access_token: string;
  refresh_token?: string | null;
  expiry_date?: number | null;
};

type GoogleTokenJson = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

function postTokenForm(body: string, timeoutMs = 12_000): Promise<{ status: number; text: string }> {
  return googleHttpsRequest({
    hostname: TOKEN_HOST,
    path: TOKEN_PATH,
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    timeoutMs,
  });
}

async function requestGoogleTokens(
  params: URLSearchParams,
  logContext: Record<string, unknown>,
): Promise<GoogleTokenPayload> {
  const clientId = config.googleClientId.trim();
  const body = params.toString();
  let lastError: unknown;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const { status, text } = await postTokenForm(body);
      let parsed: GoogleTokenJson;
      try {
        parsed = JSON.parse(text) as GoogleTokenJson;
      } catch {
        logger.error('Google token exchange returned non-JSON', {
          status,
          bodyPreview: text.slice(0, 400),
          clientIdPrefix: clientId.slice(0, 12),
          ...logContext,
        });
        throw new Error(`Google token exchange returned invalid response (${status})`);
      }

      if (status >= 400 || parsed.error) {
        const logFn = parsed.error === 'invalid_grant' ? logger.warn.bind(logger) : logger.error.bind(logger);
        logFn('Google token exchange rejected', {
          status,
          error: parsed.error,
          error_description: parsed.error_description,
          clientIdPrefix: clientId.slice(0, 12),
          ...logContext,
        });
        throw new Error(
          `Google OAuth error: ${parsed.error ?? `http_${status}`}${
            parsed.error_description ? ` — ${parsed.error_description}` : ''
          }`,
        );
      }

      if (!parsed.access_token) {
        throw new Error('Google token exchange missing access_token');
      }

      return {
        access_token: parsed.access_token,
        refresh_token: parsed.refresh_token ?? null,
        expiry_date: parsed.expires_in ? Date.now() + parsed.expires_in * 1000 : null,
      };
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isConfig = msg.startsWith('Google OAuth error:');
      if (isConfig || attempt >= 2 || !isRetryableNetworkError(err)) {
        throw err;
      }
      logger.warn('Google token exchange network retry', { attempt, error: msg, ...logContext });
      await sleep(attempt * 250);
    }
  }

  throw lastError;
}

/** Exchange an OAuth authorization code using Node https (avoids gaxios premature-close on Render). */
export async function exchangeAuthorizationCode(
  code: string,
  redirectUri: string,
): Promise<GoogleTokenPayload> {
  const normalizedRedirect = redirectUri.trim();
  return requestGoogleTokens(
    new URLSearchParams({
      code,
      client_id: config.googleClientId.trim(),
      client_secret: config.googleClientSecret.trim(),
      redirect_uri: normalizedRedirect,
      grant_type: 'authorization_code',
    }),
    { grantType: 'authorization_code', redirectUri: normalizedRedirect },
  );
}

/** Refresh an access token using Node https (same gaxios workaround as code exchange). */
export async function refreshAccessToken(refreshToken: string): Promise<GoogleTokenPayload> {
  return requestGoogleTokens(
    new URLSearchParams({
      refresh_token: refreshToken.trim(),
      client_id: config.googleClientId.trim(),
      client_secret: config.googleClientSecret.trim(),
      grant_type: 'refresh_token',
    }),
    { grantType: 'refresh_token' },
  );
}

const REFRESH_BUFFER_MS = 5 * 60 * 1000;

/** True when stored expiry is far enough in the future to skip a refresh call. */
export function isAccessTokenFresh(expiry: string | Date | null | undefined): boolean {
  if (!expiry) return false;
  const ms = expiry instanceof Date ? expiry.getTime() : new Date(expiry).getTime();
  return ms > Date.now() + REFRESH_BUFFER_MS;
}

/** Reachability + credential sanity check (invalid code → expect invalid_grant, not network error). */
export async function probeGoogleTokenEndpoint(): Promise<{
  ok: boolean;
  detail: string;
}> {
  try {
    const body = new URLSearchParams({
      code: 'probe-invalid-code',
      client_id: config.googleClientId.trim(),
      client_secret: config.googleClientSecret.trim(),
      redirect_uri: config.googleRedirectUri.trim(),
      grant_type: 'authorization_code',
    }).toString();
    const { status, text } = await googleHttpsRequestWithRetry(
      {
        hostname: TOKEN_HOST,
        path: TOKEN_PATH,
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        timeoutMs: 10_000,
      },
      { operation: 'token_probe' },
    );
    const parsed = JSON.parse(text) as GoogleTokenJson;
    if (parsed.error === 'invalid_grant' || parsed.error === 'invalid_client') {
      return { ok: true, detail: `reachable (${parsed.error})` };
    }
    return { ok: status < 500, detail: `status=${status} error=${parsed.error ?? 'none'}` };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}
