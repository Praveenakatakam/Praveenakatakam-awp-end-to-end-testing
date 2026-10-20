/**
 * Record a tests-first "red run" for later review (golden rule: failing tests
 * are written and approved before implementation).
 *
 *   node scripts/red-run.mjs <task-id> <vitest path filter...>
 *   e.g. node scripts/red-run.mjs T-40a packages/functest
 *
 * Runs vitest with the JSON reporter and writes docs/red-runs/<task-id>.md:
 * counts, then one row per failing test with its first failure line.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [taskId, ...filters] = process.argv.slice(2);
if (!taskId || filters.length === 0) {
  console.error('usage: node scripts/red-run.mjs <task-id> <vitest path filter...>');
  process.exit(2);
}

const jsonPath = join(tmpdir(), `red-run-${taskId}.json`);
try {
  execFileSync('npx', ['vitest', 'run', ...filters, '--reporter=json', `--outputFile=${jsonPath}`], {
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });
} catch {
  // vitest exits non-zero when tests fail — that is the point of a red run.
}

const report = JSON.parse(readFileSync(jsonPath, 'utf8'));
rmSync(jsonPath, { force: true });

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const cell = (s) => stripAnsi(s).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim().slice(0, 200);

const failed = [];
let passed = 0;
for (const file of report.testResults) {
  if (file.assertionResults.length === 0 && file.status === 'failed') {
    failed.push({ name: `${file.name} (file failed to load)`, reason: file.message ?? '' });
  }
  for (const t of file.assertionResults) {
    if (t.status === 'failed') {
      failed.push({ name: [...t.ancestorTitles, t.title].join(' › '), reason: (t.failureMessages[0] ?? '').split('\n')[0] });
    } else if (t.status === 'passed') {
      passed++;
    }
  }
}

const lines = [
  `# Red run — ${taskId}`,
  '',
  `- **Recorded:** ${new Date().toISOString()}`,
  `- **Command:** \`npx vitest run ${filters.join(' ')}\``,
  `- **Result:** ${failed.length} failed, ${passed} passed`,
  '',
  '| Failing test | First failure line |',
  '|---|---|',
  ...failed.map((f) => `| ${cell(f.name)} | ${cell(f.reason)} |`),
  '',
];

mkdirSync('docs/red-runs', { recursive: true });
writeFileSync(`docs/red-runs/${taskId}.md`, lines.join('\n'));
console.log(`docs/red-runs/${taskId}.md — ${failed.length} failed, ${passed} passed`);
