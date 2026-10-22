/**
 * Deterministic finalize step of the adversarial review skills
 * (.claude/skills/adversarial-review-spec.md §4–§8; AR-02, AR-03, AR-05, AR-09,
 * AR-15, AR-16, AR-17).
 *
 *   npx tsx scripts/adversarial-review-finalize.ts finalize <run_dir>
 *       review.raw.json (Pass 2) → review.json + review.md. Applies the posture
 *       lint with the PRODUCT's own patterns (so skills and the in-product critic
 *       lint identically), assigns F-nn / D-nn after a deterministic sort, and
 *       applies the fixed verdict rule. Findings the lint drops (praise,
 *       suggestions, empty or malformed) go verbatim to dropped.md for human
 *       review (AR-17). Accounts for every blind-pass item X-nn
 *       (AR-15): an item Pass 2 neither covered nor listed as uncovered is
 *       reported as not assessed. Refuses if the blind pass is missing or was
 *       written after the reconcile pass, or if the generated tree changed
 *       since the preflight snapshot (AR-16).
 *
 *   npx tsx scripts/adversarial-review-finalize.ts blind-inputs [generated_dir] [run_dir]
 *       Prints the ONLY manifest facts the blind pass may see: requirement ids,
 *       contract ids + content hashes, entity names. Never assertions, schemas,
 *       titles, skip reasons or findings. With run_dir, also snapshots them to
 *       {run_dir}/blind-inputs.json for the AR-16 check.
 *
 * Read-only on the repo apart from the run folder; never invokes version control.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { POSTURE_PATTERNS } from '@registry/adversary';
import { compareNatural } from '@registry/core';
import { auditRun, specIds, type Issue } from './audit-references.js';

export interface RawFinding {
  severity: string;
  target: string;
  defect: string;
  failureScenario: string;
  evidence?: string;
  inProductRef?: string;
}

export interface RawReview {
  skill: 'adversarial-test-review' | 'adversarial-code-review';
  version: string;
  model: string;
  scope: string;
  needsDecision: { item: string; detail: string; evidence?: string }[];
  findings: RawFinding[];
  uncovered: { behaviour: string; quote: string; coveredBy: string }[];
  /** Blind-pass items Pass 2 found checked, and where (AR-15). Optional for older raw files. */
  covered?: { behaviour: string; by: string }[];
  discardedInstructions: string[];
}

/** Pass 3's judgement of one finding's claim (AR-19). */
export type ClaimVerdict = 'CONFIRMED' | 'REFUTED' | 'UNCLEAR';
const CLAIM_VERDICTS: readonly string[] = ['CONFIRMED', 'REFUTED', 'UNCLEAR'];

export interface FindingVerification {
  verdict: ClaimVerdict;
  reason: string;
  evidence?: string;
}

/** `verification.json`, written by the verify agent. `index` is the finding's position in review.raw.json. */
export interface RawVerification {
  model?: string;
  findings?: { index?: unknown; verdict?: unknown; reason?: unknown; evidence?: unknown }[];
}

export interface ReviewFinding extends RawFinding {
  id: string;
  severity: 'Critical' | 'Major' | 'Minor';
  unevidenced?: true;
  /** Pass 3's verdict; absent when the claim was not verified (AR-19). */
  verification?: FindingVerification;
}

/** The citation audit (AR-18): hard = a reference to something that does not exist. */
export interface CitationAudit {
  checked: number;
  hard: Issue[];
  /** Imprecise but real: right text in another file, or a sub-clause shorthand. */
  soft: number;
  /** Set when the audit itself failed to run; it never stops finalize. */
  error?: string;
}

export interface VerificationSummary {
  /** `ok`: applied. `stale`: older than review.raw.json, ignored. `invalid`: unreadable, ignored. */
  status: 'ok' | 'stale' | 'invalid';
  model?: string;
  confirmed: number;
  refuted: number;
  unclear: number;
  notVerified: number;
}

export interface FinalReview extends Omit<RawReview, 'findings' | 'needsDecision'> {
  runName: string;
  pass1WrittenAt?: string;
  finalizedAt?: string;
  verdict: 'FAIL — Critical' | 'FAIL — Major' | 'PASS WITH NOTES' | 'PASS';
  findings: ReviewFinding[];
  needsDecision: { id: string; item: string; detail: string; evidence?: string }[];
  droppedByPostureLint: number;
  malformed: number;
  /** AR-15 accounting of the blind pass's X-nn items; absent when the blind pass has none. */
  blindAccounting?: BlindAccounting;
  /** AR-18: citations that point at nothing. Informational; never changes the verdict. */
  citationAudit?: CitationAudit;
  /** AR-19: Pass 3's verdicts on the findings' claims; absent when Pass 3 did not run. Never changes the verdict. */
  verification?: VerificationSummary;
}

export interface BlindAccounting {
  total: number;
  covered: string[];
  uncovered: string[];
  /** Neither covered nor uncovered in Pass 2 — reported as uncovered. */
  notAssessed: string[];
  /** X-nn ids Pass 2 cited that the blind pass never wrote. */
  unknown: string[];
}

const SEVERITY_RANK = { Critical: 0, Major: 1, Minor: 2 } as const;
type Severity = keyof typeof SEVERITY_RANK;
const isSeverity = (s: unknown): s is Severity => typeof s === 'string' && s in SEVERITY_RANK;
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
// Locale-independent, so the same run folder sorts the same on every machine (R-88).
const natural = compareNatural;
const pad = (n: number) => String(n).padStart(2, '0');
const xIds = (s: unknown): string[] => (typeof s === 'string' ? (s.match(/\bX-\d+\b/g) ?? []) : []);

/** The X-nn ids of the blind pass's table rows (`| X-01 | …`). */
export function parseBlindIds(markdown: string): string[] {
  const ids = new Set<string>();
  for (const m of markdown.matchAll(/^\|\s*(X-\d+)\s*\|/gm)) ids.add(m[1]);
  return [...ids].sort(natural);
}

/** Table rows whose first cell looks like an id but is not `X-nn` (e.g. `B-01`); AR-15 would silently skip them. */
export function foreignBlindIds(markdown: string): string[] {
  const ids = new Set<string>();
  for (const m of markdown.matchAll(/^\|\s*([A-Za-z]+-\d+)\s*\|/gm)) if (!m[1].startsWith('X-')) ids.add(m[1]);
  return [...ids].sort(natural);
}

/** A finding the finalize step removed from review.md, kept in dropped.md for human review. */
export interface DroppedFinding {
  reason: string;
  finding: unknown;
}

/** Why spec §6 drops a finding, or undefined if it is kept. */
function postureLintReason(defect: string, failureScenario: string): string | undefined {
  if (!defect) return 'empty defect';
  if (!failureScenario) return 'empty failure scenario';
  const pattern = POSTURE_PATTERNS.find((p) => p.test(defect));
  return pattern ? `praise or suggestion (matched ${pattern})` : undefined;
}

export function finalizeReview(
  raw: RawReview,
  meta: {
    runName?: string;
    pass1WrittenAt?: string;
    finalizedAt?: string;
    blindIds?: string[];
    audit?: CitationAudit;
    /** Pass 3's verdicts keyed by raw finding index, or why its file was ignored. */
    verification?: { status: 'ok'; model?: string; byIndex: Map<number, FindingVerification> } | { status: 'stale' | 'invalid'; model?: string };
  } = {}
): { review: FinalReview; dropped: { postureLint: DroppedFinding[]; malformed: DroppedFinding[] } } {
  const droppedPosture: DroppedFinding[] = [];
  const droppedMalformed: DroppedFinding[] = [];
  const kept: (Omit<ReviewFinding, 'id' | 'verification'> & { rawIndex: number })[] = [];

  for (const [rawIndex, f] of (raw.findings ?? []).entries()) {
    const target = text(f?.target);
    if (!f || !isSeverity(f.severity) || !target) {
      const reason = !f ? 'not an object' : !isSeverity(f.severity) ? `unknown severity ${JSON.stringify(f.severity)}` : 'no target';
      droppedMalformed.push({ reason, finding: f });
      continue;
    }
    const defect = text(f.defect);
    const failureScenario = text(f.failureScenario);
    // Spec §6 — the same rule and patterns as the in-product critic (D-78).
    const reason = postureLintReason(defect, failureScenario);
    if (reason) {
      droppedPosture.push({ reason, finding: f });
      continue;
    }
    const evidence = text(f.evidence);
    const inProductRef = text(f.inProductRef);
    kept.push({
      rawIndex,
      severity: f.severity,
      target,
      defect,
      failureScenario,
      ...(evidence ? { evidence } : { unevidenced: true as const }),
      ...(inProductRef ? { inProductRef } : {}),
    });
  }

  kept.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      natural(a.target, b.target) ||
      natural(a.defect, b.defect) ||
      natural(a.evidence ?? '', b.evidence ?? '')
  );
  const applied = meta.verification?.status === 'ok' ? meta.verification.byIndex : undefined;
  // `rawIndex` is the key Pass 3 uses (ids are assigned only after sorting). It depends on input order, so it
  // is dropped from the output: the same findings must serialise identically however Pass 2 listed them.
  const findings: ReviewFinding[] = kept.map(({ rawIndex, ...f }, i) => {
    const verification = applied?.get(rawIndex);
    return { id: `F-${pad(i + 1)}`, ...f, ...(verification ? { verification } : {}) };
  });

  // AR-19 — Pass 3 never changes the verdict: it tells the reader which findings survived an attempt to refute them.
  let verification: VerificationSummary | undefined;
  if (meta.verification) {
    const count = (v: ClaimVerdict) => findings.filter((f) => f.verification?.verdict === v).length;
    verification = {
      status: meta.verification.status,
      ...(meta.verification.model ? { model: meta.verification.model } : {}),
      confirmed: count('CONFIRMED'),
      refuted: count('REFUTED'),
      unclear: count('UNCLEAR'),
      notVerified: findings.filter((f) => !f.verification).length,
    };
  }

  const verdict: FinalReview['verdict'] = findings.some((f) => f.severity === 'Critical')
    ? 'FAIL — Critical'
    : findings.some((f) => f.severity === 'Major')
      ? 'FAIL — Major'
      : findings.length
        ? 'PASS WITH NOTES'
        : 'PASS';

  // AR-15 — every blind item must be accounted for. Uncovered wins over covered,
  // and an item Pass 2 skipped is reported as uncovered, never as covered.
  const needsDecision = [...(raw.needsDecision ?? [])];
  const uncovered = [...(raw.uncovered ?? [])];
  let covered = raw.covered ?? [];
  let blindAccounting: BlindAccounting | undefined;
  if (meta.blindIds?.length) {
    const blindIds = meta.blindIds;
    const uncoveredIds = new Set(uncovered.flatMap((u) => xIds(u.behaviour)));
    covered = covered.filter((c) => !xIds(c.behaviour).some((id) => uncoveredIds.has(id)));
    const coveredIds = new Set(covered.flatMap((c) => xIds(c.behaviour)));
    const cited = new Set([
      ...uncoveredIds,
      ...coveredIds,
      ...(raw.findings ?? []).flatMap((f) => [...xIds(f?.defect), ...xIds(f?.evidence)]),
    ]);
    const notAssessed = blindIds.filter((id) => !coveredIds.has(id) && !uncoveredIds.has(id));
    const unknown = [...cited].filter((id) => !blindIds.includes(id)).sort(natural);

    for (const id of notAssessed) uncovered.push({ behaviour: id, quote: '', coveredBy: 'not assessed by Pass 2' });
    if (notAssessed.length) {
      needsDecision.push({
        item: 'Blind items not assessed',
        detail: `Pass 2 neither covered nor listed ${notAssessed.length} of ${blindIds.length} blind-pass items: ${notAssessed.join(', ')}. They are reported as uncovered; re-run Pass 2 to assess them.`,
      });
    }
    if (unknown.length) {
      needsDecision.push({
        item: 'Unknown blind items cited',
        detail: `Pass 2 cited ${unknown.join(', ')}, which the blind pass never wrote.`,
      });
    }
    blindAccounting = {
      total: blindIds.length,
      covered: blindIds.filter((id) => coveredIds.has(id)),
      uncovered: blindIds.filter((id) => uncoveredIds.has(id)),
      notAssessed,
      unknown,
    };
  }

  const { findings: _f, needsDecision: _n, covered: _c, ...rest } = raw;
  return {
    review: {
      ...rest,
      runName: meta.runName ?? '',
      ...(meta.pass1WrittenAt ? { pass1WrittenAt: meta.pass1WrittenAt } : {}),
      ...(meta.finalizedAt ? { finalizedAt: meta.finalizedAt } : {}),
      verdict,
      findings,
      needsDecision: needsDecision.map((d, i) => ({ id: `D-${pad(i + 1)}`, ...d })),
      uncovered,
      ...(covered.length ? { covered } : {}),
      discardedInstructions: raw.discardedInstructions ?? [],
      droppedByPostureLint: droppedPosture.length,
      malformed: droppedMalformed.length,
      ...(blindAccounting ? { blindAccounting } : {}),
      ...(meta.audit ? { citationAudit: meta.audit } : {}),
      ...(verification ? { verification } : {}),
    },
    dropped: { postureLint: droppedPosture, malformed: droppedMalformed },
  };
}

const cell = (s: string | undefined) => (s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
const field = (f: unknown, key: string) => {
  const v = (f as Record<string, unknown> | null)?.[key];
  return typeof v === 'string' ? v : v === undefined ? '' : JSON.stringify(v);
};

/**
 * dropped.md — what the finalize step kept out of review.md (praise, suggestions,
 * empty or malformed findings), verbatim, for a human to second-guess the lint.
 * Never feeds the verdict.
 */
export function renderDroppedMarkdown(
  runName: string,
  dropped: { postureLint: DroppedFinding[]; malformed: DroppedFinding[] }
): string {
  const lines = [
    `# Dropped findings — ${runName}`,
    '',
    'Removed from `review.md` by the finalize step. They do **not** affect the verdict. Review them to check the posture lint did not drop a real defect; if it did, re-run Pass 2 rather than editing `review.raw.json`.',
    '',
    `## Dropped by posture lint (${dropped.postureLint.length})`,
  ];
  if (dropped.postureLint.length === 0) lines.push('None.');
  else {
    lines.push('| # | Reason | Severity | Target | Defect | Failure scenario | Evidence |', '|---|---|---|---|---|---|---|');
    dropped.postureLint.forEach(({ reason, finding: f }, i) =>
      lines.push(
        `| ${i + 1} | ${cell(reason)} | ${cell(field(f, 'severity'))} | ${cell(field(f, 'target'))} | ${cell(field(f, 'defect'))} | ${cell(field(f, 'failureScenario'))} | ${cell(field(f, 'evidence'))} |`
      )
    );
  }
  lines.push('', `## Malformed (${dropped.malformed.length})`);
  if (dropped.malformed.length === 0) lines.push('None.');
  else dropped.malformed.forEach(({ reason, finding }, i) => lines.push(`${i + 1}. ${reason}: \`${cell(JSON.stringify(finding) ?? 'undefined')}\``));
  return lines.join('\n') + '\n';
}

export function renderReviewMarkdown(r: FinalReview): string {
  const kind = r.skill === 'adversarial-code-review' ? 'code' : 'test';
  const unevidenced = r.findings.filter((f) => f.unevidenced).length;
  const lines = [
    `# Adversarial ${kind} review — ${r.runName}`,
    `**Verdict: ${r.verdict}**`,
    `- Reviewer: ${r.skill} v${r.version}, model ${r.model}${r.finalizedAt ? `, ${r.finalizedAt}` : ''}`,
    `- Scope: ${r.scope}${r.pass1WrittenAt ? ` · Pass 1 written ${r.pass1WrittenAt}, before Pass 2` : ''}`,
    `- Dropped by posture lint: ${r.droppedByPostureLint} · Unevidenced: ${unevidenced} · Malformed: ${r.malformed}${r.droppedByPostureLint || r.malformed ? ' (see `dropped.md`)' : ''}`,
  ];
  const a = r.blindAccounting;
  if (a) {
    lines.push(
      `- Blind items: ${a.total} · covered ${a.covered.length} · uncovered ${a.uncovered.length} · not assessed by Pass 2 ${a.notAssessed.length}`
    );
  }
  const ca = r.citationAudit;
  if (ca) {
    lines.push(
      ca.error
        ? `- Citation audit: did not run (${ca.error})`
        : `- Citation audit: ${ca.checked} items checked · ${ca.hard.length} NOT FOUND · ${ca.soft} imprecise${ca.hard.length ? ' (see "Citations not verified")' : ''}`
    );
  }
  const v = r.verification;
  if (!v) lines.push('- Claim verification (Pass 3): not run, so no finding\'s claim has been independently checked');
  else if (v.status !== 'ok') {
    lines.push(`- Claim verification (Pass 3): ${v.status === 'stale' ? 'ignored, written before review.raw.json was last changed' : 'ignored, verification.json is unreadable'}`);
  } else {
    lines.push(
      `- Claim verification (Pass 3${v.model ? `, model ${v.model}` : ''}): ${v.confirmed} confirmed · ${v.refuted} refuted · ${v.unclear} unclear · ${v.notVerified} not verified`
    );
  }
  lines.push('', '## Needs your decision');
  if (r.needsDecision.length === 0) lines.push('None.');
  for (const d of r.needsDecision) lines.push(`- ${d.id} — ${d.item} — ${d.detail}${d.evidence ? ` — evidence: ${d.evidence}` : ''}`);

  lines.push('', '## Findings');
  if (r.findings.length === 0) lines.push('None.');
  else {
    lines.push('| ID | Severity | Target | Defect | Failure scenario | Evidence | In-product | Verified |', '|---|---|---|---|---|---|---|---|');
    for (const f of r.findings) {
      lines.push(
        `| ${f.id} | ${f.severity} | ${cell(f.target)} | ${cell(f.defect)} | ${cell(f.failureScenario)} | ${f.unevidenced ? '_unevidenced_' : cell(f.evidence)} | ${cell(f.inProductRef) || '—'} | ${f.verification?.verdict ?? '—'} |`
      );
    }
  }

  // AR-19: refuted findings stay in the table and in the verdict; a human decides, the script does not.
  const refuted = r.findings.filter((f) => f.verification?.verdict === 'REFUTED');
  if (refuted.length) {
    lines.push('', '## Findings the verifier refuted', 'Kept in the table above and counted in the verdict: the verifier is another model and can be wrong. Read its reason before discounting any of these.');
    for (const f of refuted) {
      lines.push(`- ${f.id} (${f.severity}, ${cell(f.target)}) — ${cell(f.verification?.reason)}${f.verification?.evidence ? ` — evidence: ${cell(f.verification.evidence)}` : ''}`);
    }
  }

  // AR-18: a reference to something that does not exist is the fabrication signal. Never changes the verdict.
  if (ca && !ca.error) {
    lines.push('', '## Citations not verified', 'References in the findings and decision items that point at nothing (no such file, a line past the end, an undefined rule id, text found nowhere in the repo). This list does not change the verdict; check each against the code before relying on its finding.');
    if (ca.hard.length === 0) lines.push('None.');
    for (const i of ca.hard) lines.push(`- ${cell(i.where)}: \`${cell(i.ref)}\` — ${i.problem}`);
  }

  lines.push('', '## Expected behaviours not covered');
  if (r.uncovered.length === 0) lines.push('None.');
  else {
    lines.push('| Behaviour (Pass 1) | Quote | Covered by |', '|---|---|---|');
    for (const u of r.uncovered) lines.push(`| ${cell(u.behaviour)} | ${cell(u.quote)} | ${cell(u.coveredBy) || '—'} |`);
  }

  if (r.covered?.length) {
    lines.push('', '## Expected behaviours covered', '| Behaviour (Pass 1) | Checked by |', '|---|---|');
    for (const c of r.covered) lines.push(`| ${cell(c.behaviour)} | ${cell(c.by)} |`);
  }

  if (r.discardedInstructions.length) {
    lines.push('', '## Discarded embedded instructions');
    for (const d of r.discardedInstructions) lines.push(`- ${d}`);
  }
  return lines.join('\n') + '\n';
}

const COMPROMISED_MARKER = 'BLIND PASS COMPROMISED';

/**
 * A blind pass that opened code it must not have reports itself by writing ONLY the marker (agent definitions,
 * AR-02), so the marker is the file's first non-empty line. The string merely appearing somewhere does not count:
 * a behaviour row that describes how finalize treats the marker would otherwise get a clean pass refused.
 */
export function isBlindCompromised(text: string): boolean {
  const first = text.split(/\r?\n/).find((l) => l.trim() !== '');
  return first?.trim() === COMPROMISED_MARKER;
}

/** AR-18: check every cited file, line, quote and rule id. A failure of the audit itself never stops finalize. */
export function runCitationAudit(runDir: string): CitationAudit {
  try {
    const { checked, issues } = auditRun(resolve(runDir), specIds());
    const hard = issues.filter((i) => i.severity === 'hard');
    return { checked, hard, soft: issues.length - hard.length };
  } catch (err) {
    return { checked: 0, hard: [], soft: 0, error: (err as Error).message };
  }
}

/**
 * AR-19: load Pass 3's `verification.json`, or return undefined when Pass 3 did not run. A file older than
 * review.raw.json describes findings that may no longer be at those positions, so it is ignored (stale);
 * an unreadable one is ignored (invalid). Entries with an out-of-range index or an unknown verdict are skipped,
 * so a malformed entry can never be applied to the wrong finding.
 */
export function readVerification(
  runDir: string,
  rawTime: Date,
  findingCount: number
): { status: 'ok'; model?: string; byIndex: Map<number, FindingVerification> } | { status: 'stale' | 'invalid'; model?: string } | undefined {
  const path = join(runDir, 'verification.json');
  if (!existsSync(path)) return undefined;
  if (statSync(path).mtime.getTime() < rawTime.getTime()) return { status: 'stale' };
  let parsed: RawVerification;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as RawVerification;
  } catch {
    return { status: 'invalid' };
  }
  if (!parsed || !Array.isArray(parsed.findings)) return { status: 'invalid' };
  const byIndex = new Map<number, FindingVerification>();
  for (const e of parsed.findings) {
    const index = e?.index;
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= findingCount) continue;
    if (typeof e.verdict !== 'string' || !CLAIM_VERDICTS.includes(e.verdict)) continue;
    const reason = text(e.reason);
    if (!reason) continue; // a verdict with no reason cannot be checked by a reader
    const evidence = text(e.evidence);
    byIndex.set(index, { verdict: e.verdict as ClaimVerdict, reason, ...(evidence ? { evidence } : {}) });
  }
  return { status: 'ok', ...(typeof parsed.model === 'string' ? { model: parsed.model } : {}), byIndex };
}

/** Finalize a run folder in place (AR-02 ordering, AR-15 accounting, AR-16 snapshot, AR-18 audit, AR-19 verification). */
export function finalizeRunDir(runDir: string): FinalReview {
  const pass1 = join(runDir, 'expected-behaviours.md');
  const rawPath = join(runDir, 'review.raw.json');
  if (!existsSync(rawPath)) throw new Error(`review.raw.json is missing in ${runDir} — run the reconcile pass first`);
  if (!existsSync(pass1)) throw new Error(`blind pass output (expected-behaviours.md) is missing in ${runDir} — run Pass 1 first`);
  const pass1Time = statSync(pass1).mtime;
  const rawTime = statSync(rawPath).mtime;
  if (pass1Time.getTime() > rawTime.getTime()) {
    throw new Error(`blind pass was written after the reconcile pass (${pass1Time.toISOString()} > ${rawTime.toISOString()}) — the review is not independent`);
  }
  const pass1Text = readFileSync(pass1, 'utf8');
  if (isBlindCompromised(pass1Text)) {
    throw new Error('blind pass reported itself compromised — re-run Pass 1 in a fresh agent');
  }

  const foreignIds = foreignBlindIds(pass1Text);
  if (foreignIds.length) {
    throw new Error(`blind pass numbered its rows ${foreignIds.slice(0, 3).join(', ')}… instead of X-nn — AR-15 accounting would be skipped; re-run Pass 1 using X-nn ids`);
  }

  // AR-16 — Pass 2 must review the same generated tree the blind pass was given.
  const snapshotPath = join(runDir, 'blind-inputs.json');
  if (existsSync(snapshotPath)) {
    const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as BlindInputsSnapshot;
    if (JSON.stringify(blindInputs(snapshot.generatedDir)) !== JSON.stringify(snapshot.inputs)) {
      throw new Error(`${snapshot.generatedDir} changed since the preflight snapshot — the blind pass saw a different tree; start a new run`);
    }
  }

  let raw: RawReview;
  try {
    raw = JSON.parse(readFileSync(rawPath, 'utf8')) as RawReview;
  } catch (err) {
    throw new Error(`review.raw.json is not valid JSON: ${(err as Error).message}`);
  }

  const { review, dropped } = finalizeReview(raw, {
    runName: basename(resolve(runDir)),
    pass1WrittenAt: pass1Time.toISOString(),
    finalizedAt: new Date().toISOString(),
    blindIds: parseBlindIds(pass1Text),
    audit: runCitationAudit(runDir),
    verification: readVerification(runDir, rawTime, raw.findings?.length ?? 0),
  });
  writeFileSync(join(runDir, 'review.json'), JSON.stringify(review, null, 2) + '\n');
  writeFileSync(join(runDir, 'review.md'), renderReviewMarkdown(review));
  writeFileSync(join(runDir, 'dropped.md'), renderDroppedMarkdown(review.runName, dropped));
  return review;
}

interface ContractRef {
  source: string;
  contractId: string;
  contentHash: string;
}

export interface BlindInputs {
  requirements: string[];
  contracts: { source: string; id: string; contentHash: string }[];
  /** Contracts that appear only as a conformance skip: `source` + `id`, never the reason (review 20261013-1055, AR-05). */
  skippedContracts: { source: string; id: string }[];
  entities: string[];
}

/** `{run_dir}/blind-inputs.json`, written at preflight (AR-16). */
export interface BlindInputsSnapshot {
  generatedDir: string;
  inputs: BlindInputs;
}

/** Snapshot the blind-safe inputs into the run folder and return them. */
export function snapshotBlindInputs(generatedDir: string, runDir: string): BlindInputs {
  const inputs = blindInputs(generatedDir);
  const snapshot: BlindInputsSnapshot = { generatedDir: resolve(generatedDir), inputs };
  writeFileSync(join(runDir, 'blind-inputs.json'), JSON.stringify(snapshot, null, 2) + '\n');
  return inputs;
}

/** The blind-safe facts from the committed manifests (AR-05). */
export function blindInputs(generatedDir: string): BlindInputs {
  const readJson = (p: string): any => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : undefined);
  const contracts = new Map<string, { source: string; id: string; contentHash: string }>();
  const entities = new Set<string>();
  const add = (c: ContractRef | undefined) => {
    if (c?.source && c.contractId) contracts.set(`${c.source}/${c.contractId}`, { source: c.source, id: c.contractId, contentHash: c.contentHash });
  };

  const manifest = readJson(join(generatedDir, 'manifest.json'));
  for (const t of manifest?.tests ?? []) {
    if (t.entity) entities.add(t.entity);
    if (t.kind === 'conformance') add({ source: t.source, contractId: t.contractId, contentHash: t.contentHash });
    if (t.kind === 'compat') {
      add(t.publisher);
      add(t.consumer);
    }
  }

  // Review 20261013-1055: contracts and entities that exist only as skips were invisible to the blind pass, so it could
  // never write what a skip should have covered. Only the id/name of a skip target is taken, never its reason.
  const skippedContracts = new Map<string, { source: string; id: string }>();
  for (const s of manifest?.skipped ?? []) {
    if (typeof s?.target !== 'string') continue;
    if (s.kind === 'compat') entities.add(s.target);
    if (s.kind === 'conformance') {
      const slash = s.target.indexOf('/');
      if (slash <= 0) continue;
      const source = s.target.slice(0, slash);
      const id = s.target.slice(slash + 1);
      if (!contracts.has(`${source}/${id}`)) skippedContracts.set(`${source}/${id}`, { source, id });
    }
  }

  const requirements = new Set<string>();
  const functional = readJson(join(generatedDir, 'functional', 'manifest.json'));
  for (const p of functional?.plans ?? []) for (const id of p.requirementIds ?? []) requirements.add(id);
  for (const s of functional?.skipped ?? []) if (s.requirement) requirements.add(s.requirement);

  return {
    requirements: [...requirements].sort(natural),
    contracts: [...contracts.values()].sort((a, b) => natural(`${a.source}/${a.id}`, `${b.source}/${b.id}`)),
    skippedContracts: [...skippedContracts.values()].sort((a, b) => natural(`${a.source}/${a.id}`, `${b.source}/${b.id}`)),
    entities: [...entities].sort(natural),
  };
}

// ---- Upload (T-AR-01) -------------------------------------------------------

/** Resolve bucket/table from env vars (R-6), then .sst/outputs.json fallback. */
export function resolveAdversarialConfig(): { bucket: string; table: string } {
  const bucket = process.env['ADVERSARIAL_BUCKET'];
  const table = process.env['ADVERSARIAL_TABLE'];
  if (bucket && table) return { bucket, table };

  const outputsPath = join(resolve('.'), '.sst', 'outputs.json');
  if (!existsSync(outputsPath)) {
    throw new Error('cannot resolve bucket/table: set ADVERSARIAL_BUCKET and ADVERSARIAL_TABLE, or deploy an SST stage first');
  }
  const outputs = JSON.parse(readFileSync(outputsPath, 'utf8')) as Record<string, Record<string, unknown>>;
  let resolvedBucket: string | undefined;
  let resolvedTable: string | undefined;
  for (const stack of Object.values(outputs)) {
    if (typeof stack['ContractsBucketName'] === 'string') resolvedBucket = stack['ContractsBucketName'];
    if (typeof stack['RegistryTableName'] === 'string') resolvedTable = stack['RegistryTableName'];
  }
  if (!resolvedBucket || !resolvedTable) {
    throw new Error('ContractsBucketName or RegistryTableName not found in .sst/outputs.json');
  }
  return { bucket: resolvedBucket, table: resolvedTable };
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * Upload a finalized run folder to S3 + DynamoDB (R-5, R-1a).
 * Write order: review.json → verification.json (if present) → DynamoDB PutItem.
 * Idempotent: re-uploading overwrites S3 objects and replaces the DynamoDB item.
 */
export async function uploadRun(runDir: string): Promise<void> {
  const reviewPath = join(runDir, 'review.json');
  if (!existsSync(reviewPath)) throw new Error(`review.json not found in ${runDir} — run finalize first`);

  const reviewContent = readFileSync(reviewPath, 'utf8');
  const review = JSON.parse(reviewContent) as FinalReview;
  const reviewKind = review.skill === 'adversarial-test-review' ? 'test'
    : review.skill === 'adversarial-requirements-review' ? 'requirements'
    : 'code';
  const KIND_ATTR: Record<string, string> = { test: 'ADVERSARIAL_TEST', code: 'ADVERSARIAL_CODE', requirements: 'ADVERSARIAL_REQUIREMENTS' };
  const kindAttr = KIND_ATTR[reviewKind] ?? 'ADVERSARIAL_CODE';
  const runName = basename(resolve(runDir));
  const reviewSha256 = sha256(reviewContent);

  const { bucket, table } = resolveAdversarialConfig();
  // Use env var credentials directly so the SDK never tries to resolve an MFA-gated profile.
  const { AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN } = process.env;
  if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
    throw new Error('[adversarial-review] AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be set. Export credentials with: aws configure export-credentials --profile <profile> --format json');
  }
  const credentials = { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY, sessionToken: AWS_SESSION_TOKEN };
  const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1';
  const s3Client = new S3Client({ credentials, region });
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ credentials, region }));

  const prefix = `adversarial-runs/${reviewKind}/${runName}`;

  // R-1a write order: review.json first
  await s3Client.send(new PutObjectCommand({ Bucket: bucket, Key: `${prefix}/review.json`, Body: reviewContent, ContentType: 'application/json' }));

  // verification.json next (if present)
  let verificationSha256: string | undefined;
  const verPath = join(runDir, 'verification.json');
  if (existsSync(verPath)) {
    const verContent = readFileSync(verPath, 'utf8');
    verificationSha256 = sha256(verContent);
    await s3Client.send(new PutObjectCommand({ Bucket: bucket, Key: `${prefix}/verification.json`, Body: verContent, ContentType: 'application/json' }));
  }

  // DynamoDB PutItem (commit marker — last in write order)
  const countSev = (s: string) => review.findings.filter((f) => f.severity === s).length;
  const startedAt = review.pass1WrittenAt ?? review.finalizedAt ?? new Date().toISOString();
  const verificationStatus = review.verification?.status ?? 'not_run';

  await ddb.send(new PutCommand({
    TableName: table,
    Item: {
      PK: `ADV#${kindAttr}`,
      SK: runName,
      kind: kindAttr,
      reviewKind,
      startedAt,
      scope: review.scope,
      verdict: review.verdict,
      countCritical: countSev('Critical'),
      countMajor: countSev('Major'),
      countMinor: countSev('Minor'),
      reviewSha256,
      ...(verificationSha256 ? { verificationSha256 } : {}),
      verificationStatus,
    },
  }));
}

// ---- CLI -------------------------------------------------------------------

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  (async () => {
    const [cmd, arg, runDirArg] = process.argv.slice(2);
    try {
      if (cmd === 'finalize' && arg) {
        const r = finalizeRunDir(arg);
        const sev = (s: string) => r.findings.filter((f) => f.severity === s).length;
        const a = r.blindAccounting;
        console.log(
          `${r.verdict} — Critical ${sev('Critical')} · Major ${sev('Major')} · Minor ${sev('Minor')} · dropped by posture lint ${r.droppedByPostureLint} · unevidenced ${r.findings.filter((f) => f.unevidenced).length} · needs decision ${r.needsDecision.length}` +
            (a ? ` · blind items ${a.total} (not assessed ${a.notAssessed.length})` : '')
        );
        console.log(join(arg, 'review.md'));
      } else if (cmd === 'upload' && arg) {
        await uploadRun(arg);
        console.log(`uploaded ${basename(resolve(arg))}`);
      } else if (cmd === 'blind-inputs') {
        const generatedDir = arg ?? 'generated-tests';
        const inputs = runDirArg ? snapshotBlindInputs(generatedDir, runDirArg) : blindInputs(generatedDir);
        console.log(JSON.stringify(inputs, null, 2));
      } else {
        console.error('usage: adversarial-review-finalize.ts finalize <run_dir> | upload <run_dir> | blind-inputs [generated_dir] [run_dir]');
        process.exit(2);
      }
    } catch (err) {
      console.error(`[adversarial-review] ${(err as Error).message}`);
      process.exit(1);
    }
  })();
}
