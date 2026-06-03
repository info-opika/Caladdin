import fs from 'fs';

const r = JSON.parse(fs.readFileSync('tests/_agent5_run.json', 'utf8'));

function esc(s) {
  s = String(s ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const fixes = {
  'tests/integration/orchestrator.test.ts|WARM redirect returns calendar-only guidance': {
    why: 'Test expected WARM_REDIRECT intent; enum lacked value and orchestrator returned RESOLVE_MANUAL for off-topic.',
    iteration_1_fix:
      'Agent4: added WARM_REDIRECT to IntentEnum in adts.ts; orchestrator early-return with isWarmRedirect + CALENDAR_ONLY_MESSAGE. WHY: align with spec off-topic warm redirect.',
  },
  'tests/unit/safety.test.ts|*': {
    why: 'safety.test.ts imported checkMutation/validateUser not exported from safety.ts.',
    iteration_1_fix:
      'Agent4: added checkMutation(intent,event,profile) and validateUser(userId) shims in safety.ts. WHY: restore contract expected by unit tests without weakening validation.',
  },
  'tests/unit/slot-scoring-protected-blocks.test.ts|ignores cancelled events when building busy list': {
    why: 'Cancelled DB events were treated as busy; also generateSlots now returns only top-2 fax-scored slots so 1pm may be omitted when morning slots score higher.',
    iteration_1_fix:
      'Agent4: filter listEvents where status !== cancelled in slot-scoring.ts; refactor to protected-block overlap + selectTopSlots fax scoring. WHY: cancelled events must not block offers.',
    iteration_2_fix: '',
  },
  'tests/integration/auth-oauth-mvp.test.ts|GET /auth/start redirects to Google with invite in signed state': {
    why: 'OAuth /auth/start must embed invite (and ref/token) in signed state query param for Google redirect.',
    iteration_1_fix:
      'Agent4: buildOAuthState JSON payload + parseOAuthState in auth.ts; /auth/start passes invite/ref/token into state. WHY: platform invite attribution on signup.',
    iteration_2_fix: '',
  },
};

const rows = [];
rows.push(
  [
    'test_id',
    'file',
    'test_name',
    'status',
    'failure_message',
    'why',
    'iteration_1_fix',
    'iteration_2_fix',
    'pm_notes',
  ].join(','),
);

const failed = (r.testResults || []).flatMap((f) =>
  (f.assertionResults || []).filter((a) => a.status === 'failed'),
);

rows.push(
  [
    esc('SUMMARY'),
    esc('vitest.config.ts'),
    esc('active MVP suite'),
    esc(failed.length ? 'fail' : 'pass'),
    esc(failed.length ? `${failed.length} failing / ${r.numPassedTests} passed` : `${r.numPassedTests} passed`),
    esc('Suite scoped to implemented src; excludes legacy missing-module tests'),
    esc(
      'Iter1 Agent4: vitest exclude tests/tests/**. Iter2 Agent4: luxon dep; safety exports; WARM_REDIRECT. Coordinator: narrowed vitest include allowlist.',
    ),
    esc(
      failed.length
        ? 'WIP Agent4: see failing rows iteration_1_fix. OVERSEER_LOG.md'
        : 'Iter2 Agent4: slot-scoring cancelled+fax; auth OAuth state; protect-block clarification. Vitest MVP allowlist (coordinated).',
    ),
    esc(`Agent5 tracker sync ${new Date().toISOString().slice(0, 10)}`),
  ].join(','),
);

let id = 0;
for (const f of r.testResults || []) {
  const file = f.name.replace(/.*Caladdin[/\\]/, '').replace(/\\/g, '/');
  for (const a of f.assertionResults || []) {
    id++;
    const status = a.status === 'passed' ? 'pass' : 'fail';
    const msg = (a.failureMessages || [])[0] || '';
    const failMsg = status === 'fail' ? msg.split('\n')[0] : '';
    const key = `${file}|${a.title}`;
    const fix = fixes[key] || fixes[`${file}|*`] || {};
    rows.push(
      [
        esc(`T${String(id).padStart(3, '0')}`),
        esc(file),
        esc(a.title),
        esc(status),
        esc(failMsg),
        esc(fix.why || ''),
        esc(fix.iteration_1_fix || ''),
        esc(fix.iteration_2_fix || ''),
        esc(''),
      ].join(','),
    );
  }
}

rows.push(
  [
    esc('ALL'),
    esc('*'),
    esc('*'),
    esc(failed.length ? 'fail' : 'pass'),
    esc(failed.length ? `${failed.length} failing` : 'none'),
    esc('Per-test rows above; SUMMARY for Agent4 fix history'),
    esc(''),
    esc(''),
    esc(failed.length ? 'IN_PROGRESS' : 'PIPELINE_COMPLETE'),
  ].join(','),
);

fs.writeFileSync('tests/AGENT_TEST_TRACKER.csv', `${rows.join('\n')}\n`);
console.log(`Wrote ${rows.length - 1} data rows; ${failed.length} failures`);
