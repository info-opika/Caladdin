#!/usr/bin/env node
/**
 * Cycle 2 full regression checklist — Agent 2 (Tester)
 * Usage: node scripts/cycle2-regression-eval.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
try {
  for (const line of readFileSync(join(root, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch {
  // optional
}

const { runSchedulingAgent } = await import('../dist/src/agent/scheduling-agent.js');
const {
  clearAgentChatSession,
  _setAgentChatSessionStorageForTests,
} = await import('../dist/src/agent/agent-chat-session.js');

const userId = process.env.CALADDIN_EVAL_USER ?? '4f65dc65-12ea-485f-99bf-5935d4deb8aa';
const tz = 'America/Chicago';
_setAgentChatSessionStorageForTests(false);

const ISO_TIME_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const HUMAN_TIME_RE = /\d{1,2}:\d{2}\s*(am|pm)/i;
const COT_LEAK_RE =
  /\b(let me think|i need to (check|analyze|determine)|step \d|chain.of.thought|reasoning:|first,? i('|')ll)\b/i;

const results = [];

function record(id, name, pass, evidence, status = pass ? 'PASS' : 'FAIL') {
  results.push({ id, name, status, evidence });
  const icon = status === 'PASS' ? '✓' : status === 'SKIP' ? '○' : '✗';
  console.log(`${icon} [${id}] ${name}: ${status}`);
  console.log(`    ${evidence.slice(0, 300)}`);
}

function hasRawIso(text) {
  return ISO_TIME_RE.test(text);
}

function hasHumanTime(text) {
  return HUMAN_TIME_RE.test(text);
}

function toolNames(result) {
  return result.toolCalls.map((t) => t.name);
}

function blockLabel(result) {
  const block = result.toolCalls.find((t) => t.name === 'create_recurring_block');
  if (block?.input?.label) return String(block.input.label);
  const m = result.reply.match(/blocked[^—]*—\s*([^(\n]+)/i) ?? result.reply.match(/"([^"]+)"/);
  return m?.[1]?.trim() ?? '';
}

async function runTurn(utterance, reqId) {
  return runSchedulingAgent(utterance, { userId, requestId: reqId, timezone: tz }, []);
}

async function runMultiTurn(turns, prefix) {
  const outs = [];
  for (let i = 0; i < turns.length; i += 1) {
    outs.push(await runTurn(turns[i], `${prefix}-t${i + 1}`));
  }
  return outs;
}

async function freshSession() {
  await clearAgentChatSession(userId).catch(() => undefined);
}

// --- Single-turn tests ---
async function testOffTopicFrance() {
  await freshSession();
  const r = await runTurn('What is the capital of France?', 'off-france');
  const refused =
    !/\bparis\b/i.test(r.reply) &&
    (/calendar/i.test(r.reply) || /scheduling/i.test(r.reply) || /can't help/i.test(r.reply));
  record(
    'ST-1a',
    'Off-topic France → calendar refusal',
    refused,
    `reply: ${r.reply.slice(0, 200)} | tools: ${toolNames(r).join(',') || 'none'}`,
  );
}

async function testOffTopicWeather() {
  await freshSession();
  const r = await runTurn('What is the weather in Austin?', 'off-weather');
  const refused =
    !/\b(rain|sunny|degrees|forecast|°)\b/i.test(r.reply) &&
    (/calendar/i.test(r.reply) || /scheduling/i.test(r.reply) || /can't help/i.test(r.reply));
  record(
    'ST-1b',
    'Off-topic weather → calendar refusal',
    refused,
    `reply: ${r.reply.slice(0, 200)} | tools: ${toolNames(r).join(',') || 'none'}`,
  );
}

async function testCalendarHumanReadable(day) {
  await freshSession();
  const utterance =
    day === 'today'
      ? 'What is on my calendar today?'
      : day === 'tomorrow'
        ? 'What meetings do I have tomorrow?'
        : 'What is on my calendar this week?';
  const r = await runTurn(utterance, `cal-${day}`);
  const usedSummary = toolNames(r).includes('get_calendar_summary') || /calendar/i.test(r.reply);
  const noIso = !hasRawIso(r.reply);
  const humanOk = r.reply.includes('Nothing on your calendar') || hasHumanTime(r.reply) || !/\d{4}-\d{2}-\d{2}T/.test(r.reply);
  const pass = usedSummary && noIso && humanOk;
  record(
    `ST-2-${day}`,
    `Calendar ${day} → human-readable times`,
    pass,
    `reply snippet: ${r.reply.slice(0, 250).replace(/\n/g, ' ')} | iso=${hasRawIso(r.reply)} human=${hasHumanTime(r.reply)}`,
  );
}

async function testFreeBusy() {
  await freshSession();
  const r = await runTurn('Am I free Friday at 3pm?', 'free-busy');
  const intelligent =
    /\b(free|busy|available|booked|open|conflict|meeting|nothing)\b/i.test(r.reply) ||
    toolNames(r).some((n) => /check_specific_slot|find_available|calendar/i.test(n));
  record(
    'ST-3',
    'Free/busy Friday 3pm → intelligent answer',
    intelligent,
    `reply: ${r.reply.slice(0, 220)} | tools: ${toolNames(r).join(',') || 'none'}`,
  );
}

async function testOneShotTeamLunch() {
  await freshSession();
  const r = await runTurn(
    'Block 1 hour for lunch tomorrow 12pm to 1pm Texas time titled Team Lunch',
    'team-lunch',
  );
  const label = blockLabel(r);
  const pass = /team lunch/i.test(label) || /team lunch/i.test(r.reply);
  record(
    'ST-4',
    'One-shot titled Team Lunch → correct label',
    pass,
    `label=${label || '(none)'} | reply: ${r.reply.slice(0, 200)} | tools: ${toolNames(r).join(',')}`,
  );
}

// --- Multi-turn tests ---
async function testMeditation() {
  await freshSession();
  const turns = [
    'Block 30 minutes for meditation',
    'Everyday from 7 AM Texas time to 7:30 AM Texas time',
    'Meditation Time',
  ];
  const outs = await runMultiTurn(turns, 'meditation');
  const last = outs[outs.length - 1];
  const label = blockLabel(last);
  const turn3Works =
    /meditation time/i.test(label) ||
    (/meditation/i.test(last.reply) && toolNames(last).includes('create_recurring_block'));
  const turn2Ok = !/garbage|error/i.test(outs[1].reply);
  record(
    'MT-1',
    'Meditation multi-turn → Meditation Time label',
    turn3Works && turn2Ok,
    `t2: ${outs[1].reply.slice(0, 120)} | t3 label=${label} reply: ${last.reply.slice(0, 150)}`,
  );
}

async function testGym() {
  await freshSession();
  const turns = [
    'Block 45 minutes for gym',
    'Every day from 6 AM to 6:45 AM Texas time',
    'Morning Gym',
  ];
  const outs = await runMultiTurn(turns, 'gym');
  const last = outs[outs.length - 1];
  const label = blockLabel(last);
  const noGarbage = !/for gym every day|block 45|every day from 6/i.test(label);
  const correct = /morning gym/i.test(label) || /morning gym/i.test(last.reply);
  const noCot = !COT_LEAK_RE.test(last.reply);
  record(
    'MT-2',
    'Gym multi-turn → Morning Gym label, no garbage',
    correct && noGarbage && noCot,
    `label=${label} | cot_leak=${COT_LEAK_RE.test(last.reply)} | reply: ${last.reply.slice(0, 180)}`,
  );
}

async function testDeepWork() {
  await freshSession();
  const turns = ['Protect deep work on weekdays from 9 to 11 AM Texas time', 'For the next 4 weeks'];
  const outs = await runMultiTurn(turns, 'deep-work');
  const last = outs[outs.length - 1];
  const label = blockLabel(last);
  const notDurationPhrase = !/for the next 4 weeks/i.test(label);
  const correct = /deep work/i.test(label) || (/deep work/i.test(last.reply) && !/for the next 4 weeks/i.test(last.reply));
  record(
    'MT-3',
    'Deep work → Deep Work label not duration phrase',
    correct && notDurationPhrase,
    `label=${label} | t2 reply: ${last.reply.slice(0, 200)}`,
  );
}

// --- Additional tests ---
async function testCalendarDuringSession() {
  await freshSession();
  await runTurn('Block 30 minutes for meditation', 'sess-cal-1');
  const r = await runTurn('What is on my calendar tomorrow?', 'sess-cal-2');
  const isSummary =
    toolNames(r).includes('get_calendar_summary') ||
    (/calendar/i.test(r.reply) && !toolNames(r).includes('create_recurring_block'));
  const notBlock = !toolNames(r).includes('create_recurring_block');
  record(
    'AD-1',
    'Calendar query during active session → summary not block',
    isSummary && notBlock,
    `tools: ${toolNames(r).join(',') || 'none'} | reply: ${r.reply.slice(0, 200)}`,
  );
}

async function testOverlapNoFalsePositive() {
  await freshSession();
  const r = await runTurn(
    'Block 30 minutes every day from 7 AM to 7:30 AM Texas time titled Morning Meditation',
    'overlap-7am',
  );
  const reply = r.reply.toLowerCase();
  const warnsOverlap = /overlap|conflict|already have/i.test(reply);
  const falsePm =
    warnsOverlap && (/5:30\s*pm|17:30|5\.30\s*pm/i.test(r.reply) || /evening/i.test(r.reply));
  const pass = !falsePm;
  record(
    'AD-2',
    '7 AM block overlap should not flag 5:30 PM events',
    pass,
    `overlap_warn=${warnsOverlap} false_pm=${falsePm} | reply: ${r.reply.slice(0, 280)}`,
  );
}

async function main() {
  console.log('=== Caladdin Cycle 2 Regression Eval ===\n');

  await testOffTopicFrance();
  await testOffTopicWeather();
  for (const day of ['today', 'tomorrow', 'week']) {
    await testCalendarHumanReadable(day);
  }
  await testFreeBusy();
  await testOneShotTeamLunch();
  await testMeditation();
  await testGym();
  await testDeepWork();
  await testCalendarDuringSession();
  await testOverlapNoFalsePositive();

  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const skipped = results.filter((r) => r.status === 'SKIP').length;

  console.log('\n=== SUMMARY ===');
  console.log(`PASS: ${passed} | FAIL: ${failed} | SKIP: ${skipped}`);
  if (failed > 0) {
    console.log('\nFailed:');
    for (const r of results.filter((x) => x.status === 'FAIL')) {
      console.log(`  - [${r.id}] ${r.name}`);
    }
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
