/**
 * The report-only LLM critic (R-137…R-142, D-73, D-75).
 *
 * Two passes behind an injectable `CriticClient` (the Bedrock implementation
 * lives in the functions package, R-139; tests inject a stub):
 *   Pass 1 (blind)     — requirement + grounded context ONLY. It never sees the
 *                        plan, the emitted file, or any finding, so it cannot be
 *                        anchored by the synthesiser's output.
 *   Pass 2 (reconcile) — Pass 1's expected behaviours + plan + file +
 *                        deterministic findings → defects.
 * Pass 2's output is posture-linted (R-140) before use.
 *
 * Nothing here can withhold a plan or touch an artifact (R-130): the result
 * only feeds the report. Every failure is isolated into a status (R-141), and
 * successful results are cached by a key over everything the critic saw (R-142).
 */
import { createHash } from 'node:crypto';
import type { FunctionalTestPlan, GroundedContext } from '@registry/functest';
import { ATTACKS, SEVERITIES, type DraftFinding, type Finding } from './finding.js';
import { lintCriticFindings } from './posture-lint.js';
import { planRef, type EmittedFile, type FunctionalUnderReview } from './subject.js';

export type CriticBlindInput = Pick<GroundedContext, 'requirement' | 'entity' | 'sources' | 'schemasBySource' | 'apiTargets'>;

export interface CriticReconcileInput {
  blind: unknown;
  plan: FunctionalTestPlan;
  file: EmittedFile;
  deterministic: (Finding | DraftFinding)[];
}

export interface CriticClient {
  /** Bedrock model id / inference profile (part of the cache key). */
  modelId: string;
  /** Critic prompt version (part of the cache key). */
  promptVersion: string;
  blind(input: CriticBlindInput): Promise<unknown>;
  reconcile(input: CriticReconcileInput): Promise<unknown>;
}

export interface CriticPlanResult {
  status: 'ok' | 'failed' | 'unavailable';
  findings: DraftFinding[];
  droppedByPostureLint: number;
  malformed: number;
  reason?: string;
}

export interface CriticCache {
  get(key: string): Promise<CriticPlanResult | undefined>;
  set(key: string, value: CriticPlanResult): Promise<void>;
}

function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    const keys = Object.keys(v as object).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * Version of the stored `CriticPlanResult` shape. Part of the cache key, so an entry written under an older
 * shape is never read after the shape changes (bump it with any change to `CriticPlanResult` or `DraftFinding`).
 */
export const CRITIC_RESULT_VERSION = 1;

/** R-142 key: plan input hash + file + deterministic findings + model + prompt version + result-shape version. */
export function criticCacheKey(parts: {
  planInputHash: string;
  fileContents: string;
  deterministic: (Finding | DraftFinding)[];
  modelId: string;
  promptVersion: string;
  resultVersion?: number;
}): string {
  // Ids are run-scoped (A-nn), so they are excluded: the same findings re-key identically.
  const findings = parts.deterministic.map(({ id: _id, ...f }: Partial<Finding> & DraftFinding) => f);
  return sha256(
    stableStringify({
      planInputHash: parts.planInputHash,
      fileHash: sha256(parts.fileContents),
      findingsHash: sha256(stableStringify(findings)),
      modelId: parts.modelId,
      promptVersion: parts.promptVersion,
      resultVersion: parts.resultVersion ?? CRITIC_RESULT_VERSION,
    })
  );
}

/** Bedrock refuses the model: not granted, not enabled in-region, or unknown id (E-56). */
function isUnavailable(err: unknown): boolean {
  const e = err as { name?: string; message?: string } | undefined;
  const text = `${e?.name ?? ''} ${e?.message ?? ''}`;
  return /AccessDenied|ResourceNotFound|not enabled|don.t have access|not authorized/i.test(text);
}

/**
 * Strip credential-shaped substrings from an upstream error before it is recorded (R-141, NFR-2):
 * GitHub tokens, AWS access key ids, bearer tokens, JWTs, secret-key assignments, and the account id
 * inside an ARN. The rest of the message stays, since "not authorized to perform bedrock:InvokeModel"
 * is what makes the reason useful. Pure: this package never imports the functions package's logger.
 */
export function redactReason(s: string): string {
  return s
    .replace(/\b(?:ghp_|github_pat_|gho_|ghs_|ghu_|ghr_)[A-Za-z0-9_]+/g, '[redacted]')
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, '[redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, '[redacted]')
    .replace(/(secret[_ ]?(?:access[_ ]?)?key["'\s=:]+)[A-Za-z0-9/+=]{16,}/gi, '$1[redacted]')
    .replace(/(arn:aws[a-z-]*:[a-z0-9-]*:[a-z0-9-]*:)\d{12}(:)/g, '$1[redacted]$2');
}

function reasonOf(err: unknown): string {
  const e = err as { name?: string; message?: string } | undefined;
  const name = e?.name && e.name !== 'Error' ? `${e.name}: ` : '';
  return redactReason(`${name}${e?.message ?? String(err)}`).slice(0, 300);
}

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;
const isText = (s: unknown): s is string => typeof s === 'string' && s.trim().length > 0;

/** A finding the review stage can count, sort and render: the fields `finalizeFindings` and `countFindings` read. */
function isDraftFinding(v: unknown): v is DraftFinding {
  const f = v as Partial<DraftFinding> | null | undefined;
  if (!f || typeof f !== 'object' || Array.isArray(f)) return false;
  const t = f.target as { kind?: unknown; ref?: unknown } | undefined;
  return (
    ATTACKS.includes(f.attack as DraftFinding['attack']) &&
    SEVERITIES.includes(f.severity as DraftFinding['severity']) &&
    !!t &&
    typeof t === 'object' &&
    isText(t.kind) &&
    isText(t.ref) &&
    isText(f.defect) &&
    isText(f.failureScenario)
  );
}

/**
 * A cached object is trusted only if its CONTENTS are valid, not merely its outline: a finding with no
 * `attack` reaches `countFindings` as `counts[undefined][…]++` and takes the whole review down. Anything
 * else is a miss, so the critic simply runs again (R-141, R-142).
 */
function isPlanResult(v: unknown): v is CriticPlanResult {
  const r = v as Partial<CriticPlanResult> | null | undefined;
  if (!r || typeof r !== 'object' || Array.isArray(r)) return false;
  return (
    ['ok', 'failed', 'unavailable'].includes(r.status as string) &&
    Array.isArray(r.findings) &&
    r.findings.every(isDraftFinding) &&
    isCount(r.droppedByPostureLint) &&
    isCount(r.malformed) &&
    (r.reason === undefined || typeof r.reason === 'string')
  );
}

/** R-139 / E-57: the critic must be a different model from the synthesiser. */
export function criticIndependence(criticModelId: string, synthModelId: string): 'ok' | 'degraded' {
  return criticModelId === synthModelId ? 'degraded' : 'ok';
}

export async function runCritic(
  u: FunctionalUnderReview,
  deterministic: (Finding | DraftFinding)[],
  client: CriticClient,
  cache: CriticCache
): Promise<CriticPlanResult> {
  const key = criticCacheKey({
    planInputHash: u.plan.inputHash,
    fileContents: u.file.contents,
    deterministic,
    modelId: client.modelId,
    promptVersion: client.promptVersion,
  });
  // The cache is an optimisation: a read that throws (S3 error) or returns junk is a miss, never a failure (R-141).
  let cached: CriticPlanResult | undefined;
  try {
    const hit = await cache.get(key);
    if (isPlanResult(hit)) cached = hit;
  } catch {
    /* miss */
  }
  if (cached) return cached;

  const { requirement, entity, sources, schemasBySource, apiTargets } = u.context;
  const blindInput: CriticBlindInput = { requirement, entity, sources, schemasBySource, apiTargets };

  let raw: unknown;
  try {
    const blind = await client.blind(blindInput);
    raw = await client.reconcile({ blind, plan: u.plan, file: u.file, deterministic });
  } catch (err) {
    return {
      status: isUnavailable(err) ? 'unavailable' : 'failed',
      findings: [],
      droppedByPostureLint: 0,
      malformed: 0,
      reason: reasonOf(err),
    };
  }

  const lint = lintCriticFindings(raw, planRef(u), u.file.path);
  if (!Array.isArray((raw as { findings?: unknown } | null)?.findings)) {
    return {
      status: 'failed',
      findings: [],
      droppedByPostureLint: 0,
      malformed: lint.malformed,
      reason: 'malformed critic output (no findings list)',
    };
  }

  const result: CriticPlanResult = {
    status: 'ok',
    findings: lint.kept,
    droppedByPostureLint: lint.droppedByPostureLint,
    malformed: lint.malformed,
  };
  try {
    await cache.set(key, result);
  } catch {
    /* an unwritable cache costs a re-run next time, not this plan's result (R-141) */
  }
  return result;
}
