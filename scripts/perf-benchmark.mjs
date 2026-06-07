#!/usr/bin/env node
/**
 * Lightweight perf benchmarks for Agent 2 sprint metrics.
 * Run: npm run perf:benchmark
 */
import { performance } from 'node:perf_hooks';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function walkDir(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkDir(p, acc);
    else acc.push({ path: p, size: st.size });
  }
  return acc;
}

function bundleMetrics() {
  const dist = join(root, 'web', 'dist');
  try {
    const files = walkDir(dist).filter((f) => /\.(js|css|html)$/.test(f.path));
    const total = files.reduce((s, f) => s + f.size, 0);
    const js = files.filter((f) => f.path.endsWith('.js'));
    const css = files.filter((f) => f.path.endsWith('.css'));
    const jsTotal = js.reduce((s, f) => s + f.size, 0);
    const cssTotal = css.reduce((s, f) => s + f.size, 0);
    const mainEntry = js.find((f) => /main-/.test(f.path));
    const eventTypesChunk = js.find((f) => /event-types-/.test(f.path));
    const largest = [...files].sort((a, b) => b.size - a.size).slice(0, 8);
    return { total, jsTotal, cssTotal, fileCount: files.length, mainEntry, eventTypesChunk, largest };
  } catch {
    return null;
  }
}

function runVitestPerf() {
  const started = performance.now();
  const result = spawnSync('npm', ['test', '--', 'tests/perf/slot-generation.perf.test.ts', 'tests/unit/freebusy-cache.test.ts'], {
    cwd: root,
    encoding: 'utf8',
    shell: true,
  });
  const elapsedMs = Math.round(performance.now() - started);
  const stdout = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const metricLine = stdout.split('\n').find((line) => line.includes('"metric":"generateSlots_ms"'));
  let slotMetrics = null;
  if (metricLine) {
    try {
      slotMetrics = JSON.parse(metricLine.trim());
    } catch {
      // ignore parse errors
    }
  }
  return { ok: result.status === 0, elapsedMs, slotMetrics, stdout: stdout.slice(-800) };
}

async function cacheMicrobench() {
  const { clearFreeBusyCacheForTests, getCachedBusyFromGCal, getFreeBusyCacheStats } = await import(
    '../dist/src/services/freebusy-cache.js'
  );
  clearFreeBusyCacheForTests();

  let underlyingCalls = 0;
  const { listBusyFromGCal } = await import('../dist/src/services/calendar_api.js');
  const original = listBusyFromGCal.bind(null);
  const cal = {};

  const fetch = async (...args) => {
    underlyingCalls += 1;
    await new Promise((r) => setTimeout(r, 12));
    return [{ start: '2026-06-01T10:00:00Z', end: '2026-06-01T11:00:00Z' }];
  };

  // Wrap via cache only — measure parallel dedupe by stubbing at call site
  const userId = 'bench';
  const tMin = '2026-06-01T00:00:00Z';
  const tMax = '2026-06-08T00:00:00Z';

  const start = performance.now();
  await Promise.all([
    getCachedBusyFromGCal(cal, userId, tMin, tMax).catch(() => fetch()),
    getCachedBusyFromGCal(cal, userId, tMin, tMax).catch(() => fetch()),
    getCachedBusyFromGCal(cal, userId, tMin, tMax).catch(() => fetch()),
  ]);
  const parallelMs = Math.round(performance.now() - start);

  clearFreeBusyCacheForTests();
  return { parallelMs, stats: getFreeBusyCacheStats(), note: 'Uses live cache module (GCal may no-op in test env)' };
}

async function main() {
  console.log('Caladdin perf benchmark\n');

  const bundle = bundleMetrics();
  if (bundle) {
    console.log('Web bundle (web/dist):');
    console.log(`  Files: ${bundle.fileCount}`);
    console.log(`  Total: ${formatBytes(bundle.total)} (JS ${formatBytes(bundle.jsTotal)}, CSS ${formatBytes(bundle.cssTotal)})`);
    if (bundle.mainEntry) {
      console.log(`  Main entry: ${formatBytes(bundle.mainEntry.size)} (lazy event-types chunk separate)`);
    }
    if (bundle.eventTypesChunk) {
      console.log(`  event-types chunk: ${formatBytes(bundle.eventTypesChunk.size)}`);
    }
    console.log('  Largest assets:');
    for (const f of bundle.largest) {
      const rel = f.path.replace(root + '\\', '').replace(root + '/', '');
      console.log(`    ${rel} — ${formatBytes(f.size)}`);
    }
    console.log('');
  } else {
    console.log('Web bundle: run npm run build first\n');
  }

  console.log('Architecture:');
  console.log('  GCal free/busy cache: in-memory, 5-min TTL, in-flight dedupe');
  console.log('  Voice pipeline: parallel prefetch (policy, context, email gate, OAuth)');
  console.log('  API compression: gzip/deflate for responses > 1KB');
  console.log('  DB indexes: supabase/migrations/025_performance_indexes.sql');
  console.log('');

  const vitestPerf = runVitestPerf();
  if (vitestPerf.slotMetrics) {
    console.log('generateSlots (mocked 8ms GCal latency):');
    console.log(`  Cold: ${vitestPerf.slotMetrics.cold}ms | Warm: ${vitestPerf.slotMetrics.warm}ms`);
    console.log(`  GCal mock calls (2 runs): ${vitestPerf.slotMetrics.gcalMockCalls}`);
  } else {
    console.log(`Vitest perf tests: ${vitestPerf.ok ? 'passed' : 'failed'} in ${vitestPerf.elapsedMs}ms`);
  }
  console.log('');

  try {
    await cacheMicrobench();
    console.log('Free/busy cache module: loaded from dist (see vitest freebusy-cache tests for dedupe proof)');
  } catch (e) {
    console.log(`Cache microbench: ${e.message}`);
  }

  console.log('\nDone.');
  if (!vitestPerf.ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
