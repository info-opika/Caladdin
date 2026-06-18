#!/usr/bin/env node
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
  getAgentChatHistory,
  clearAgentChatSession,
  _setAgentChatSessionStorageForTests,
} = await import('../dist/src/agent/agent-chat-session.js');

const userId = process.env.CALADDIN_EVAL_USER ?? '4f65dc65-12ea-485f-99bf-5935d4deb8aa';
const tz = 'America/Chicago';

_setAgentChatSessionStorageForTests(false);

const scenarios = [
  {
    name: 'Meditation multi-turn (exact user flow)',
    turns: [
      'Block 30 minutes for meditation',
      'Everyday from 7 AM Texas time to 7:30 AM Texas time',
      'Meditation Time',
      'Recurring every day',
    ],
  },
  {
    name: 'Calendar query',
    turns: ['What is on my calendar today?'],
  },
  {
    name: 'Off-topic fresh session',
    turns: ['What is the capital of France?'],
  },
];

for (const scenario of scenarios) {
  console.log(`\n=== ${scenario.name} ===`);
  await clearAgentChatSession(userId).catch(() => undefined);

  let turn = 0;
  for (const utterance of scenario.turns) {
    turn += 1;
    const result = await runSchedulingAgent(
      utterance,
      { userId, requestId: `live-eval-${turn}`, timezone: tz },
      [],
    );
    const tools =
      result.toolCalls.map((t) => `${t.name}${t.result.ok ? ':ok' : ':fail'}`).join(', ') || 'none';
    const via = result.trace?.prefilterBypass ? 'prefilter' : 'llm';
    console.log(`Turn ${turn} USER: ${utterance}`);
    console.log(`       BOT: ${result.reply.replace(/\n/g, ' ').slice(0, 240)}`);
    console.log(`       via: ${via} | tools: ${tools} | rounds: ${result.rounds}`);
    const hist = await getAgentChatHistory(userId);
    console.log(`       session turns stored: ${hist.length}`);
  }
}
