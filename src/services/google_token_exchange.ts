import https from 'node:https';
import { config } from '../config.js';
import { logger } from '../logger.js';

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableNetworkError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /Premature close|ECONNRESET|ETIMEDOUT|timed out|socket hang up|EAI_AGAIN|ENOTFOUND|fetch failed/i.test(
    msg,
  );
}

function postTokenForm(body: string, timeoutMs = 25_000): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: TOKEN_HOST,
        path: TOKEN_PATH,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
          Accept: 'application/json',
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') });
        });
        res.on('error', reject);
      },
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('Google token request timed out'));
    });
    req.write(body);
    req.end();
  });
}

/** Exchange an OAuth authorization code using Node https (avoids gaxios premature-close on errors). */
export async function exchangeAuthorizationCode(
  code: string,
  redirectUri: string,
): Promise<GoogleTokenPayload> {
  const clientId = config.googleClientId.trim();
  const clientSecret = config.googleClientSecret.trim();
  const normalizedRedirect = redirectUri.trim();

  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: normalizedRedirect,
    grant_type: 'authorization_code',
  }).toString();

  let lastError: unknown;

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const { status, text } = await postTokenForm(body);
      let parsed: GoogleTokenJson;
      try {
        parsed = JSON.parse(text) as GoogleTokenJson;
      } catch {
        logger.error('Google token exchange returned non-JSON', {
          status,
          bodyPreview: text.slice(0, 400),
          redirectUri: normalizedRedirect,
        });
        throw new Error(`Google token exchange returned invalid response (${status})`);
      }

      if (status >= 400 || parsed.error) {
        logger.error('Google token exchange rejected', {
          status,
          error: parsed.error,
          error_description: parsed.error_description,
          redirectUri: normalizedRedirect,
          clientIdPrefix: clientId.slice(0, 12),
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
      if (isConfig || attempt >= 4 || !isRetryableNetworkError(err)) {
        throw err;
      }
      logger.warn('Google token exchange network retry', { attempt, error: msg });
      await sleep(attempt * 600);
    }
  }

  throw lastError;
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
    const { status, text } = await postTokenForm(body, 10_000);
    const parsed = JSON.parse(text) as GoogleTokenJson;
    if (parsed.error === 'invalid_grant' || parsed.error === 'invalid_client') {
      return { ok: true, detail: `reachable (${parsed.error})` };
    }
    return { ok: status < 500, detail: `status=${status} error=${parsed.error ?? 'none'}` };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}
