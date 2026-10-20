/**
 * The run verdict (R-132) — first match wins. Critic findings count toward the
 * verdict (report-only means they never change what is EMITTED, R-130, not that
 * they are ignored). The verdict never changes the run/job `status`.
 */
import type { Finding } from './finding.js';

export type Verdict = 'FAIL — withheld' | 'FAIL — review findings' | 'PASS WITH NOTES' | 'PASS';

export function verdictOf(findings: Finding[], withheldCount: number): Verdict {
  if (withheldCount > 0) return 'FAIL — withheld';
  if (findings.some((f) => f.severity === 'Critical' || f.severity === 'Major')) return 'FAIL — review findings';
  if (findings.length > 0) return 'PASS WITH NOTES';
  return 'PASS';
}
