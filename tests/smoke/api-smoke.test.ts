/**
 * Layer 3 — API Smoke Tests
 *
 * Fires real HTTP requests against the live local server (localhost:3000).
 * Skips gracefully if the server is not reachable.
 *
 * Run: npm run test:smoke
 * Requires: server running (`npm run dev`) and session cookie auth (not API key).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { CALADDIN_USER_COOKIE } from '../../src/constants.js';
import { ensureDefaultUserProfile } from '../../src/db/policies.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../../.env') });

const BASE_URL = process.env['SMOKE_BASE_URL'] ?? 'http://localhost:3000';
const TEST_USER_ID = '77a22c75-4e6b-47ca-aee6-2f4ace21be53';
const TIMEOUT_MS = 30_000;

let serverAvailable = false;

async function checkServerAvailable(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${BASE_URL}/health`, { signal: controller.signal });
    clearTimeout(id);
    return res.status === 200;
  } catch {
    return false;
  }
}

beforeAll(async () => {
  serverAvailable = await checkServerAvailable();
  if (!serverAvailable) {
    console.log(`ℹ️  Server not reachable at ${BASE_URL} — smoke tests will be skipped`);
    return;
  }
  if (process.env['SUPABASE_URL']) {
    try {
      await ensureDefaultUserProfile(TEST_USER_ID);
    } catch (err) {
      console.warn('ℹ️  Could not seed smoke test user policy:', err);
    }
  }
});

function sessionCookie(): Record<string, string> {
  return { Cookie: `${CALADDIN_USER_COOKIE}=${TEST_USER_ID}` };
}

async function post(path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(id);
  }
}

async function get(path: string): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${BASE_URL}${path}`, { signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

describe('smoke: health check', () => {
  it('GET /health returns 200 { status: ok }', async ({ skip }) => {
    if (!serverAvailable) return skip();
    const res = await get('/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('ok');
  });
});

describe('smoke: auth required', () => {
  it('POST /voice without session cookie returns 401', async ({ skip }) => {
    if (!serverAvailable) return skip();
    const res = await post('/voice', { utterance: 'test', userId: TEST_USER_ID });
    expect(res.status).toBe(401);
  });
});

const CANONICAL_UTTERANCES: Array<{ utterance: string; expectedIntent: string }> = [
  {
    utterance:
      "block 9 am to 10 am all weekdays for next four weeks. name the event 'Smoke canonical block'",
    expectedIntent: 'PROTECT_BLOCK',
  },
  { utterance: 'Find me 2 slots to meet with Alex next week', expectedIntent: 'OFFER_SPECIFIC' },
  { utterance: 'Clear my calendar Friday except the board call', expectedIntent: 'FLUSH_RANGE' },
  { utterance: 'Move my 3pm to tomorrow', expectedIntent: 'MODIFY_EVENT' },
  { utterance: "Tell John I can't do a call, send him Loom instead", expectedIntent: 'PIVOT_ASYNC' },
  { utterance: "I don't want any meetings before 9am ever", expectedIntent: 'SHAPE_RULES' },
  { utterance: 'Treat anything from sarah@enterprise.com as high priority', expectedIntent: 'GATEKEEP_RULE' },
  { utterance: 'My Thursday is a mess, help', expectedIntent: 'RESOLVE_MANUAL' },
  { utterance: 'What time is it in Tokyo', expectedIntent: 'WARM_REDIRECT' },
  { utterance: 'Book a haircut appointment', expectedIntent: 'OFFER_SPECIFIC' },
  { utterance: 'I need to protect my lunch', expectedIntent: 'RESOLVE_MANUAL' },
  { utterance: 'Cancel tomorrow completely', expectedIntent: 'FLUSH_RANGE' },
];

describe('smoke: 12 canonical utterances (live LLM)', () => {
  for (const { utterance, expectedIntent } of CANONICAL_UTTERANCES) {
    it(`"${utterance.slice(0, 48)}…" → ${expectedIntent}`, async ({ skip }) => {
      if (!serverAvailable) return skip();
      const start = Date.now();
      const res = await post('/voice', { utterance }, sessionCookie());
      const elapsed = Date.now() - start;

      expect(res.status, `HTTP for: ${utterance}`).toBe(200);
      expect(elapsed).toBeLessThan(TIMEOUT_MS);

      const body = (await res.json()) as {
        intent: string;
        success: boolean;
        messageToUser?: string;
        requiresConfirmation: boolean;
      };

      expect(body.intent, `intent for: ${utterance}`).toBe(expectedIntent);
      expect(typeof body.success).toBe('boolean');
      expect(typeof body.requiresConfirmation).toBe('boolean');
      if (body.messageToUser !== undefined) {
        expect(typeof body.messageToUser).toBe('string');
      }
    }, TIMEOUT_MS + 5000);
  }
});

const SCHEDULING_SMOKE: Array<{ utterance: string; allowedIntents: string[] }> = [
  { utterance: "What's on my calendar today", allowedIntents: ['QUERY_CALENDAR'] },
  {
    utterance: 'find time with test@example.com next week 9am to 5pm',
    allowedIntents: ['SCHEDULING_LINK', 'OFFER_SPECIFIC', 'RESOLVE_MANUAL'],
  },
];

describe('smoke: scheduling and calendar reads', () => {
  for (const { utterance, allowedIntents } of SCHEDULING_SMOKE) {
    it(`scheduling/calendar smoke: ${utterance.slice(0, 40)}`, async ({ skip }) => {
      if (!serverAvailable) return skip();
      const res = await post('/voice', { utterance }, sessionCookie());
      expect(res.status).toBe(200);
      const body = (await res.json()) as { intent: string };
      expect(allowedIntents).toContain(body.intent);
    }, TIMEOUT_MS + 5000);
  }
});
