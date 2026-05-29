#!/usr/bin/env tsx
import { appendFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const decisionsPath = join(root, 'DECISIONS.md');

const args = process.argv.slice(2);
function getArg(name: string): string {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : '';
}

const category = getArg('category') || 'general';
const decision = getArg('decision');
const reason = getArg('reason');
const alternatives = getArg('alternatives');

if (!decision) {
  console.error('Usage: npx tsx scripts/log-decision.ts --category architecture --decision "..." --reason "..." --alternatives "..."');
  process.exit(1);
}

const entry = `
## ${category} — ${new Date().toISOString().split('T')[0]}

**Decision:** ${decision}

**Reason:** ${reason}

**Alternatives considered:** ${alternatives}
`;

if (!existsSync(decisionsPath)) {
  appendFileSync(decisionsPath, '# Caladdin Decision Log\n');
}
appendFileSync(decisionsPath, entry);
console.log('Logged to DECISIONS.md');
