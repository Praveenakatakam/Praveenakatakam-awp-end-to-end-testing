/**
 * Adversarial findings (R-128) and their deterministic ordering (R-131).
 *
 * Attacks produce `DraftFinding`s; `finalizeFindings` sorts them by a total,
 * input-order-independent key and only THEN assigns run-scoped ids (`A-01`…),
 * so an unchanged input re-yields byte-identical findings in the committed
 * manifest (R-88/R-119a). No timestamps or random values live here.
 */
import { compareNatural } from '@registry/core';

export type Attack = 'grounding' | 'vacuity' | 'mutation' | 'critic';
export type Severity = 'Critical' | 'Major' | 'Minor';

export const ATTACKS: readonly Attack[] = ['grounding', 'vacuity', 'mutation', 'critic'];
export const SEVERITIES: readonly Severity[] = ['Critical', 'Major', 'Minor'];

export interface FindingTarget {
  /** `generator` = a defect in the generator source itself, not one emitted test (R-135). */
  kind: 'conformance' | 'compat' | 'functional' | 'generator';
  /** Manifest reference, e.g. `create/CRE-R-24`, `org`, `get-ready/TaskPublished`, `packages/testgen`. */
  ref: string;
  /** Emitted-file path (repo-relative under `generated-tests/`) when the finding is about a file. */
  file?: string;
  line?: number;
  /**
   * Set on a committed finding about a plan the gate withheld (R-129): no test file was
   * written for it, so there is no `file` to follow. The finding still names the plan by `ref`.
   */
  withheld?: true;
}

export interface Finding {
  /** Run-scoped id, assigned by `finalizeFindings`. */
  id: string;
  attack: Attack;
  severity: Severity;
  /** The spec rule that fired, e.g. `R-133a` (deterministic attacks always set it). */
  rule?: string;
  target: FindingTarget;
  /** One sentence: what is wrong. */
  defect: string;
  /** The input/state under which the test passes while the system is broken (or fails while it is correct). */
  failureScenario: string;
  /** JSON pointer / file:line / schema property / clause quote / mutant id. */
  evidence?: string;
  /** Critic findings with no evidence are kept, tagged (D-79). */
  unevidenced?: true;
  /** Mutation findings name the surviving mutant, e.g. `M1:sourcedId`. */
  mutant?: string;
}

export type DraftFinding = Omit<Finding, 'id'>;

const SEVERITY_RANK: Record<Severity, number> = { Critical: 0, Major: 1, Minor: 2 };
const ATTACK_RANK: Record<Attack, number> = { grounding: 0, vacuity: 1, mutation: 2, critic: 3 };

// Locale-independent: ids reach the committed manifest, so the order must not depend on the host (R-88).
const natural = compareNatural;

function compareDrafts(a: DraftFinding, b: DraftFinding): number {
  return (
    natural(a.target.kind, b.target.kind) ||
    natural(a.target.ref, b.target.ref) ||
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
    ATTACK_RANK[a.attack] - ATTACK_RANK[b.attack] ||
    natural(a.rule ?? '', b.rule ?? '') ||
    natural(a.mutant ?? '', b.mutant ?? '') ||
    natural(a.target.file ?? '', b.target.file ?? '') ||
    (a.target.line ?? 0) - (b.target.line ?? 0) ||
    natural(a.defect, b.defect) ||
    natural(a.evidence ?? '', b.evidence ?? '')
  );
}

/**
 * Sort deterministically, then assign `A-01`, `A-02`, … in that order. Critic
 * findings use prefix `C` (R-128) so the committed deterministic ids never shift
 * with critic output.
 */
export function finalizeFindings(drafts: DraftFinding[], prefix: 'A' | 'C' = 'A'): Finding[] {
  return [...drafts].sort(compareDrafts).map((d, i) => ({ id: `${prefix}-${String(i + 1).padStart(2, '0')}`, ...d }));
}

/** Counts by attack × severity, every cell present (R-131). */
export function countFindings(findings: Finding[]): Record<Attack, Record<Severity, number>> {
  const counts = Object.fromEntries(
    ATTACKS.map((a) => [a, Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as Record<Severity, number>])
  ) as Record<Attack, Record<Severity, number>>;
  for (const f of findings) counts[f.attack][f.severity]++;
  return counts;
}
