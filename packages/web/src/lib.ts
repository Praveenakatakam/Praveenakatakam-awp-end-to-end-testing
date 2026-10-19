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

/** One line of a line diff: unchanged, only in A (`remove`), or only in B (`add`). */
export interface DiffLine {
  op: 'equal' | 'remove' | 'add';
  text: string;
}

/** Above this many LCS cells the diff degrades to "all removed, all added". */
const LCS_CELL_LIMIT = 4_000_000;

/**
 * Line diff of `a` → `b` via longest common subsequence (R-70). No dependency;
 * O(n·m) time/space, which is fine for emitted test files (hundreds of lines).
 * Common prefix/suffix are trimmed first so near-identical files stay cheap.
 */
export function lineDiff(a: string, b: string): DiffLine[] {
  const A = a === '' ? [] : a.split('\n');
  const B = b === '' ? [] : b.split('\n');

  let start = 0;
  while (start < A.length && start < B.length && A[start] === B[start]) start++;
  let endA = A.length;
  let endB = B.length;
  while (endA > start && endB > start && A[endA - 1] === B[endB - 1]) { endA--; endB--; }

  const head: DiffLine[] = A.slice(0, start).map((text) => ({ op: 'equal', text }));
  const tail: DiffLine[] = A.slice(endA).map((text) => ({ op: 'equal', text }));
  const midA = A.slice(start, endA);
  const midB = B.slice(start, endB);
  const n = midA.length;
  const m = midB.length;

  if (n * m > LCS_CELL_LIMIT) {
    return [
      ...head,
      ...midA.map((text): DiffLine => ({ op: 'remove', text })),
      ...midB.map((text): DiffLine => ({ op: 'add', text })),
      ...tail,
    ];
  }

  // lcs[i][j] = LCS length of midA[i..] and midB[j..], flattened row-major.
  const w = m + 1;
  const lcs = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] = midA[i] === midB[j]
        ? lcs[(i + 1) * w + j + 1] + 1
        : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
    }
  }

  const mid: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (midA[i] === midB[j]) { mid.push({ op: 'equal', text: midA[i] }); i++; j++; }
    else if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) { mid.push({ op: 'remove', text: midA[i] }); i++; }
    else { mid.push({ op: 'add', text: midB[j] }); j++; }
  }
  while (i < n) mid.push({ op: 'remove', text: midA[i++] });
  while (j < m) mid.push({ op: 'add', text: midB[j++] });

  return [...head, ...mid, ...tail];
}

// ---------------------------------------------------------------------------
// Step output shapes (v0.5.0 step transparency — R-77)
//
// Local mirrors of `@registry/functest`'s `PlanBody` (PLAN_SCHEMA v2, R-61) and
// `Critique` (CRITIQUE_SCHEMA, R-62). Mirrored rather than imported because the
// functest modules pull in Ajv at runtime.
// ---------------------------------------------------------------------------

export interface PlanAssertionView {
  service: string;
  assertion: string;
  field?: string;
  expected?: string;
}

export interface PlanView {
  requirementIds?: string[];
  title?: string;
  rationale?: string;
  setup?: { description: string }[];
  trigger: {
    source?: string;
    entity?: string;
    method?: string;
    path?: string;
    payloadShape?: string;
    examplePayload?: string;
  };
  propagation?: { kind?: string; waitFor?: string; channel?: string };
  assertions: PlanAssertionView[];
  negativeCases?: { description: string; expectedOutcome: string }[];
}

export type CritiqueVerdict = 'approve' | 'revise' | 'reject';

export interface CritiqueView {
  verdict: CritiqueVerdict | string;
  summary: string;
  issues: { severity: string; target: string; problem: string; suggestion: string }[];
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function parseJson(raw: string | null | undefined): unknown {
  if (raw == null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** Parse a plan step's output string; `null` when it is not plan-shaped JSON. */
export function parsePlan(raw: string | null | undefined): PlanView | null {
  const v = parseJson(raw);
  if (!isObj(v) || !isObj(v.trigger) || !Array.isArray(v.assertions)) return null;
  return v as unknown as PlanView;
}

/** Parse a critique step's output string; `null` when it is not critique-shaped JSON. */
export function parseCritique(raw: string | null | undefined): CritiqueView | null {
  const v = parseJson(raw);
  if (!isObj(v) || typeof v.verdict !== 'string' || !Array.isArray(v.issues)) return null;
  return { verdict: v.verdict, summary: typeof v.summary === 'string' ? v.summary : '', issues: v.issues as CritiqueView['issues'] };
}

/** One field-level difference between two plans (R-77 Changes tab). */
export interface PlanChange {
  /** Dotted field path, e.g. `trigger.path` or `assertions`. */
  field: string;
  kind: 'added' | 'removed' | 'changed';
  /** Previous value (scalar) or the removed list item, rendered as text. */
  before?: string;
  /** New value (scalar) or the added list item, rendered as text. */
  after?: string;
}

const PLAN_SCALAR_FIELDS = [
  'title',
  'rationale',
  'trigger.source',
  'trigger.entity',
  'trigger.method',
  'trigger.path',
  'trigger.payloadShape',
  'trigger.examplePayload',
  'propagation.kind',
  'propagation.channel',
  'propagation.waitFor',
] as const;

const PLAN_LIST_FIELDS = ['requirementIds', 'setup', 'assertions', 'negativeCases'] as const;

function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split('.')) {
    if (!isObj(cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

/** Stable stringify (sorted keys) so `{a,b}` and `{b,a}` compare equal. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (isObj(v)) {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'undefined';
}

/** Human-readable rendering of a plan list item. */
export function describePlanItem(field: string, item: unknown): string {
  if (typeof item === 'string') return item;
  if (!isObj(item)) return canonical(item);
  if (field === 'setup' && typeof item.description === 'string') return item.description;
  if (field === 'assertions' && typeof item.assertion === 'string') {
    let s = `[${String(item.service ?? '?')}] ${item.assertion}`;
    if (item.field !== undefined || item.expected !== undefined) {
      s += ` (${String(item.field ?? '?')} = ${String(item.expected ?? '?')})`;
    }
    return s;
  }
  if (field === 'negativeCases' && typeof item.description === 'string') {
    return `${item.description} → ${String(item.expectedOutcome ?? '')}`;
  }
  return canonical(item);
}

const scalarText = (v: unknown): string | undefined =>
  v === undefined || v === null || v === '' ? undefined : typeof v === 'string' ? v : canonical(v);

/**
 * Field-level diff of two plans (`a` = earlier, `b` = later) — R-77, design
 * "v0.5.0 Amendments". Scalar fields report added / removed / changed; list
 * fields (setup, assertions, negativeCases, requirementIds) are compared by
 * stringified item (multiset semantics) and report added / removed items.
 * Results are in plan field order.
 */
export function diffPlans(a: unknown, b: unknown): PlanChange[] {
  const changes: PlanChange[] = [];

  for (const field of PLAN_SCALAR_FIELDS) {
    const before = scalarText(getPath(a, field));
    const after = scalarText(getPath(b, field));
    if (before === after) continue;
    if (before === undefined) changes.push({ field, kind: 'added', after });
    else if (after === undefined) changes.push({ field, kind: 'removed', before });
    else changes.push({ field, kind: 'changed', before, after });
  }

  for (const field of PLAN_LIST_FIELDS) {
    const listA = getPath(a, field);
    const listB = getPath(b, field);
    const itemsA = Array.isArray(listA) ? listA : [];
    const itemsB = Array.isArray(listB) ? listB : [];
    const remaining = new Map<string, number>();
    for (const item of itemsB) {
      const k = canonical(item);
      remaining.set(k, (remaining.get(k) ?? 0) + 1);
    }
    for (const item of itemsA) {
      const k = canonical(item);
      const n = remaining.get(k) ?? 0;
      if (n > 0) remaining.set(k, n - 1);
      else changes.push({ field, kind: 'removed', before: describePlanItem(field, item) });
    }
    const matched = new Map<string, number>();
    for (const item of itemsA) {
      const k = canonical(item);
      matched.set(k, (matched.get(k) ?? 0) + 1);
    }
    for (const item of itemsB) {
      const k = canonical(item);
      const n = matched.get(k) ?? 0;
      if (n > 0) matched.set(k, n - 1);
      else changes.push({ field, kind: 'added', after: describePlanItem(field, item) });
    }
  }

  return changes;
}
