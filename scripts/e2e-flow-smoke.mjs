/**
 * Live E2E smoke for calendar/scheduling flows (API-level).
 * Usage: node scripts/e2e-flow-smoke.mjs [baseUrl]
 */
import 'dotenv/config';

const baseUrl = process.argv[2] ?? 'http://localhost:3010';

async function main() {
  const { getSupabase } = await import('../dist/src/db/client.js').catch(() =>
    import('../src/db/client.ts'),
  );
  const { createSession } = await import('../dist/src/middleware/session.js').catch(() =>
    import('../src/middleware/session.ts'),
  );
  const { getPolicy } = await import('../dist/src/db/users.js').catch(() =>
    import('../src/db/users.ts'),
  );

  const sb = getSupabase();
  const { data: users, error } = await sb.from('users').select('id,email').limit(1);
  if (error || !users?.length) {
    console.error('No users in DB:', error?.message ?? 'empty');
    process.exit(1);
  }
  const user = users[0];
  const token = await createSession(user.id, user.email);
  const policy = await getPolicy(user.id);
  const tz = policy?.timezone ?? 'Asia/Kolkata';

  const cookieJar = `caladdin_session=${token}`;
  let csrfToken = null;
  let csrfCookie = null;

  async function apiFetch(path, options = {}) {
    const headers = { ...(options.headers ?? {}) };
    if (csrfToken) headers['x-csrf-token'] = csrfToken;
    const cookies = [cookieJar];
    if (csrfCookie) cookies.push(`caladdin_csrf=${csrfCookie}`);
    if (options.headers?.Cookie) {
      headers.Cookie = options.headers.Cookie;
    } else {
      headers.Cookie = cookies.join('; ');
    }
    const res = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers,
      body: options.body,
      method: options.method ?? 'GET',
    });
    const setCookie = res.headers.getSetCookie?.() ?? [];
    for (const c of setCookie) {
      const m = c.match(/caladdin_csrf=([^;]+)/);
      if (m) csrfCookie = decodeURIComponent(m[1]);
    }
    return res;
  }

  const csrfRes = await apiFetch('/api/csrf-token');
  const csrfBody = await csrfRes.json();
  csrfToken = csrfBody.csrfToken ?? csrfToken;
  csrfCookie = csrfCookie ?? csrfToken;

  console.log(`User: ${user.email} (${user.id}), tz=${tz}, base=${baseUrl}`);

  async function voice(utterance, label) {
    const res = await apiFetch('/voice', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ utterance, source: 'text' }),
    });
    const body = await res.json();
    const reply = body.messageToUser ?? body.reply ?? body.error ?? JSON.stringify(body);
    console.log(`\n--- ${label} ---`);
    console.log(`> ${utterance}`);
    console.log(`[${res.status}] ${String(reply).slice(0, 500)}`);
    return { status: res.status, reply: String(reply), body };
  }

  const results = [];

  // Scenario 1: multi-turn scheduling (clear prior agent state)
  const { clearAgentChatSession } = await import('../src/agent/agent-chat-session.ts');
  const { clearAgentSchedulingTask } = await import('../src/agent/agent-scheduling-state.ts');
  await clearAgentChatSession(user.id);
  await clearAgentSchedulingTask(user.id);

  const t1 = await voice('schedule a meeting with aniket@opika.co', 'Multi-turn turn 1');
  const t1SentLink = /sent a scheduling invite/i.test(t1.reply);
  results.push({
    scenario: 'multi-turn-1',
    ...t1,
    pass: t1.status === 200 && !t1SentLink,
    t1SentLink,
  });

  const t2 = await voice('monday at 10 pm ist', 'Multi-turn turn 2');
  const reasksEmail = /\b(email|invitee|who should i invite|what.*email|which email)\b/i.test(t2.reply);
  const executed =
    /\b(done|booked|scheduled|created|on your calendar|invite sent|i've scheduled)\b/i.test(t2.reply) ||
    t2.body?.toolCalls?.some?.((t) =>
      ['create_event', 'send_invite'].includes(t.name) && t.result?.ok !== false,
    );
  results.push({
    scenario: 'multi-turn-2',
    ...t2,
    pass: t2.status === 200 && !reasksEmail && executed,
    reasksEmail,
    executed,
  });

  // Scenario 2: calendar list
  const t3 = await voice('what is on my calendar', 'Calendar list');
  const listsEvents =
    /here is what i see|nothing on your calendar|no meetings|meeting|event|calendar/i.test(t3.reply);
  results.push({ scenario: 'calendar-list', ...t3, pass: t3.status === 200 && listsEvents });

  // Scenario 3: meeting count
  const t4 = await voice('how many meetings today', 'Meeting count');
  const countsMeetings = /\d+ meeting|no meetings|you have \d/i.test(t4.reply);
  results.push({ scenario: 'meeting-count', ...t4, pass: t4.status === 200 && countsMeetings });

  // Scenario 4: context preserved
  const t5 = await voice('what about tomorrow', 'Context follow-up');
  const contextOk =
    t5.status === 200 &&
    (/tomorrow|nothing on your calendar|here is what i see|no meetings/i.test(t5.reply) ||
      t5.body?.prefilter === 'query');
  results.push({ scenario: 'context-preserved', ...t5, pass: contextOk });

  console.log('\n=== SUMMARY ===');
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.scenario}`);
  }
  process.exit(results.every((r) => r.pass) ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
