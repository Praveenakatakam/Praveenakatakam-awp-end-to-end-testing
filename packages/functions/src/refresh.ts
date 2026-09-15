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
import { createHash } from 'node:crypto';
import {
  crawlSourceFull,
  parseAndValidate,
  extractMetadata,
  parseRequirements,
  extractSpecVersion,
  deriveEarsType,
  deriveModality,
  createOctokitApi,
  SOURCES,
  type GitHubApi,
  type SourceConfig,
  type ParsedRequirement,
} from '@registry/core';
import { Config } from 'sst/node/config';
import { LockHeldError, repository, type IngestInput, type IngestOutcome, type RequirementCounts } from './repository.js';
import { log, redact } from './log.js';
import { JiraApiClient, extractAdfText, basicAuthHeader, type JiraStory, type AdfDocument } from './jira.js';
import { convertToEars } from './llm.js';

// Single-flight lock TTL fallback (D-15): a crashed crawl's lock self-expires
// after 5 min so it cannot deadlock future runs. Comfortably exceeds the
// synchronous crawl's own budget (NFR-1: <30 s) with wide margin for retries.
const LOCK_TTL_SECONDS = 300;

export interface SourceOutcome {
  label: string;
  outcome: 'success' | 'failed';
  /** Contract-catalog counts — GitHub sources only; a Jira source has no contract files (D-J2). */
  discovered?: number;
  valid?: number;
  /** Per-story processing failures (JR-16) for a Jira source, or invalid contract files for a GitHub source. */
  invalid?: number;
  newVersion?: number;
  unchanged?: number;
  reason?: string;
  /** Effective crawl config (branch + path prefix) for diagnostics — GitHub sources only. */
  branch?: string;
  pathPrefix?: string;
  /** Per-source EARS requirement counts (§3.10, R-108). */
  requirements?: RequirementCounts;
}

/** A GitHub source outcome always carries its contract-catalog counts (unlike a Jira outcome). */
interface GitHubSourceOutcome extends SourceOutcome {
  discovered: number;
  valid: number;
  invalid: number;
  newVersion: number;
  unchanged: number;
  branch: string;
}

/** Jira source configuration, built from SST Parameters + Secret at Lambda startup (design §2.1, §2.5). */
export interface JiraSourceConfig {
  label: string;
  baseUrl: string;
  jql: string;
  acFieldId: string;
  serviceAccountEmail: string;
}

/** Minimal Jira client surface the crawl needs (injected for testing; `JiraApiClient` satisfies this). */
export interface JiraApi {
  search(jql: string, acFieldId: string, opts: { timeoutMs: number }): AsyncGenerator<JiraStory>;
}

export interface JiraCrawlOptions {
  sources: JiraSourceConfig[];
  clientFor: (source: JiraSourceConfig) => JiraApi;
  convert?: (rawText: string, opts: { timeoutMs: number }) => Promise<string>;
  /** Literal secret values (API token, service-account email) to scrub from any logged/recorded error (NFR-J2). */
  secrets?: (string | undefined)[];
}

const JIRA_SEARCH_TIMEOUT_MS = 20_000; // NFR-J1 per-source ceiling
const OVERALL_CRAWL_BUDGET_MS = 28_000; // NFR-1's 30s Lambda timeout, 2s safety margin
const EARS_CONVERSION_TIMEOUT_MS = 10_000; // NFR-J3

function isEarsConforming(text: string): boolean {
  return /\b(WHEN|IF|WHILE|WHERE)\b/.test(text) && /\b(SHALL|SHOULD|MAY)\b/.test(text);
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
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
    opts: { contentHash: string; sourceVersion?: string; rawSnapshot?: string; snapshotKey?: string }
  ): Promise<RequirementCounts>;
  wipeRequirements(source: string, snapshotKey?: string): Promise<RequirementCounts>;
  getEarsCache(rawTextHash: string): Promise<string | null>;
  putEarsCache(rawTextHash: string, earsText: string): Promise<void>;
}

/**
 * Crawl one Jira source (design §3.6). Lets a whole-search failure (network,
 * auth, rate-limit exhaustion, cumulative timeout) propagate uncaught — the
 * caller (performCrawl) applies the same per-source fault isolation used for
 * GitHub sources (JR-15, NFR-J4), and `putRequirements` is never reached in
 * that case, leaving the prior snapshot untouched.
 */
async function crawlJiraSource(
  client: JiraApi,
  source: JiraSourceConfig,
  repo: CrawlRepo,
  runId: string,
  convert: (rawText: string, opts: { timeoutMs: number }) => Promise<string> = convertToEars,
  searchTimeoutMs: number = JIRA_SEARCH_TIMEOUT_MS,
  secrets: (string | undefined)[] = []
): Promise<SourceOutcome> {
  const rawStories: JiraStory[] = [];
  const parsedRequirements: ParsedRequirement[] = [];
  let invalid = 0;

  for await (const story of client.search(source.jql, source.acFieldId, { timeoutMs: searchTimeoutMs })) {
    try {
      const rawAc = extractAdfText(story.fields[source.acFieldId] as AdfDocument | null | undefined);
      if (rawAc.trim() === '') continue; // JR-11 — absent/blank AC, skip without error

      const parent = story.fields.parent;
      const section = parent?.fields.summary ?? parent?.key ?? 'Uncategorised'; // JR-31
      const jiraUrl = `${source.baseUrl}/browse/${story.key}`; // JR-30

      let text = rawAc;
      let rawText: string | undefined;

      if (!isEarsConforming(rawAc)) {
        rawText = rawAc;
        const hash = sha256(rawAc);
        const cached = await repo.getEarsCache(hash); // JR-23
        if (cached) {
          text = cached;
        } else {
          try {
            text = await convert(rawAc, { timeoutMs: EARS_CONVERSION_TIMEOUT_MS });
            await repo.putEarsCache(hash, text);
          } catch {
            text = rawAc; // JR-22 fallback — store raw text, non-conforming
          }
        }
      }

      parsedRequirements.push({
        id: story.key, // JR-13
        text,
        section,
        earsType: deriveEarsType(text), // JR-21
        modality: deriveModality(text), // JR-21
        earsConforming: deriveModality(text) !== null,
        ...(rawText !== undefined ? { rawText } : {}), // JR-30 — omitted when text === rawAc
        jiraUrl,
      });
      rawStories.push(story);
    } catch (storyErr) {
      invalid++;
      log.warn('crawl.jira.story.failed', { runId, key: story.key, reason: redact((storyErr as Error).message, secrets) }); // JR-16
    }
  }

  if (rawStories.length === 0) {
    // 0 JQL results — treat as unchanged, not absent; never wipe (edge case table).
    return {
      label: source.label,
      outcome: 'success',
      invalid,
      requirements: { discovered: 0, conforming: 0, nonConforming: 0, changed: 0, removed: 0 },
    };
  }

  const rawSnapshot = JSON.stringify(rawStories);
  const counts = await repo.putRequirements(source.label, parsedRequirements, {
    contentHash: sha256(rawSnapshot), // JR-32
    rawSnapshot, // JR-17 (OQ-J7 — always store, for provenance)
    snapshotKey: `requirements/${source.label}/snapshot.json`,
  });
  if (counts.collisions?.length) {
    log.warn('crawl.jira.requirements.collision', { runId, source: source.label, ids: counts.collisions }); // D-49
  }
  return { label: source.label, outcome: 'success', invalid, requirements: counts };
}

/** Crawl every source and ingest their contracts. Never locks; never throws per-source. */
export async function performCrawl(
  api: GitHubApi,
  sources: SourceConfig[],
  repo: CrawlRepo,
  runId: string,
  startedAt: string,
  jira?: JiraCrawlOptions
): Promise<CrawlSummary> {
  const outcomes: SourceOutcome[] = [];
  const collisions: Collision[] = [];
  log.info('crawl.start', { runId, sources: sources.map((s) => s.label) });
  // Overall budget for GitHub + Jira combined (NFR-1: 30s Lambda timeout, 2s
  // safety margin) — the Jira phase gets whatever's left after GitHub, capped
  // at its own 20s ceiling (NFR-J1), not a fresh 20s regardless of elapsed time.
  const overallDeadline = new Date(startedAt).getTime() + OVERALL_CRAWL_BUDGET_MS;

  for (const source of sources) {
    const counts: GitHubSourceOutcome = {
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
            contentHash: specRef.sha,
            sourceVersion: extractSpecVersion(content),
            rawSnapshot: content,
            snapshotKey: `requirements/${source.label}/snapshot.md`,
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

  // Jira sources (JR-10): a separate loop, fault-isolated from GitHub sources
  // and from each other in exactly the same way (NFR-J4, mirrors R-13).
  for (const jiraSource of jira?.sources ?? []) {
    const remainingMs = overallDeadline - Date.now();
    if (remainingMs <= 0) {
      // The GitHub phase alone used the whole budget — fail gracefully rather
      // than start a search AWS will kill mid-flight when the Lambda itself
      // times out (NFR-J1).
      const reason = 'no crawl time budget remaining after earlier sources completed';
      log.error('crawl.jira.source.failed', { runId, source: jiraSource.label, reason });
      outcomes.push({ label: jiraSource.label, outcome: 'failed', reason });
      continue;
    }
    try {
      const client = jira!.clientFor(jiraSource);
      const outcome = await crawlJiraSource(
        client,
        jiraSource,
        repo,
        runId,
        jira!.convert,
        Math.min(JIRA_SEARCH_TIMEOUT_MS, remainingMs),
        jira!.secrets
      );
      log.info('crawl.jira.source.done', { runId, ...outcome });
      outcomes.push(outcome);
    } catch (err) {
      const reason = redact((err as Error).message, jira!.secrets);
      log.error('crawl.jira.source.failed', { runId, source: jiraSource.label, reason });
      outcomes.push({ label: jiraSource.label, outcome: 'failed', reason });
    }
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
  startedAt: string,
  jira?: JiraCrawlOptions
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
    const summary = await performCrawl(api, sources, repo, runId, startedAt, jira);
    await repo.writeRun(summary);
    return { statusCode: 200, body: JSON.stringify(summary) };
  } finally {
    await repo.releaseLock();
  }
}

/** Jira fast-fail: an absent/blank token must stop the refresh before any crawl begins (design §2.5, edge case table). */
export function assertJiraConfigured(cfg: Record<string, string | undefined>): void {
  if (!cfg.JIRA_API_TOKEN) throw new Error('JIRA_API_TOKEN secret is absent or blank');
}

/** Lambda entry (writer-only; the authorizer has already enforced the group). */
export async function handler(): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
  const cfg = Config as unknown as Record<string, string>;
  assertJiraConfigured(cfg);
  const api = createOctokitApi(cfg.GITHUB_TOKEN);

  // Apply SST Parameter overrides so branch and path prefix can be changed
  // per stage without a code redeploy.
  const sources: SourceConfig[] = SOURCES.map((s) => ({
    ...s,
    ...(cfg.SOURCE_BRANCH ? { branch: cfg.SOURCE_BRANCH } : {}),
    ...(cfg.CONTRACT_PATH_PREFIX ? { contractPathPrefix: cfg.CONTRACT_PATH_PREFIX } : {}),
  }));

  // Single Jira source wired at deploy time (design note D-2); the array shape
  // supports more without a code change once more SST Parameters are added.
  const jiraSources: JiraSourceConfig[] = [
    {
      label: cfg.JIRA_SOURCE_LABEL,
      baseUrl: cfg.JIRA_BASE_URL,
      jql: cfg.JIRA_JQL,
      acFieldId: cfg.JIRA_AC_FIELD_ID,
      serviceAccountEmail: cfg.JIRA_SERVICE_ACCOUNT_EMAIL,
    },
  ];

  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = new Date().toISOString();
  const res = await handleRefresh(api, sources, repository, runId, startedAt, {
    sources: jiraSources,
    clientFor: (s) => new JiraApiClient(s.baseUrl, basicAuthHeader(s.serviceAccountEmail, cfg.JIRA_API_TOKEN)),
    secrets: [cfg.JIRA_API_TOKEN, cfg.JIRA_SERVICE_ACCOUNT_EMAIL],
  });
  return { statusCode: res.statusCode, headers: { 'content-type': 'application/json' }, body: res.body };
}

// `Date.now()` isolated so it is the single wall-clock touch point.
function nowMs(): number {
  return Date.now();
}
