/**
 * Posture lint over critic output (R-140, D-75, D-78, D-79).
 *
 * Enforces the persona deterministically — no second LLM judges the first:
 * - drop a finding with an empty defect or an empty failure scenario;
 * - drop a finding whose DEFECT is praise or an improvement suggestion, whatever
 *   scenario is attached ("consider adding a retry" is still a suggestion);
 * - keep a defect + scenario with no evidence, tagged `unevidenced` (D-79,
 *   provisional — revisit after the live calibration).
 * Structurally malformed output is counted, never thrown (R-141).
 *
 * The pattern list is versioned with the critic prompt (`CRITIC_PROMPT_VERSION`).
 */
import type { DraftFinding, Severity } from './finding.js';
import { SEVERITIES } from './finding.js';

export const POSTURE_PATTERNS: RegExp[] = [
  /\bwell[- ](structured|written|designed|organi[sz]ed)\b/i,
  /\blooks? (good|great|fine|solid|clean)\b/i,
  /\b(nice|great|excellent|solid|clean) (job|work|test|coverage|approach)\b/i,
  /\bconsider(ing)?\b/i,
  /\bcould be (improved|better|cleaner|clearer)\b/i,
  /\byou (may|might) want\b/i,
  /\b(i |we )?(would )?(suggest|recommend)(s|ed|ing)?\b/i,
  /\bit would be (better|nicer|cleaner)\b/i,
];

export interface PostureLintResult {
  kept: DraftFinding[];
  droppedByPostureLint: number;
  malformed: number;
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * Lint the raw `emit_findings` tool input for one plan. `ref` is the plan's
 * manifest reference (`source/requirementId`), used as each finding's target.
 */
export function lintCriticFindings(raw: unknown, ref: string, file?: string): PostureLintResult {
  const findings = (raw as { findings?: unknown } | null)?.findings;
  if (!raw || typeof raw !== 'object' || !Array.isArray(findings)) {
    return { kept: [], droppedByPostureLint: 0, malformed: 1 };
  }

  const kept: DraftFinding[] = [];
  let droppedByPostureLint = 0;
  let malformed = 0;

  for (const item of findings) {
    const f = item as Record<string, unknown> | null;
    if (!f || typeof f !== 'object' || !SEVERITIES.includes(f.severity as Severity)) {
      malformed++;
      continue;
    }
    const defect = text(f.defect);
    const failureScenario = text(f.failureScenario);
    if (!defect || !failureScenario || POSTURE_PATTERNS.some((p) => p.test(defect))) {
      droppedByPostureLint++;
      continue;
    }
    const evidence = text(f.evidence);
    const line = typeof f.line === 'number' && Number.isInteger(f.line) ? f.line : undefined;
    kept.push({
      attack: 'critic',
      severity: f.severity as Severity,
      target: { kind: 'functional', ref, ...(file ? { file } : {}), ...(line !== undefined ? { line } : {}) },
      defect,
      failureScenario,
      ...(evidence ? { evidence } : { unevidenced: true as const }),
    });
  }
  return { kept, droppedByPostureLint, malformed };
}
