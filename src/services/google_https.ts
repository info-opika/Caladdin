import https from 'node:https';
import { logger } from '../logger.js';

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRetryableNetworkError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /Premature close|ECONNRESET|ETIMEDOUT|timed out|socket hang up|EAI_AGAIN|ENOTFOUND|fetch failed/i.test(
    msg,
  );
}

export type GoogleHttpsMethod = 'GET' | 'POST';

export type GoogleHttpsRequestOptions = {
  hostname: string;
  path: string;
  method: GoogleHttpsMethod;
  accessToken?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
};

export function googleHttpsRequest(
  opts: GoogleHttpsRequestOptions,
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...opts.headers,
    };
    if (opts.accessToken) {
      headers.Authorization = `Bearer ${opts.accessToken}`;
    }
    if (opts.body !== undefined) {
      headers['Content-Length'] = String(Buffer.byteLength(opts.body));
    }

    const req = https.request(
      {
        hostname: opts.hostname,
        path: opts.path,
        method: opts.method,
        headers,
        timeout: opts.timeoutMs ?? 12_000,
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
      req.destroy(new Error(`Google ${opts.method} ${opts.hostname}${opts.path} timed out`));
    });
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

export type GoogleHttpsRetryOptions = {
  maxAttempts?: number;
  backoffMs?: number;
};

export async function googleHttpsRequestWithRetry(
  opts: GoogleHttpsRequestOptions,
  logContext: Record<string, unknown> = {},
  retryOpts: GoogleHttpsRetryOptions = {},
): Promise<{ status: number; text: string }> {
  const maxAttempts = retryOpts.maxAttempts ?? 2;
  const backoffMs = retryOpts.backoffMs ?? 250;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await googleHttpsRequest(opts);
    } catch (err) {
      lastError = err;
      if (attempt >= maxAttempts || !isRetryableNetworkError(err)) {
        throw err;
      }
      logger.warn('Google HTTPS network retry', {
        attempt,
        error: err instanceof Error ? err.message : String(err),
        hostname: opts.hostname,
        path: opts.path,
        ...logContext,
      });
      await sleep(attempt * backoffMs);
    }
  }

  throw lastError;
}

export type GoogleUserInfo = {
  email: string;
  name?: string;
};

type UserInfoJson = {
  email?: string;
  name?: string;
  error?: { message?: string; status?: string };
};

/** Fetch OAuth user profile via node:https (avoids gaxios premature-close on Render). */
export async function fetchGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const { status, text } = await googleHttpsRequestWithRetry(
    {
      hostname: 'www.googleapis.com',
      path: '/oauth2/v2/userinfo',
      method: 'GET',
      accessToken: accessToken.trim(),
    },
    { operation: 'userinfo' },
  );

  let parsed: UserInfoJson;
  try {
    parsed = JSON.parse(text) as UserInfoJson;
  } catch {
    logger.error('Google userinfo returned non-JSON', {
      status,
      bodyPreview: text.slice(0, 400),
    });
    throw new Error(`Google userinfo returned invalid response (${status})`);
  }

  if (status >= 400 || parsed.error) {
    logger.error('Google userinfo rejected', { status, error: parsed.error });
    throw new Error(
      `Google userinfo error: ${parsed.error?.status ?? `http_${status}`}${
        parsed.error?.message ? ` — ${parsed.error.message}` : ''
      }`,
    );
  }

  if (!parsed.email) {
    throw new Error('Google userinfo missing email');
  }

  return { email: parsed.email, name: parsed.name };
}

export type GCalEventItem = {
  id?: string | null;
  summary?: string | null;
  status?: string | null;
  start?: { dateTime?: string | null; date?: string | null } | null;
  end?: { dateTime?: string | null; date?: string | null } | null;
};

type GCalListJson = {
  items?: GCalEventItem[];
  error?: { message?: string; code?: number };
};

/** List primary calendar events via node:https (sign-in import path). */
export async function listGCalEventsViaHttps(
  accessToken: string,
  timeMin: string,
  timeMax: string,
  maxResults = 250,
): Promise<GCalEventItem[]> {
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: String(maxResults),
  });
  const path = `/calendar/v3/calendars/primary/events?${params.toString()}`;

  const { status, text } = await googleHttpsRequestWithRetry(
    {
      hostname: 'www.googleapis.com',
      path,
      method: 'GET',
      accessToken: accessToken.trim(),
    },
    { operation: 'calendar.events.list' },
  );

  let parsed: GCalListJson;
  try {
    parsed = JSON.parse(text) as GCalListJson;
  } catch {
    logger.error('Google calendar list returned non-JSON', {
      status,
      bodyPreview: text.slice(0, 400),
    });
    throw new Error(`Google calendar list returned invalid response (${status})`);
  }

  if (status >= 400 || parsed.error) {
    logger.error('Google calendar list rejected', { status, error: parsed.error });
    throw new Error(
      `Google calendar list error: ${parsed.error?.message ?? `http_${status}`}`,
    );
  }

  return parsed.items ?? [];
}

type GCalFreeBusyJson = {
  calendars?: Record<string, { busy?: Array<{ start?: string; end?: string }> }>;
  error?: { message?: string; code?: number };
};

/** Query free/busy via node:https (avoids gaxios premature-close on Render). */
export async function queryFreeBusyViaHttps(
  accessToken: string,
  timeMin: string,
  timeMax: string,
  calendarIds: string[] = ['primary'],
): Promise<Array<{ start: string; end: string }>> {
  const body = JSON.stringify({
    timeMin,
    timeMax,
    items: calendarIds.map((id) => ({ id })),
  });

  const { status, text } = await googleHttpsRequestWithRetry(
    {
      hostname: 'www.googleapis.com',
      path: '/calendar/v3/freeBusy',
      method: 'POST',
      accessToken: accessToken.trim(),
      headers: { 'Content-Type': 'application/json' },
      body,
    },
    { operation: 'calendar.freebusy.query' },
  );

  let parsed: GCalFreeBusyJson;
  try {
    parsed = JSON.parse(text) as GCalFreeBusyJson;
  } catch {
    logger.error('Google freebusy returned non-JSON', {
      status,
      bodyPreview: text.slice(0, 400),
    });
    throw new Error(`Google freebusy returned invalid response (${status})`);
  }

  if (status >= 400 || parsed.error) {
    logger.error('Google freebusy rejected', { status, error: parsed.error });
    throw new Error(`Google freebusy error: ${parsed.error?.message ?? `http_${status}`}`);
  }

  const busy = parsed.calendars?.primary?.busy ?? [];
  return busy
    .filter((b): b is { start: string; end: string } => Boolean(b.start && b.end))
    .map((b) => ({ start: b.start, end: b.end }));
}
