#!/usr/bin/env node
/**
 * Verify staging/production emits structured logs after log drain setup.
 * Generates a health-check request and prints verification steps for Datadog/Axiom.
 *
 * Usage:
 *   node scripts/verify-log-drain.mjs --base-url https://caladdin-staging.onrender.com
 *   node scripts/verify-log-drain.mjs --base-url $CALADDIN_BASE_URL --service caladdin-staging-web
 */
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    'base-url': { type: 'string' },
    service: { type: 'string', default: 'caladdin-web' },
  },
});

const baseUrl = (values['base-url'] ?? process.env.CALADDIN_BASE_URL ?? '').replace(/\/$/, '');
const service = values.service ?? 'caladdin-web';

if (!baseUrl) {
  console.error('Usage: node scripts/verify-log-drain.mjs --base-url https://your-app.onrender.com');
  process.exit(1);
}

async function main() {
  const started = Date.now();
  let status = 0;
  let body = '';

  try {
    const res = await fetch(`${baseUrl}/health`);
    status = res.status;
    body = await res.text();
  } catch (err) {
    console.error(`FAIL: Could not reach ${baseUrl}/health — ${err.message}`);
    process.exit(1);
  }

  console.log(`Health check: HTTP ${status} (${Date.now() - started}ms)`);
  console.log(body.slice(0, 200));

  console.log('\n--- Log drain verification checklist ---');
  console.log('1. Render Dashboard → caladdin (web) → Integrations → Log Streams → status Active');
  console.log('2. Within 2–5 minutes, search your aggregator:');
  console.log(`   Datadog: service:${service} @message:*health*`);
  console.log(`   Axiom:   ['caladdin-staging'] | where message contains "health" | take 5`);
  console.log('3. Confirm JSON fields parse: ts, level, message, service, requestId');
  console.log('4. Optional: trigger error safely (401 on /jobs with bad key) and search level:error');
  console.log('\nSee docs/ops/MONITORING_SETUP.md and docs/ops/HEALTH_CHECK_ALERT.template.md');
}

main();
