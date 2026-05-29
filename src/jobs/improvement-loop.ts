import { FailureLogEntry } from '../core/adts.js';
import { listFailuresSince } from '../db/failures.js';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { notifyBuild } from '../services/notifications.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '../..');

export function groupFailuresByIntent(
  failures: FailureLogEntry[],
): Map<string | null, FailureLogEntry[]> {
  const map = new Map<string | null, FailureLogEntry[]>();
  for (const f of failures) {
    const key = f.attempted_intent ?? null;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(f);
  }
  return map;
}

export function filterByDateRange(failures: FailureLogEntry[], since: Date): FailureLogEntry[] {
  return failures.filter((f) => f.created_at && new Date(f.created_at) >= since);
}

export function renderImprovementReport(
  groups: Map<string | null, FailureLogEntry[]>,
  since: Date,
  generatedAt: Date,
): string {
  let md = `# Improvement Report\n\nGenerated: ${generatedAt.toISOString()}\nSince: ${since.toISOString()}\n\n`;
  for (const [intent, items] of groups) {
    md += `## ${intent ?? 'unknown'}\n\nCount: ${items.length}\n\n`;
    for (const item of items.slice(0, 5)) {
      md += `- "${item.raw_utterance}" (${item.failure_reason})\n`;
    }
    md += '\n';
  }
  return md;
}

export async function runImprovementLoop(options: {
  lookbackDays: number;
  minFailuresPerGroup: number;
}): Promise<{
  failuresAnalyzed: number;
  groupsAnalyzed: number;
  reportPath: string;
  ntfySent: boolean;
}> {
  const since = new Date(Date.now() - options.lookbackDays * 86400000);
  const failures = await listFailuresSince(since);
  const filtered = filterByDateRange(failures as FailureLogEntry[], since);
  const grouped = groupFailuresByIntent(filtered);

  let groupsAnalyzed = 0;
  for (const [, items] of grouped) {
    if (items.length >= options.minFailuresPerGroup) groupsAnalyzed++;
  }

  const report = renderImprovementReport(grouped, since, new Date());
  const reportPath = join(root, 'IMPROVEMENT_REPORT.md');
  writeFileSync(reportPath, report);

  const ntfySent = await notifyBuild(`Improvement loop: ${filtered.length} failures, ${groupsAnalyzed} groups`);

  return {
    failuresAnalyzed: filtered.length,
    groupsAnalyzed,
    reportPath,
    ntfySent,
  };
}
