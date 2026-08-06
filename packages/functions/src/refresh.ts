/**
 * POST /refresh — crawl orchestration (T-12 · R-10…R-15, R-23).
 *
 * Acquires the single-flight lock, crawls every source (fault-isolated: one
 * failing source/file never aborts the rest — R-13, D-9), validates and
 * catalogs each `contract/*.odcs.yaml`, records an id-collision warning for
 * duplicate ids within a source (R-30a), writes the run summary (R-12), and
 * releases the lock. The authorizer (T-09) has already enforced the `writer`
 * group before this runs.
 */
import {
  crawlSourceFull,
  parseAndValidate,
  extractMetadata,
  parseRequirements,
  extractSpecVersion,
  createOctokitApi,
  SOURCES,
  type GitHubApi,
  type SourceConfig,
  type ParsedRequirement,
} from '@registry/core';
import { Config } from 'sst/node/config';
import { LockHeldError, repository, type IngestInput, type IngestOutcome, type RequirementCounts } from './repository.js';
import { log, redact } from './log.js';

// Single-flight lock TTL fallback (D-15): a crashed crawl's lock self-expires
// after 5 min so it cannot deadlock future runs. Comfortably exceeds the
// synchronous crawl's own budget (NFR-1: <30 s) with wide margin for retries.
const LOCK_TTL_SECONDS = 300;

export interface SourceOutcome {
  label: string;
  outcome: 'success' | 'failed';
  discovered: number;
  valid: number;
  invalid: number;
  newVersion: number;
  unchanged: number;
  reason?: string;
  /** Effective crawl config (branch + path prefix) for diagnostics. */
  branch: string;
  pathPrefix?: string;
  /** Per-source EARS requirement counts (§3.10, R-108). */
  requirements?: RequirementCounts;
}
export interface Collision {
  source: string;
  id: string;
  paths: string[];
}
export interface CrawlSummary {
  runId: string;
  startedAt: string;
  endedAt: string;
  sources: SourceOutcome[];
  collisions: Collision[];
}

/** Minimal repository surface the crawl needs (injected for testing). */
export interface CrawlRepo {
  acquireLock(runId: string, ttl: number): Promise<void>;
  releaseLock(): Promise<void>;
  ingestContract(input: IngestInput): Promise<{ outcome: IngestOutcome; version: number; versionNotBumped: boolean }>;
  writeRun(run: CrawlSummary): Promise<void>;
  putRequirements(
    source: string,
    parsed: import('@registry/core').ParsedRequirement[],
    opts: { specHash: string; specVersion?: string; rawSpec: string }
  ): Promise<RequirementCounts>;
  wipeRequirements(source: string): Promise<RequirementCounts>;
}

/** Crawl every source and ingest their contracts. Never locks; never throws per-source. */
export async function performCrawl(
  api: GitHubApi,
  sources: SourceConfig[],
  repo: CrawlRepo,
  runId: string,
  startedAt: string
): Promise<CrawlSummary> {
  const outcomes: SourceOutcome[] = [];
  const collisions: Collision[] = [];
  log.info('crawl.start', { runId, sources: sources.map((s) => s.label) });

  for (const source of sources) {
    const counts: SourceOutcome = {
      label: source.label,
      outcome: 'success',
      discovered: 0,
      valid: 0,
      invalid: 0,
      newVersion: 0,
      unchanged: 0,
      branch: source.branch,
      pathPrefix: source.contractPathPrefix,
    };
    try {
      const { files, specRef } = await crawlSourceFull(api, source);
      counts.discovered = files.length;
      const seenIds = new Map<string, string>(); // id -> first path (collision detection)

      for (const file of files) {
        const result = parseAndValidate(file.bytes);
        const meta = extractMetadata(result.parsed, file.path);
        const contractSource = meta.domain ?? source.label;

        if (result.validation === 'valid') counts.valid++;
        else {
          counts.invalid++;
          // Per-file failure with the offending path/id (NFR-5).
          log.warn('crawl.file.invalid', { runId, source: contractSource, path: file.path, id: meta.id });
        }

        // In-source id collision: catalog the first, warn on the rest (R-30a).
        if (meta.id && seenIds.has(meta.id)) {
          collisions.push({ source: contractSource, id: meta.id, paths: [seenIds.get(meta.id)!, file.path] });
          log.warn('crawl.id.collision', { runId, source: contractSource, id: meta.id, paths: [seenIds.get(meta.id)!, file.path] });
          continue;
        }
        if (meta.id) seenIds.set(meta.id, file.path);

        const ingest = await repo.ingestContract({
          source: contractSource,
          id: meta.id,
          entity: meta.entity,
          name: meta.name,
          domain: meta.domain,
          path: file.path,
          blobSha: file.blobSha,
          commitSha: file.commitSha,
          bytes: file.bytes,
          declaredVersion: meta.version,
          validation: result.validation,
          validationErrors: result.errors,
        });
        if (ingest.outcome === 'unchanged') counts.unchanged++;
        else counts.newVersion++;
      }

      // EARS requirements (§3.10, R-101). Isolated in its own try/catch so any
      // failure here — fetching `docs/spec.md`'s bytes, parsing, or storing —
      // marks only this source's requirements failed (crawl.requirements.failed)
      // without discarding its already-cataloged contracts (R-105a, NFR-4). The
      // spec-doc blob fetch happens HERE (not in crawlSourceFull) so a transient
      // read error on `docs/spec.md` stays isolated. A whole-source crawl failure
      // (tree/contract-blob) is different — it throws out of crawlSourceFull into
      // the OUTER catch (crawl.source.failed, prior requirements kept — R-105/E-36).
      try {
        if (specRef) {
          const content = await api.blob(source.owner, source.repo, specRef.sha);
          const parsed: ParsedRequirement[] = parseRequirements(content);
          counts.requirements = await repo.putRequirements(source.label, parsed, {
            specHash: specRef.sha,
            specVersion: extractSpecVersion(content),
            rawSpec: content,
          });
        } else {
          // docs/spec.md absent (source reachable) → the source now declares zero
          // requirements: wipe the prior snapshot (latest-snapshot, R-105/D-45).
          counts.requirements = await repo.wipeRequirements(source.label);
        }
        // In-source duplicate requirement ids: first kept, warn on the rest (D-49, E-38).
        if (counts.requirements.collisions?.length) {
          log.warn('crawl.requirements.collision', { runId, source: source.label, ids: counts.requirements.collisions });
        }
        log.info('crawl.requirements.done', { runId, source: source.label, ...counts.requirements });
      } catch (reqErr) {
        const reason = redact((reqErr as Error).message);
        counts.requirements = { discovered: 0, conforming: 0, nonConforming: 0, changed: 0, removed: 0, failed: true, reason };
        log.error('crawl.requirements.failed', { runId, source: source.label, reason });
      }
    } catch (err) {
      // Fault isolation: mark just this source failed and continue (R-13).
      // The reason comes from an uncontrolled client error — redact any
      // token-shaped substring before it reaches logs or the response (NFR-2).
      counts.outcome = 'failed';
      counts.reason = redact((err as Error).message);
      // Per-source failure with its (redacted) reason (NFR-5).
      log.error('crawl.source.failed', { runId, source: source.label, reason: counts.reason });
    }
    // Per-source outcome (NFR-5).
    log.info('crawl.source.done', { runId, ...counts });
    outcomes.push(counts);
  }

  const endedAt = new Date(nowMs()).toISOString();
  log.info('crawl.done', { runId, endedAt, sources: outcomes.length, collisions: collisions.length });
  return { runId, startedAt, endedAt, sources: outcomes, collisions };
}

/** Full refresh: lock → crawl → write run → unlock. Maps LockHeld → 409 (R-15). */
export async function handleRefresh(
  api: GitHubApi,
  sources: SourceConfig[],
  repo: CrawlRepo,
  runId: string,
  startedAt: string
): Promise<{ statusCode: number; body: string }> {
  try {
    await repo.acquireLock(runId, LOCK_TTL_SECONDS);
  } catch (err) {
    if (err instanceof LockHeldError) {
      // 409 names the in-flight run (R-15, E-11).
      return { statusCode: 409, body: JSON.stringify({ error: 'crawl_in_progress', runId: err.runId }) };
    }
    throw err;
  }
  try {
    const summary = await performCrawl(api, sources, repo, runId, startedAt);
    await repo.writeRun(summary);
    return { statusCode: 200, body: JSON.stringify(summary) };
  } finally {
    await repo.releaseLock();
  }
}

/** Lambda entry (writer-only; the authorizer has already enforced the group). */
export async function handler(): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
  const cfg = Config as unknown as Record<string, string>;
  const api = createOctokitApi(cfg.GITHUB_TOKEN);

  // Apply SST Parameter overrides so branch and path prefix can be changed
  // per stage without a code redeploy.
  const sources: SourceConfig[] = SOURCES.map((s) => ({
    ...s,
    ...(cfg.SOURCE_BRANCH ? { branch: cfg.SOURCE_BRANCH } : {}),
    ...(cfg.CONTRACT_PATH_PREFIX ? { contractPathPrefix: cfg.CONTRACT_PATH_PREFIX } : {}),
  }));

  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = new Date().toISOString();
  const res = await handleRefresh(api, sources, repository, runId, startedAt);
  return { statusCode: res.statusCode, headers: { 'content-type': 'application/json' }, body: res.body };
}

// `Date.now()` isolated so it is the single wall-clock touch point.
function nowMs(): number {
  return Date.now();
}
