/**
 * Human-readable rendering of an `AdversarialReport` (R-144) — the file the
 * operator reads before reviewing `git diff`. Pure; no I/O.
 */
import type { Finding } from './finding.js';
import type { AdversarialReport } from './review.js';

const cell = (s: string | number | undefined) =>
  String(s ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\s+/g, ' ')
    .trim();

function target(f: Finding): string {
  const where = f.target.file ? `${f.target.file}${f.target.line ? `:${f.target.line}` : ''}` : '';
  return `${f.target.kind} ${f.target.ref}${where ? ` (${where})` : ''}`;
}

function totals(r: AdversarialReport): { Critical: number; Major: number; Minor: number } {
  const t = { Critical: 0, Major: 0, Minor: 0 };
  for (const bySeverity of Object.values(r.counts)) for (const [s, n] of Object.entries(bySeverity)) t[s as keyof typeof t] += n;
  return t;
}

/** One-line summary for the CLI, e.g. `adversarial (§3.9): FAIL — review findings — Critical 4 · Major 1 · Minor 0 · withheld 0 · critic skipped`. */
export function verdictLine(label: string, report: AdversarialReport): string {
  const t = totals(report);
  return `adversarial (${label}): ${report.verdict} — Critical ${t.Critical} · Major ${t.Major} · Minor ${t.Minor} · withheld ${report.withheld.length} · critic ${report.critic.status}`;
}

export function renderReportMarkdown(title: string, report: AdversarialReport): string {
  const t = totals(report);
  const c = report.critic;
  const unevidenced = c.findings.filter((f) => f.unevidenced).length;
  const lines: string[] = [
    `# ${title}`,
    '',
    `**Verdict: ${report.verdict}**`,
    '',
    `- **Generator:** ${report.generator} · **mutation tier:** ${report.mutation.tier}`,
    `- **Findings:** Critical ${t.Critical} · Major ${t.Major} · Minor ${t.Minor} · **withheld plans:** ${report.withheld.length}`,
    `- **Critic:** ${c.status}${c.modelId ? ` (${c.modelId}${c.independence ? `, independence ${c.independence}` : ''})` : ''} · dropped by posture lint ${c.droppedByPostureLint} · malformed ${c.malformed} · unevidenced ${unevidenced}`,
    '',
    '> Deterministic findings (A-nn) are committed in the manifest and are the only ones that can withhold a plan. Critic findings (C-nn) are report-only (R-130).',
  ];
  for (const n of report.notes) lines.push('>', `> **Note:** ${n}`);

  if (report.withheld.length) {
    lines.push('', '## Withheld plans', '', '| Requirement | Critical findings |', '|---|---|');
    for (const w of report.withheld) lines.push(`| ${cell(w.requirement)} | ${cell(w.findings.join(', '))} |`);
  }

  lines.push('', '## Deterministic findings', '');
  if (report.deterministic.length === 0) lines.push('None.');
  else {
    lines.push('| ID | Severity | Attack | Rule | Target | Defect | Failure scenario | Evidence |', '|---|---|---|---|---|---|---|---|');
    for (const f of report.deterministic) {
      lines.push(
        `| ${f.id} | ${f.severity} | ${f.attack} | ${cell(f.rule)} | ${cell(target(f))} | ${cell(f.defect)} | ${cell(f.failureScenario)} | ${cell(f.evidence ?? (f.mutant ? `mutant ${f.mutant}` : ''))} |`
      );
    }
  }

  lines.push('', '## Critic findings (report-only)', '');
  if (c.status === 'skipped') lines.push('Critic not run.');
  else if (c.findings.length === 0) lines.push('None.');
  else {
    lines.push('| ID | Severity | Target | Defect | Failure scenario | Evidence |', '|---|---|---|---|---|---|');
    for (const f of c.findings) {
      lines.push(
        `| ${f.id} | ${f.severity} | ${cell(target(f))} | ${cell(f.defect)} | ${cell(f.failureScenario)} | ${f.unevidenced ? '_unevidenced_' : cell(f.evidence)} |`
      );
    }
  }
  const troubled = c.perPlan.filter((p) => p.status !== 'ok');
  if (troubled.length) {
    lines.push('', '| Plan | Critic status | Reason |', '|---|---|---|');
    for (const p of troubled) lines.push(`| ${cell(p.ref)} | ${p.status} | ${cell(p.reason)} |`);
  }

  lines.push('', '## Mutation', '');
  if (report.mutation.testgen?.length) {
    lines.push('| §3.9 entity | Applicable | Killed / total | Surviving mutants |', '|---|---|---|---|');
    for (const e of report.mutation.testgen) {
      lines.push(
        `| ${cell(e.entity)} | ${e.applicable ? 'yes' : 'no (baseline not green)'} | ${e.killed} / ${e.total} | ${cell(e.survivors.join(', ') || '—')} |`
      );
    }
  }
  if (report.mutation.functional?.length) {
    lines.push('| §3.11 plan | Score | Surviving mutants |', '|---|---|---|');
    for (const p of report.mutation.functional)
      lines.push(`| ${cell(p.ref)} | ${p.score.toFixed(2)} | ${cell(p.survivors.join(', ') || '—')} |`);
  }
  if (!report.mutation.testgen?.length && !report.mutation.functional?.length) lines.push('Nothing to mutate.');

  return lines.join('\n') + '\n';
}
