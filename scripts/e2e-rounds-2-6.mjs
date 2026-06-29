/**
 * Live API E2E for Rounds 2–6 (guest scheduling, public book, voice confirm).
 * Usage: npx tsx scripts/e2e-rounds-2-6.mjs [baseUrl]
 */
import 'dotenv/config';

const baseUrl = process.argv[2] ?? 'http://localhost:3001';
const TOKEN_RE = /\/s\/([a-zA-Z0-9_-]+)/;
const BOOK_RE = /\/book\/([^/\s]+)\/([^/\s]+)/;

async function main() {
  const { getSupabase } = await import('../src/db/client.ts');
  const { createSession } = await import('../src/middleware/session.ts');
  const { getPolicy } = await import('../src/db/users.ts');
  const { clearAgentChatSession } = await import('../src/agent/agent-chat-session.ts');
  const { clearAgentSchedulingTask } = await import('../src/agent/agent-scheduling-state.ts');

  const sb = getSupabase();
  const { data: users, error } = await sb.from('users').select('id,email,username').limit(1);
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
    headers.Cookie = cookies.join('; ');
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
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    return { res, body, text };
  }

  const csrfRes = await apiFetch('/api/csrf-token');
  csrfToken = csrfRes.body.csrfToken ?? csrfToken;
  csrfCookie = csrfCookie ?? csrfToken;

  console.log(`User: ${user.email} (${user.id}), tz=${tz}, base=${baseUrl}\n`);

  const results = [];

  async function voice(utterance, label) {
    const { res, body } = await apiFetch('/voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ utterance, source: 'text' }),
    });
    const reply = body.messageToUser ?? body.reply ?? body.error ?? JSON.stringify(body);
    console.log(`--- ${label} ---`);
    console.log(`> ${utterance}`);
    console.log(`[${res.status}] ${String(reply).slice(0, 600)}`);
    return { status: res.status, reply: String(reply), body };
  }

  await clearAgentChatSession(user.id);
  await clearAgentSchedulingTask(user.id);

  // Round 2: OFFER_SPECIFIC scheduling link + guest select
  const r2host = await voice('Find 2 slots for aniket@opika.co next week', 'Round 2 host');
  const schedMatch = r2host.reply.match(TOKEN_RE);
  const schedToken = schedMatch?.[1] ?? null;
  let r2guest = { status: 0, text: 'no token' };
  if (schedToken) {
    const page = await apiFetch(`/s/${schedToken}`);
    const hasSlots = typeof page.text === 'string' && /slot|Select|Book/i.test(page.text);
    console.log(`\n--- Round 2 guest page ---`);
    console.log(`[${page.res.status}] slots visible: ${hasSlots}`);

    const slotIdxMatch = page.text.match(/data-slot-index="(\d+)"/);
    const slotIdx = slotIdxMatch ? Number(slotIdxMatch[1]) : 0;
    r2guest = await apiFetch(`/s/${schedToken}/select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slotIndex: slotIdx,
        guest: { name: 'Aniket Guest', email: 'aniket@opika.co' },
      }),
    });
    console.log(`--- Round 2 guest select ---`);
    console.log(`[${r2guest.res.status}] ${JSON.stringify(r2guest.body).slice(0, 400)}`);
  }
  results.push({
    scenario: 'round-2-scheduling-link',
    pass:
      r2host.status === 200 &&
      !!schedToken &&
      r2guest.res?.status === 200 &&
      (r2guest.body?.success !== false),
    schedToken,
  });

  // Round 3: next slot
  await clearAgentChatSession(user.id);
  await clearAgentSchedulingTask(user.id);
  const r3host = await voice('Find 2 slots for aniket@opika.co next week', 'Round 3 host (new link)');
  const r3token = r3host.reply.match(TOKEN_RE)?.[1] ?? null;
  let r3next = { status: 0 };
  if (r3token) {
    r3next = await apiFetch(`/s/${r3token}/next-slots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    console.log(`\n--- Round 3 next-slots ---`);
    console.log(`[${r3next.res.status}] ${JSON.stringify(r3next.body).slice(0, 400)}`);
  }
  results.push({
    scenario: 'round-3-next-slot',
    pass:
      r3host.status === 200 &&
      !!r3token &&
      (r3next.res?.status === 200 || r3next.body?.no_more_slots === true),
  });

  // Round 4: guest propose + host accept
  await clearAgentChatSession(user.id);
  await clearAgentSchedulingTask(user.id);
  const r4host = await voice('Find 2 slots for aniket@opika.co next week', 'Round 4 host');
  const r4token = r4host.reply.match(TOKEN_RE)?.[1] ?? null;
  let r4propose = { status: 0 };
  let r4accept = { status: 0, reply: '' };
  if (r4token) {
    const nextWeek = new Date(Date.now() + 7 * 86400000);
    const proposeStart = new Date(nextWeek);
    proposeStart.setHours(14, 0, 0, 0);
    const proposeEnd = new Date(proposeStart);
    proposeEnd.setMinutes(proposeEnd.getMinutes() + 30);
    const proposedDate = proposeStart.toISOString().slice(0, 10);
    const proposedTimeWindow = `${proposeStart.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })} – ${proposeEnd.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
    r4propose = await apiFetch(`/s/${r4token}/propose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        proposedDate,
        proposedTimeWindow,
        guest: { name: 'Aniket Guest', email: 'aniket@opika.co' },
        note: 'E2E propose test',
      }),
    });
    console.log(`\n--- Round 4 propose ---`);
    console.log(`[${r4propose.res.status}] ${JSON.stringify(r4propose.body).slice(0, 400)}`);

    r4accept = await voice(`accept proposal 0 ${r4token}`, 'Round 4 host accept');
  }
  results.push({
    scenario: 'round-4-propose-accept',
    pass:
      r4host.status === 200 &&
      !!r4token &&
      r4propose.res?.status === 200 &&
      r4accept.status === 200 &&
      !/only help with your calendar/i.test(r4accept.reply) &&
      /\b(added|booked|scheduled|confirmed|calendar|accepted)\b/i.test(r4accept.reply),
  });

  // Round 5: public booking link
  const slug = `e2e-${Date.now()}`;
  const createEt = await apiFetch('/api/event-types', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'E2E Test Meeting',
      slug,
      durationMinutes: 30,
      description: 'E2E round 5',
    }),
  });
  console.log(`\n--- Round 5 create event type ---`);
  console.log(`[${createEt.res.status}] ${JSON.stringify(createEt.body).slice(0, 300)}`);
  const username = user.username ?? createEt.body?.eventType?.publicUrl?.match(/\/book\/([^/]+)/)?.[1] ?? '_';
  const bookSlug = createEt.body?.eventType?.slug ?? createEt.body?.slug ?? slug;
  const slotsRes = await apiFetch(`/book/${username}/${bookSlug}/slots?daysAhead=30`);
  const slots = slotsRes.body?.slots ?? [];
  console.log(`--- Round 5 slots API ---`);
  console.log(`[${slotsRes.res.status}] slots: ${slots.length}`);
  const bookPageOk = createEt.res.status === 201 && slots.length > 0;
  let r5select = { res: { status: 0 } };
  if (bookPageOk) {
    for (const slot of slots.slice(0, 20)) {
      r5select = await apiFetch(`/book/${username}/${bookSlug}/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slotStart: slot.start,
          daysAhead: 30,
          guest: { name: 'Public Guest', email: 'guest@example.test' },
        }),
      });
      if (r5select.res.status === 200 || r5select.res.status === 201) break;
    }
    console.log(`--- Round 5 book select ---`);
    console.log(`[${r5select.res.status}] ${JSON.stringify(r5select.body).slice(0, 400)}`);
  }
  results.push({
    scenario: 'round-5-public-book',
    pass: createEt.res.status === 200 || createEt.res.status === 201
      ? bookPageOk && (r5select.res?.status === 200 || r5select.res?.status === 201)
      : false,
  });

  // Round 6: voice confirm (cancel tomorrow)
  await clearAgentChatSession(user.id);
  await clearAgentSchedulingTask(user.id);
  const r6cancel = await voice('cancel tomorrow', 'Round 6 cancel (confirm?)');
  const needsConfirm = r6cancel.body?.requiresConfirmation === true;
  const confirmToken = r6cancel.body?.confirmationToken ?? null;
  let r6reject = { status: 0 };
  let r6approve = { status: 0 };
  if (needsConfirm && confirmToken) {
    r6reject = await apiFetch(`/voice/confirm/${confirmToken}/reject`, { method: 'POST' });
    console.log(`\n--- Round 6 reject ---`);
    console.log(`[${r6reject.res.status}] ${JSON.stringify(r6reject.body).slice(0, 200)}`);

    const r6cancel2 = await voice('cancel tomorrow', 'Round 6 cancel retry');
    const token2 = r6cancel2.body?.confirmationToken;
    if (token2) {
      r6approve = await apiFetch(`/voice/confirm/${token2}/approve`, { method: 'POST' });
      console.log(`--- Round 6 approve ---`);
      console.log(`[${r6approve.res.status}] ${JSON.stringify(r6approve.body).slice(0, 200)}`);
    }
  }
  results.push({
    scenario: 'round-6-voice-confirm',
    pass:
      r6cancel.status === 200 &&
      (needsConfirm
        ? !!confirmToken && r6reject.res?.status === 200
        : /\bcancel/i.test(r6cancel.reply)),
    needsConfirm,
  });

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
