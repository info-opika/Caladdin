#!/usr/bin/env node
/**
 * Manual 15-utterance agent eval checklist.
 *
 * Usage:
 *   node scripts/agent-eval.mjs                    # POST to local /voice (needs running server + session cookie)
 *   node scripts/agent-eval.mjs --direct           # runSchedulingAgent in-process (needs FREELLMAPI_API_KEY in env)
 *   CALADDIN_BASE_URL=https://caladdin.onrender.com node scripts/agent-eval.mjs --cookie "sid=..."
 *
 * Env:
 *   CALADDIN_BASE_URL  default http://localhost:3000
 *   CALADDIN_EVAL_USER default 11111111-1111-4111-8111-111111111111
 *   SESSION_COOKIE     optional session cookie for /voice
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const UTTERANCES = [
  'block personal time every weekday morning',
  'book a slot on my calendar',
  'invite jane@example.com to a 30 minute meeting',
  'what meetings do I have tomorrow',
  'does Tuesday 3pm work',
  'cancel all meetings Friday afternoon',
  'protect deep work Tuesdays 9 to 11',
  'send an invite to bob@example.com with slots Thursday 2pm Texas time',
  'what is on my calendar this week',
  'schedule a call titled Sync for tomorrow at 10am',
  'what is the weather in Austin',
  'undo my last change',
  'find available slots for a 45 minute meeting next week',
  'check if Friday at 4pm is free',
  'grant calendar access to invitee@example.com for scheduling link tok-demo',
];

const baseUrl = (process.env.CALADDIN_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const userId = process.env.CALADDIN_EVAL_USER ?? '11111111-1111-4111-8111-111111111111';
const direct = process.argv.includes('--direct');
const cookie = process.env.SESSION_COOKIE ?? process.argv.find((a) => a.startsWith('--cookie='))?.slice(9);

function loadDotenv() {
  try {
    const raw = readFileSync(join(root, '.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m || process.env[m[1]]) continue;
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    // optional
  }
}

loadDotenv();

async function runViaVoice(utterance) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (cookie) headers.Cookie = cookie;

  const res = await fetch(`${baseUrl}/voice`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ utterance, source: 'text', userId }),
  });

  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 500) };
  }

  return { status: res.status, body };
}

async function runDirect(utterance, index) {
  process.env.FREELLMAPI_API_KEY = process.env.FREELLMAPI_API_KEY ?? '';
  if (!process.env.FREELLMAPI_API_KEY.trim()) {
    throw new Error('FREELLMAPI_API_KEY required for --direct mode');
  }

  const { runSchedulingAgent } = await import('../dist/src/agent/scheduling-agent.js');
  const result = await runSchedulingAgent(
    utterance,
    { userId, requestId: `eval-${index}`, timezone: 'America/Chicago' },
    [],
  );

  return {
    status: 200,
    body: {
      messageToUser: result.reply,
      agentRounds: result.rounds,
      agentToolCalls: result.toolCalls.map((t) => ({ name: t.name, ok: t.result.ok })),
      trace: result.trace,
    },
  };
}

async function main() {
  console.log(`Caladdin agent eval — ${UTTERANCES.length} utterances`);
  console.log(`Mode: ${direct ? 'direct (runSchedulingAgent)' : `POST ${baseUrl}/voice`}`);
  console.log('---');

  let passed = 0;
  for (let i = 0; i < UTTERANCES.length; i += 1) {
    const utterance = UTTERANCES[i];
    const label = `${String(i + 1).padStart(2, '0')}/${UTTERANCES.length}`;
    process.stdout.write(`${label} "${utterance.slice(0, 60)}${utterance.length > 60 ? '…' : ''}" … `);

    try {
      const { status, body } = direct
        ? await runDirect(utterance, i)
        : await runViaVoice(utterance);

      const ok = status === 200 && (body.messageToUser || body.success !== false);
      if (ok) {
        passed += 1;
        const tools = body.agentToolCalls?.map((t) => t.name).filter(Boolean).join(', ') ?? '';
        const routed = body.trace?.routedViaRounds?.join(' → ') ?? '';
        console.log(`OK (${status})${tools ? ` tools=[${tools}]` : ''}${routed ? ` routed=${routed}` : ''}`);
        if (body.messageToUser) {
          console.log(`    → ${String(body.messageToUser).slice(0, 120)}${String(body.messageToUser).length > 120 ? '…' : ''}`);
        }
      } else {
        console.log(`FAIL (${status})`);
        console.log(`    ${JSON.stringify(body).slice(0, 200)}`);
      }
    } catch (err) {
      console.log('ERROR');
      console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log('---');
  console.log(`Result: ${passed}/${UTTERANCES.length} succeeded`);
  process.exit(passed === UTTERANCES.length ? 0 : 1);
}

main();
