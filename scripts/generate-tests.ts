/**
 * generate-tests CLI (T-24 · R-91, R-92, D-33, D-34).
 *
 * Lands the generated end-to-end tests in this repo. Modes:
 *   (default)     auth as writer → POST /generate-tests → pull latest artifacts → write tree
 *                 AND POST /generate-functional-tests → poll → write generated-tests/functional/
 *   --pull        pull the latest existing generation run only (no new generation)
 *   --local       reader → GET /contracts (+/raw) → run the SAME pure core → write tree
 *                 (skips functional — no LLM path in local mode)
 *   --skip-functional  skip the LLM functional generation step. Also honoured via
 *                 SKIP_FUNCTIONAL=1 (useful under `sst bind`, whose arg parser eats
 *                 bare flags before the script sees them).
 *
 * It writes files ONLY — it never stages, commits, or pushes (D-34). The human
 * reviews `git diff` and commits. The tree is replaced wholesale each run so
 * stale files for removed contracts disappear (R-92, E-28).
 *
 * Zero-config via `sst bind` (D-35): run as `npm run generate-tests`, which is
 * `sst bind tsx scripts/generate-tests.ts`. `sst bind` injects the app/stage's
 * SSM-backed config, so the CLI reads the endpoint coordinates and the writer
 * credential straight from the resource bindings — no committed config file, no
 * `.env`, no prompt:
 *   - REGISTRY_API_URL       (Api resource binding, sst/node/api — Api.Api.url)
 *   - USER_POOL_CLIENT_ID    (Config.Parameter, AuthStack)
 *   - REGISTRY_DEMO_PASSWORD (Config.Secret, the seeded writer@demo password)
 * Plain environment variables override any of these (REGISTRY_TOKEN to skip
 * login entirely; REGISTRY_USERNAME/REGISTRY_PASSWORD; AWS_REGION; STAGE). If
 * neither `sst bind` nor an override supplies a credential, the CLI exits with
 * a directive error — it never hangs.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateArtifacts, serializeManifest, type ArtifactSet, type CatalogContract } from '@registry/testgen';
import { serializeFunctionalManifest, type FunctionalArtifactSet } from '@registry/functest';

export type FetchImpl = typeof fetch;

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const OUTPUT_DIR = join(REPO_ROOT, 'generated-tests');

// Untyped JSON bodies from the read/write API. Each caller supplies the shape it
// expects via the type parameter (default `unknown`) — this keeps the parse site
// free of an explicit `any` (no-explicit-any) while giving callers real types.
async function getJson<T = unknown>(fetchImpl: FetchImpl, url: string, token: string): Promise<T> {
  const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.json() as Promise<T>;
}

/** POST /generate-tests (writer) → run summary (R-80). */
export async function triggerGeneration(
  fetchImpl: FetchImpl,
  apiUrl: string,
  token: string,
): Promise<{ runId: string; counts: Record<string, number> }> {
  const res = await fetchImpl(`${apiUrl}/generate-tests`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`POST /generate-tests → ${res.status}`);
  return res.json() as Promise<{ runId: string; counts: Record<string, number> }>;
}

/** GET /test-artifacts/latest → the artifact set (R-90). */
export async function fetchLatestArtifacts(fetchImpl: FetchImpl, apiUrl: string, token: string): Promise<ArtifactSet> {
  const body = await getJson<{ artifacts?: ArtifactSet }>(fetchImpl, `${apiUrl}/test-artifacts/latest`, token);
  if (!body?.artifacts) throw new Error('no artifacts in the latest generation run');
  return body.artifacts;
}

/** Build a CatalogContract[] from the read API (used by --local, R-91/D-33). */
export async function buildCatalogFromApi(fetchImpl: FetchImpl, apiUrl: string, token: string): Promise<CatalogContract[]> {
  type ContractListItem = {
    source: string;
    entity: string;
    id: string;
    declaredVersion: string;
    currentHash: string;
    validation: string;
  };
  const { items } = await getJson<{ items?: ContractListItem[] }>(fetchImpl, `${apiUrl}/contracts`, token);
  const catalog: CatalogContract[] = [];
  for (const e of items ?? []) {
    const rawYaml = await (
      await fetchImpl(`${apiUrl}/contracts/${e.source}/${e.id}/raw`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).text();
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
  return catalog;
}

/** Generate locally against the read API (same pure core as the endpoint — D-33). */
export async function generateLocally(fetchImpl: FetchImpl, apiUrl: string, token: string): Promise<ArtifactSet> {
  return generateArtifacts(await buildCatalogFromApi(fetchImpl, apiUrl, token));
}

/**
 * Write the artifact set into `destDir`, replacing the tree wholesale (R-92, E-28):
 * conformance/ and compat/ are cleared first so stale files disappear. Returns
 * the written repo-relative paths, sorted. Never commits (D-34).
 */
export function writeArtifactTree(destDir: string, artifacts: ArtifactSet): string[] {
  rmSync(join(destDir, 'conformance'), { recursive: true, force: true });
  rmSync(join(destDir, 'compat'), { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });

  const written: string[] = [];
  writeFileSync(join(destDir, 'manifest.json'), serializeManifest(artifacts.manifest));
  written.push('manifest.json');

  for (const f of artifacts.files) {
    const full = join(destDir, f.path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, f.contents);
    written.push(f.path);
  }
  return written.sort();
}

// ---- Functional (LLM) generation — `--functional` (T-38 · §3.11, R-126) ----

/** POST /generate-functional-tests (writer) → { jobId, status } (async, 202 · R-115). */
export async function triggerFunctionalGeneration(
  fetchImpl: FetchImpl,
  apiUrl: string,
  token: string
): Promise<{ jobId: string; status?: string }> {
  const res = await fetchImpl(`${apiUrl}/generate-functional-tests`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status !== 202) throw new Error(`POST /generate-functional-tests → ${res.status} (expected 202)`);
  const body = (await res.json()) as { jobId?: string; status?: string };
  if (!body?.jobId) throw new Error('no jobId in the generation response');
  return { jobId: body.jobId, status: body.status };
}

/** Terminal-state record for an async functional-generation job (R-125). */
export interface FunctionalJob {
  status?: string;
  error?: string;
  planCount?: number;
  skipCount?: number;
}

export interface PollOptions {
  /** Max polls before giving up (default 60). */
  attempts?: number;
  /** Delay between polls, ms (default 5000). */
  intervalMs?: number;
  /** Injectable sleep (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
  /** Progress sink (default console.log). */
  onProgress?: (status: string, attempt: number) => void;
}

/**
 * Poll GET /functional-test-jobs/{jobId} until the job reaches a terminal state
 * (R-125). Returns the final `{ job, artifacts }`; throws on `failed` (surfacing
 * the recorded reason) or when the attempt budget is exhausted — never hangs.
 */
export async function pollFunctionalJob(
  fetchImpl: FetchImpl,
  apiUrl: string,
  token: string,
  jobId: string,
  opts: PollOptions = {}
): Promise<{ job: FunctionalJob; artifacts: FunctionalArtifactSet }> {
  const attempts = opts.attempts ?? 60;
  const intervalMs = opts.intervalMs ?? 5000;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const onProgress = opts.onProgress ?? ((s, a) => console.log(`[generate-tests] job ${jobId}: ${s} (poll ${a})`));

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const body = await getJson<{ job?: FunctionalJob; artifacts?: FunctionalArtifactSet }>(
      fetchImpl,
      `${apiUrl}/functional-test-jobs/${jobId}`,
      token
    );
    const job = body?.job;
    const status = job?.status ?? 'unknown';
    onProgress(status, attempt);
    if (status === 'succeeded') {
      if (!job || !body.artifacts) throw new Error(`job ${jobId} succeeded but returned no artifacts`);
      return { job, artifacts: body.artifacts };
    }
    if (status === 'failed') throw new Error(`job ${jobId} failed: ${body.job?.error ?? 'unknown reason'}`);
    if (attempt < attempts) await sleep(intervalMs);
  }
  throw new Error(`job ${jobId} did not finish within ${attempts} poll(s)`);
}

/**
 * Write the functional artifact set under `destDir/functional/`, replacing that
 * subtree wholesale (R-123, mirrors `writeArtifactTree`). Emitted file paths
 * already begin with `functional/`. Never commits (D-34, D-56).
 */
export function writeFunctionalArtifactTree(destDir: string, artifacts: FunctionalArtifactSet): string[] {
  rmSync(join(destDir, 'functional'), { recursive: true, force: true });
  mkdirSync(join(destDir, 'functional'), { recursive: true });

  const written: string[] = [];
  writeFileSync(join(destDir, 'functional', 'manifest.json'), serializeFunctionalManifest(artifacts.manifest));
  written.push('functional/manifest.json');

  for (const f of artifacts.files) {
    const full = join(destDir, f.path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, f.contents);
    written.push(f.path);
  }
  return written.sort();
}

export const DEFAULT_USERNAME = 'writer@demo';

/** Keys the CLI reads, from `sst bind` Config or (overriding) the environment. */
export const SETTING_KEYS = [
  'REGISTRY_API_URL',
  'USER_POOL_CLIENT_ID',
  'REGISTRY_DEMO_PASSWORD',
  'REGISTRY_TOKEN',
  'REGISTRY_USERNAME',
  'REGISTRY_PASSWORD',
  'AWS_REGION',
  'AWS_DEFAULT_REGION',
] as const;

export interface Settings {
  apiUrl: string;
  clientId?: string;
  region: string;
  token?: string;
  username: string;
  password?: string;
}

/**
 * Resolve all CLI settings from a flat key→value bag — the merge of `sst bind`
 * Config with overriding environment variables (D-35). Pure + testable. Throws
 * a directive error when a required value is missing anywhere.
 */
export function resolveSettings(v: Record<string, string | undefined>): Settings {
  const apiUrl = v.REGISTRY_API_URL;
  if (!apiUrl) {
    throw new Error('no registry API URL — run `npm run generate-tests` (sst bind injects REGISTRY_API_URL) or set REGISTRY_API_URL');
  }
  const token = v.REGISTRY_TOKEN;
  // Writer password: an explicit override wins, else the seeded writer@demo
  // secret that `sst bind` surfaces as REGISTRY_DEMO_PASSWORD.
  const password = v.REGISTRY_PASSWORD ?? v.REGISTRY_DEMO_PASSWORD;
  if (!token && !password) {
    throw new Error(
      'no credential — run `npm run generate-tests` (sst bind injects the writer secret) or set REGISTRY_TOKEN / REGISTRY_PASSWORD'
    );
  }
  return {
    apiUrl: apiUrl.replace(/\/$/, ''),
    clientId: v.USER_POOL_CLIENT_ID,
    region: v.AWS_REGION ?? v.AWS_DEFAULT_REGION ?? 'us-east-1',
    token,
    username: v.REGISTRY_USERNAME || DEFAULT_USERNAME,
    password,
  };
}

/** Mint a Cognito access token (USER_PASSWORD_AUTH) unless one was supplied. */
export async function resolveToken(s: Settings): Promise<string> {
  if (s.token) return s.token;
  if (!s.clientId) {
    throw new Error(
      'no user-pool client id — run `npm run generate-tests` (sst bind injects USER_POOL_CLIENT_ID) or set USER_POOL_CLIENT_ID'
    );
  }
  const { CognitoIdentityProviderClient, InitiateAuthCommand } = await import('@aws-sdk/client-cognito-identity-provider');
  const client = new CognitoIdentityProviderClient({ region: s.region });
  const out = await client.send(
    new InitiateAuthCommand({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: s.clientId,
      AuthParameters: { USERNAME: s.username, PASSWORD: s.password! },
    })
  );
  const token = out.AuthenticationResult?.AccessToken;
  if (!token) throw new Error('Cognito auth returned no access token');
  return token;
}

/**
 * Read the app's SSM-backed Config exposed by `sst bind`. Absent (plain `tsx`,
 * unit tests) → {}, so environment variables alone can still drive the CLI.
 */
async function loadBoundConfig(): Promise<Record<string, string | undefined>> {
  const out: Record<string, string | undefined> = {};
  // The API URL comes from the Api resource binding (sst/node/api), not a
  // Config.Parameter — SST already publishes it, so we don't duplicate it.
  try {
    const { Api } = await import('sst/node/api');
    out.REGISTRY_API_URL = (Api as unknown as Record<string, { url?: string }>).Api?.url;
  } catch {
    // Not run under `sst bind` — the environment may supply REGISTRY_API_URL.
  }
  // The client id + writer password come from Config (Parameter + Secret).
  try {
    const { Config } = await import('sst/node/config');
    const c = Config as unknown as Record<string, string | undefined>;
    for (const k of ['USER_POOL_CLIENT_ID', 'REGISTRY_DEMO_PASSWORD']) {
      try {
        out[k] = c[k];
      } catch {
        // Not defined / not bound — leave unset; the environment may supply it.
      }
    }
  } catch {
    // `sst/node/config` unavailable (not run under `sst bind`).
  }
  return out;
}

/** Merge `sst bind` Config with overriding environment variables into one bag. */
export function mergeSettingSources(
  bound: Record<string, string | undefined>,
  env: Record<string, string | undefined>
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const k of SETTING_KEYS) out[k] = env[k] ?? bound[k];
  return out;
}

/** CLI entry. */
export async function main(argv = process.argv.slice(2)): Promise<void> {
  const values = mergeSettingSources(await loadBoundConfig(), process.env);
  const settings = resolveSettings(values);
  const apiUrl = settings.apiUrl;
  const token = await resolveToken(settings);

  const skipFunctional = argv.includes('--skip-functional') || process.env.SKIP_FUNCTIONAL === '1';
  const mode = argv.includes('--local') ? 'local' : argv.includes('--pull') ? 'pull' : 'default';

  // Compat + conformance tests (always).
  let artifacts: ArtifactSet;
  if (mode === 'local') {
    console.log('[generate-tests] --local: generating from the read API…');
    artifacts = await generateLocally(fetch, apiUrl, token);
  } else {
    if (mode === 'default') {
      const summary = await triggerGeneration(fetch, apiUrl, token);
      console.log(`[generate-tests] generated run ${summary.runId}:`, JSON.stringify(summary.counts));
    }
    artifacts = await fetchLatestArtifacts(fetch, apiUrl, token);
  }

  const written = writeArtifactTree(OUTPUT_DIR, artifacts);
  console.log(`[generate-tests] wrote ${written.length} file(s) to generated-tests/:`);
  for (const p of written) console.log(`  generated-tests/${p}`);

  // Functional (LLM) tests — default on; skip with --skip-functional or SKIP_FUNCTIONAL=1.
  if (mode === 'local') {
    console.log('[generate-tests] skipping functional generation (not available in --local mode)');
  } else if (skipFunctional) {
    console.log('[generate-tests] skipping functional generation (--skip-functional)');
  } else {
    console.log('[generate-tests] triggering LLM functional generation…');
    const { jobId } = await triggerFunctionalGeneration(fetch, apiUrl, token);
    console.log(`[generate-tests] job ${jobId} accepted; polling…`);
    const { job, functionalArtifacts } = await pollFunctionalJob(fetch, apiUrl, token, jobId).then((r) => ({
      job: r.job,
      functionalArtifacts: r.artifacts,
    }));
    const functionalWritten = writeFunctionalArtifactTree(OUTPUT_DIR, functionalArtifacts);
    console.log(
      `[generate-tests] job ${jobId} succeeded (${job.planCount ?? 0} plan(s), ${job.skipCount ?? 0} skipped); wrote ${functionalWritten.length} file(s):`
    );
    for (const p of functionalWritten) console.log(`  generated-tests/${p}`);
    written.push(...functionalWritten);
  }

  console.log('[generate-tests] review `git diff` and commit — this tool does not commit for you.');
}

// Run when invoked directly (tsx scripts/generate-tests.ts), not when imported by tests.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((err) => {
    console.error('[generate-tests] failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
