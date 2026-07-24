/**
 * POST /generate-tests — test-generation orchestration (T-21 · R-80, R-81, R-89).
 *
 * Reads the CURRENT catalog (populated by a prior crawl — it never crawls
 * itself, R-81), runs the pure generator (`@registry/testgen`), persists the
 * artifact set to S3 + a generation-run record to DynamoDB (R-89), and returns
 * a run summary. Writer-only — the authorizer (T-09/T-23) has already enforced
 * the group. Split into a pure `performGeneration` (injected repo) so it is
 * unit-testable offline, mirroring `refresh.ts`.
 */
import { generateArtifacts, type CatalogContract, type Skip } from '@registry/testgen';
import type { CatalogEntry } from './repository.js';
import { repository } from './repository.js';
import { log } from './log.js';

export interface GenerationSummary {
  runId: string;
  startedAt: string;
  endedAt: string;
  counts: { conformance: number; compat: number; skipped: number };
  skipped: Skip[];
}

/** Minimal repository surface the generation needs (injected for testing). */
export interface GenRepo {
  listEntries(filters?: Record<string, string>): Promise<CatalogEntry[]>;
  getRaw(source: string, id: string): Promise<string | undefined>;
  putArtifacts(runId: string, artifacts: unknown): Promise<string>;
  writeGenRun(run: Record<string, unknown>): Promise<void>;
}

/** Load the current catalog, generate, persist, summarise. Never crawls (R-81). */
export async function performGeneration(repo: GenRepo, runId: string, startedAt: string): Promise<GenerationSummary> {
  const entries = await repo.listEntries();
  log.info('generate.start', { runId, entries: entries.length });

  const catalog: CatalogContract[] = [];
  for (const e of entries) {
    const rawYaml = (await repo.getRaw(e.source, e.id)) ?? '';
    catalog.push({
      source: e.source,
      entity: e.entity,
      id: e.id,
      declaredVersion: e.declaredVersion,
      contentHash: e.currentHash,
      validation: e.validation === 'invalid' ? 'invalid' : 'valid',
      rawYaml,
    });
  }

  const artifacts = generateArtifacts(catalog);
  const endedAt = new Date(nowMs()).toISOString();

  const counts = {
    conformance: artifacts.manifest.tests.filter((t) => t.kind === 'conformance').length,
    compat: artifacts.manifest.tests.filter((t) => t.kind === 'compat').length,
    skipped: artifacts.manifest.skipped.length,
  };

  // The exact catalog commit context each test was generated from (R-89) — per
  // contract content hash / commit SHA / declared version, so a reader can tell
  // whether a stored generation run is stale relative to the current catalog.
  const catalogContext = {
    count: entries.length,
    contracts: entries.map((e) => ({
      source: e.source,
      id: e.id,
      contentHash: e.currentHash,
      commitSha: e.commitSha,
      declaredVersion: e.declaredVersion,
    })),
  };

  const artifactS3Key = await repo.putArtifacts(runId, artifacts);
  await repo.writeGenRun({
    runId,
    startedAt,
    endedAt,
    counts,
    skipped: artifacts.manifest.skipped,
    catalogContext,
    artifactS3Key,
  });

  log.info('generate.done', { runId, endedAt, ...counts });
  return { runId, startedAt, endedAt, counts, skipped: artifacts.manifest.skipped };
}

/** Lambda entry (writer-only; the authorizer has already enforced the group). */
export async function handler(): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = new Date().toISOString();
  const summary = await performGeneration(repository, runId, startedAt);
  return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(summary) };
}

// `Date.now()` isolated so it is the single wall-clock touch point.
function nowMs(): number {
  return Date.now();
}
