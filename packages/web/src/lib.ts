/**
 * Pure SPA helpers (T-14/T-15) — kept out of components so they unit-test
 * without a DOM.
 */

export interface Entry {
  source: string;
  id: string;
  entity: string;
  name?: string;
  domain?: string;
  currentVersion: number;
  currentHash: string;
  validation: string;
}

export interface EntityGroup {
  entity: string;
  variants: Entry[];
  divergent: boolean;
}

export interface SourceGroup {
  /** The ODCS domain (e.g. "deliver", "onboard"), or the crawler source label when domain is absent. */
  source: string;
  contracts: Entry[];
}

/** A cataloged EARS requirement (mirror of the API projection — §3.10, R-109). */
export interface RequirementEntry {
  source: string;
  id: string;
  text: string;
  section: string;
  earsType: string;
  modality: string | null;
  earsConforming: boolean;
  changedInLastCrawl: boolean;
}

export interface RequirementSourceGroup {
  source: string;
  /** Requirements grouped by their spec sub-section, in first-seen order. */
  sections: { section: string; requirements: RequirementEntry[] }[];
}

/** Decode the `cognito:groups` claim from a JWT access token (no verification). */
export function decodeGroups(token: string | undefined): string[] {
  if (!token) return [];
  const part = token.split('.')[1];
  if (!part) return [];
  try {
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(json) as Record<string, unknown>;
    const groups = payload['cognito:groups'];
    return Array.isArray(groups) ? (groups as string[]) : [];
  } catch {
    return [];
  }
}

export const isWriter = (token: string | undefined): boolean => decodeGroups(token).includes('writer');

/** Group catalog entries by entity. divergent starts false; updated from the semantic diff via setDivergent. */
export function groupByEntity(entries: Entry[]): EntityGroup[] {
  const byEntity = new Map<string, Entry[]>();
  for (const e of entries) {
    const list = byEntity.get(e.entity) ?? [];
    list.push(e);
    byEntity.set(e.entity, list);
  }
  return [...byEntity.entries()]
    .map(([entity, variants]) => ({ entity, variants, divergent: false }))
    .sort((a, b) => a.entity.localeCompare(b.entity));
}

/** Update the divergent flag on a group in-place from a GET /entities response. */
export function applyEntityDivergence(groups: EntityGroup[], entityResult: { entity: string; divergent: boolean }): EntityGroup[] {
  return groups.map((g) => (g.entity === entityResult.entity ? { ...g, divergent: entityResult.divergent } : g));
}

/** Group catalog entries by ODCS domain (falling back to crawler source label), sorted by entity within each group (R-65). */
export function groupBySource(entries: Entry[]): SourceGroup[] {
  const byDomain = new Map<string, Entry[]>();
  for (const e of entries) {
    const key = e.domain ?? e.source;
    const list = byDomain.get(key) ?? [];
    list.push(e);
    byDomain.set(key, list);
  }
  return [...byDomain.entries()]
    .map(([source, contracts]) => ({
      source,
      contracts: [...contracts].sort((a, b) => a.entity.localeCompare(b.entity)),
    }))
    .sort((a, b) => a.source.localeCompare(b.source));
}

// --- Adversarial review types and helpers (T-AR-04) ---

export type VerificationStatus = 'ok' | 'stale' | 'invalid' | 'not_run';

export interface FindingVerification {
  verdict: 'CONFIRMED' | 'REFUTED' | 'UNCLEAR';
  reason: string;
  evidence?: string;
}

export interface AdversarialFinding {
  id: string;
  severity: 'Critical' | 'Major' | 'Minor';
  target: string;
  defect: string;
  failureScenario: string;
  evidence?: string;
  inProductRef?: string;
  verification?: FindingVerification;
}

export interface AdversarialRunSummary {
  reviewKind: 'test' | 'code';
  run_dir: string;
  startedAt: string;
  scope: string;
  verdict: string;
  countCritical: number;
  countMajor: number;
  countMinor: number;
  verificationStatus: VerificationStatus;
}

export interface AdversarialFindingsResponse {
  findings: AdversarialFinding[];
  verificationStatus: VerificationStatus;
}

const SEVERITY_RANK = { Critical: 0, Major: 1, Minor: 2 } as const;

/** Returns the display verdict for a finding given the run's verification status. */
export function effectiveVerdict(
  finding: AdversarialFinding,
  verificationStatus: VerificationStatus,
): 'CONFIRMED' | 'REFUTED' | 'UNCLEAR' | 'unverified' {
  if (verificationStatus === 'ok' && finding.verification) {
    return finding.verification.verdict;
  }
  return 'unverified';
}

/**
 * Filter findings by active severity and verdict chip sets.
 * Filter rule (R-25): show when
 *   (no severity chip active OR chip matches) AND
 *   (no verdict chip active OR chip matches effectiveVerdict)
 */
export function filterFindings(
  findings: AdversarialFinding[],
  severityFilters: Set<string>,
  verdictFilters: Set<string>,
  verificationStatus: VerificationStatus,
): AdversarialFinding[] {
  return findings.filter((f) => {
    const severityOk = severityFilters.size === 0 || severityFilters.has(f.severity);
    const ev = effectiveVerdict(f, verificationStatus);
    const verdictOk = verdictFilters.size === 0 || verdictFilters.has(ev);
    return severityOk && verdictOk;
  });
}

/** Sort findings by a column. Severity desc (Critical first) when asc=false. Ties break by id natural ascending. */
export function sortFindings(
  findings: AdversarialFinding[],
  col: keyof AdversarialFinding,
  asc: boolean,
): AdversarialFinding[] {
  const naturalCompare = (a: string, b: string) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

  return [...findings].sort((a, b) => {
    let cmp: number;
    if (col === 'severity') {
      // lower rank = higher severity; asc=false (default) = Critical first = rank ascending (no negate)
      cmp = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
      if (asc) cmp = -cmp;
    } else {
      cmp = naturalCompare(String(a[col] ?? ''), String(b[col] ?? ''));
      if (!asc) cmp = -cmp;
    }
    if (cmp === 0) cmp = naturalCompare(a.id, b.id);
    return cmp;
  });
}

/** Format a run selector option label: local time + " — " + scope. */
export function formatRunLabel(run: AdversarialRunSummary): string {
  const dt = new Date(run.startedAt);
  const local = dt.toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${local} — ${run.scope}`;
}

/**
 * Group cataloged requirements by source, then by spec sub-section (R-113).
 * Preserves the order of `reqs` as delivered — the read API returns requirements
 * sorted by source then natural requirement id (R-109), so sections here appear
 * in first-seen (ascending-id) order and requirements within a section in id order.
 */
export function groupRequirementsBySection(reqs: RequirementEntry[]): RequirementSourceGroup[] {
  const bySource = new Map<string, Map<string, RequirementEntry[]>>();
  for (const r of reqs) {
    const sections = bySource.get(r.source) ?? new Map<string, RequirementEntry[]>();
    const list = sections.get(r.section) ?? [];
    list.push(r);
    sections.set(r.section, list);
    bySource.set(r.source, sections);
  }
  return [...bySource.entries()]
    .map(([source, sections]) => ({
      source,
      sections: [...sections.entries()].map(([section, requirements]) => ({ section, requirements })),
    }))
    .sort((a, b) => a.source.localeCompare(b.source));
}
