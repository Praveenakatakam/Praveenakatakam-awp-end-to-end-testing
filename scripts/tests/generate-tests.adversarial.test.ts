/**
 * T-47a — CLI delivery of the adversarial review (R-144, R-135 executed tier,
 * D-34). Output and report dirs are temp dirs; fetch is a URL-routing stub
 * serving the real S06 calibration catalog — the repo's generated-tests/ tree
 * is never touched.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateArtifacts, type CatalogContract } from '@registry/testgen';
import { emitFunctionalTests } from '@registry/functest';
import {
  reviewTestgen,
  reviewFunctional,
  mutateTestgen,
  mutateTestgenBatched,
  manifestTierEvaluator,
  manifestTierEvaluatorWith,
  type BatchEvaluator,
} from '@registry/adversary';
import { runCli, writeAdversarialReport, reviewTestgenForCli } from '../generate-tests.js';
import { createExecutedBatchEvaluator } from '../adversary-exec.js';
import { loadFunctionalSeed, loadTestgenSeed } from '../../packages/adversary/tests/calibration.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const manifestBatch: BatchEvaluator = async (cases) =>
  cases.map((c) => manifestTierEvaluator(c.catalog, c.entity) as 'green' | 'red' | 'absent');

/** Route fetch by "METHOD path" (path without the API base); unknown routes throw. */
function routedFetch(routes: Record<string, { status?: number; json?: unknown; text?: string }>): typeof fetch {
  return (async (url: string | URL, init?: RequestInit) => {
    const path = String(url).replace('https://api.test', '');
    const key = `${init?.method ?? 'GET'} ${path}`;
    const r = routes[key];
    if (!r) throw new Error(`unexpected request ${key}`);
    const body = r.text ?? JSON.stringify(r.json ?? {});
    return new Response(body, { status: r.status ?? 200 });
  }) as typeof fetch;
}

/** The read-API view of a catalog: /contracts + each /raw. */
function catalogRoutes(catalog: CatalogContract[]) {
  const routes: Record<string, { status?: number; json?: unknown; text?: string }> = {
    'GET /contracts': {
      json: {
        items: catalog.map((c) => ({
          source: c.source,
          entity: c.entity,
          id: c.id,
          declaredVersion: c.declaredVersion,
          currentHash: c.contentHash,
          validation: c.validation,
        })),
      },
    },
  };
  for (const c of catalog) routes[`GET /contracts/${c.source}/${c.id}/raw`] = { text: c.rawYaml };
  return routes;
}

const ENV = { REGISTRY_API_URL: 'https://api.test', REGISTRY_TOKEN: 'tok' };

let out: string;
let reports: string;
beforeEach(() => {
  out = mkdtempSync(join(tmpdir(), 'adv-out-'));
  reports = mkdtempSync(join(tmpdir(), 'adv-reports-'));
});
afterEach(() => {
  rmSync(out, { recursive: true, force: true });
  rmSync(reports, { recursive: true, force: true });
});

// ---- report files ----------------------------------------------------------

describe('writeAdversarialReport (R-144)', () => {
  it('writes report.md + report.json under {id}/ and returns their paths', async () => {
    const s = loadTestgenSeed('testgen/S06-publisher-consumer');
    // v0.8.0: seed 6's M1 finding comes from a generator fed the inverted flow.
    const inverted: BatchEvaluator = async (cases) =>
      cases.map((c) => manifestTierEvaluatorWith(s.generatorFlows!)(c.catalog, c.entity) as 'green' | 'red' | 'absent');
    const { report } = await reviewTestgen(generateArtifacts(s.catalog, s.generatorFlows), s.catalog, { roles: s.roles, runBatch: inverted });
    const paths = writeAdversarialReport(reports, 'run-1', 'Adversarial review — §3.9 run run-1', report);
    expect(paths).toEqual(['run-1/report.json', 'run-1/report.md']);
    expect(JSON.parse(readFileSync(join(reports, 'run-1', 'report.json'), 'utf8'))).toEqual(report);
    const md = readFileSync(join(reports, 'run-1', 'report.md'), 'utf8');
    expect(md.startsWith('# Adversarial review — §3.9 run run-1')).toBe(true);
    expect(md).toContain(`**Verdict: ${report.verdict}**`);
    expect(md).toContain('M1:sourcedId');
  });
});

// ---- tier agreement --------------------------------------------------------

describe('reviewTestgenForCli (R-135 executed tier)', () => {
  it('fails loudly when the executed tier disagrees with the manifest tier', async () => {
    const s = loadTestgenSeed('testgen/S06-publisher-consumer');
    const artifacts = generateArtifacts(s.catalog);
    const allGreen: BatchEvaluator = async (cases) => cases.map(() => 'green');
    await expect(reviewTestgenForCli(artifacts, s.catalog, allGreen)).rejects.toThrow(/tiers disagree/);
  });

  it('returns the executed-tier report when the tiers agree', async () => {
    const s = loadTestgenSeed('testgen/S06-publisher-consumer');
    const { report } = await reviewTestgenForCli(generateArtifacts(s.catalog), s.catalog, manifestBatch);
    expect(report.mutation.tier).toBe('executed');
  });
});

describe('createExecutedBatchEvaluator — real Vitest run of emitted compat files', () => {
  it('agrees with the manifest tier on S06, for an inverted generator flow AND the shipped generator', async () => {
    const s = loadTestgenSeed('testgen/S06-publisher-consumer');
    const workDir = join(REPO_ROOT, '.adversarial-tmp', `t47a-${process.pid}`);

    // Generator fed the inverted flow (seed 6, v0.8.0): M1 survives in both tiers.
    const execInverted = createExecutedBatchEvaluator({ workDir, flows: s.generatorFlows });
    const executed = await mutateTestgenBatched(s.catalog, s.roles, execInverted, 'executed');
    const manifest = await mutateTestgen(s.catalog, s.roles, manifestTierEvaluatorWith(s.generatorFlows!));
    expect(executed.findings.map((f) => f.mutant)).toEqual(manifest.findings.map((f) => f.mutant));
    expect(executed.findings.map((f) => f.mutant)).toContain('M1:sourcedId');

    // Shipped generator (declared roles, R-84b): every mutant killed in both tiers.
    const execOk = await mutateTestgenBatched(s.catalog, s.roles, createExecutedBatchEvaluator({ workDir }), 'executed');
    expect(execOk.findings).toEqual([]);
    expect(execOk.entities[0].killed).toBe(execOk.entities[0].total);

    expect(existsSync(workDir)).toBe(false); // cleaned up
  }, 180_000);

  it('applies a field map in the executed tier: a mapped pair is green, and M1 on the mapped field is killed', async () => {
    const workDir = join(REPO_ROOT, '.adversarial-tmp', `t47a-map-${process.pid}`);
    const doc = (source: string, props: object[]) =>
      JSON.stringify({ version: '1.0.0', apiVersion: 'v3.1.0', kind: 'DataContract', id: `${source}-Task`, name: 'Task', schema: [{ name: 'Task', properties: props }] });
    const contract = (source: string, props: object[]): CatalogContract => ({
      source, entity: 'Task', id: `${source}-Task`, declaredVersion: '1.0.0', contentHash: `${source}-h`, validation: 'valid', rawYaml: doc(source, props),
    });
    const catalog = [
      contract('create', [{ name: 'taskId', logicalType: 'string', required: true }]),
      contract('get-ready', [{ name: 'id', logicalType: 'string', required: true }]),
    ];
    const flow = { publisher: 'create', consumer: 'get-ready', fields: { taskId: 'id' } };
    const exec = createExecutedBatchEvaluator({ workDir, flows: { Task: flow } });
    const r = await mutateTestgenBatched(catalog, { Task: flow }, exec, 'executed');
    expect(r.findings).toEqual([]);
    expect(r.entities).toEqual([expect.objectContaining({ entity: 'Task', applicable: true, survivors: [] })]);
  }, 180_000);
});

// ---- end-to-end CLI flow ---------------------------------------------------

describe('runCli (R-144, D-34)', () => {
  it('--local: writes the tree with the adversarial block, the report, and prints the verdict BEFORE the git-diff reminder', async () => {
    const s = loadTestgenSeed('testgen/S06-publisher-consumer');
    const lines: string[] = [];
    await runCli(['--local'], {
      fetchImpl: routedFetch(catalogRoutes(s.catalog)),
      env: ENV,
      outputDir: out,
      reportsDir: reports,
      log: (l) => lines.push(l),
      runBatch: manifestBatch,
    });
    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
    // The adversarial block is stamped even when clean: the generator no longer emits a conformance test
    // that passes on zero records (R-134h), so the S06 catalog yields no findings.
    expect(manifest.adversarial).toEqual({ findings: [] });
    const [dir] = readdirSync(reports);
    expect(dir).toMatch(/^local-/);
    expect(existsSync(join(reports, dir, 'report.md'))).toBe(true);

    const verdictAt = lines.findIndex((l) => /adversarial \(§3\.9\): (FAIL|PASS)/.test(l));
    const reportAt = lines.findIndex((l) => l.includes(`adversarial-reports/${dir}/report.md`));
    const diffAt = lines.findIndex((l) => l.includes('review `git diff`'));
    expect(verdictAt).toBeGreaterThanOrEqual(0);
    expect(reportAt).toBeGreaterThanOrEqual(0);
    expect(diffAt).toBeGreaterThan(Math.max(verdictAt, reportAt));
  });

  it('default mode: one report per §3.9 run and per functional job, both verdicts before the reminder', async () => {
    const s = loadTestgenSeed('testgen/S06-publisher-consumer');
    const server = generateArtifacts(s.catalog);
    const serverReview = await reviewTestgen(server, s.catalog);
    server.manifest.adversarial = serverReview.block;

    const clean = loadFunctionalSeed('functional/clean');
    const fr = await reviewFunctional([clean.plan], new Map([[clean.plan.inputHash, clean.context]]), emitFunctionalTests([clean.plan]));
    const functionalArtifacts = {
      manifest: {
        manifestVersion: 1,
        generator: '@registry/functest',
        modelId: 'm',
        promptVersion: 'v2',
        plans: fr.kept,
        skipped: [],
        adversarial: fr.block,
      },
      files: emitFunctionalTests(fr.kept),
      report: fr.report,
    };

    const lines: string[] = [];
    await runCli([], {
      fetchImpl: routedFetch({
        ...catalogRoutes(s.catalog),
        'POST /generate-tests': { json: { runId: 'run-9', counts: {} } },
        'GET /test-artifacts/latest': { json: { run: { runId: 'run-9' }, artifacts: { ...server, report: serverReview.report } } },
        'POST /generate-functional-tests': { status: 202, json: { jobId: 'fj-9', status: 'pending' } },
        'GET /functional-test-jobs/fj-9': {
          json: { job: { status: 'succeeded', planCount: 1, skipCount: 0 }, artifacts: functionalArtifacts },
        },
      }),
      env: ENV,
      outputDir: out,
      reportsDir: reports,
      log: (l) => lines.push(l),
      runBatch: manifestBatch,
      poll: { sleep: async () => undefined, onProgress: () => undefined },
    });

    for (const id of ['run-9', 'fj-9']) {
      expect(existsSync(join(reports, id, 'report.md')), id).toBe(true);
      expect(existsSync(join(reports, id, 'report.json')), id).toBe(true);
    }
    const diffAt = lines.findIndex((l) => l.includes('review `git diff`'));
    const v39 = lines.findIndex((l) => /adversarial \(§3\.9\):/.test(l));
    const v311 = lines.findIndex((l) => /adversarial \(§3\.11\):/.test(l));
    expect(v39).toBeGreaterThanOrEqual(0);
    expect(v311).toBeGreaterThanOrEqual(0);
    expect(diffAt).toBeGreaterThan(Math.max(v39, v311));

    // The output ENDS with the handoff block the main conversation acts on (repo CLAUDE.md).
    expect(handoffBlock(lines)).toEqual([
      '## ADVERSARIAL REVIEW HANDOFF',
      `generated_dir: ${posix(out)}`,
      `in_product_reports: ${posix(join(reports, 'run-9', 'report.json'))}, ${posix(join(reports, 'fj-9', 'report.json'))}`,
      'run: run-9',
      'functional_job: fj-9',
    ]);
  });

  it('--local: the handoff block names the local run and no functional job', async () => {
    const s = loadTestgenSeed('testgen/S06-publisher-consumer');
    const lines: string[] = [];
    await runCli(['--local'], {
      fetchImpl: routedFetch(catalogRoutes(s.catalog)),
      env: ENV,
      outputDir: out,
      reportsDir: reports,
      log: (l) => lines.push(l),
      runBatch: manifestBatch,
    });
    const [dir] = readdirSync(reports);
    expect(handoffBlock(lines)).toEqual([
      '## ADVERSARIAL REVIEW HANDOFF',
      `generated_dir: ${posix(out)}`,
      `in_product_reports: ${posix(join(reports, dir, 'report.json'))}`,
      `run: ${dir}`,
      'functional_job: none',
    ]);
  });

  it('paths inside the repo are printed repo-relative (what the skill expects by default)', async () => {
    const { displayPath } = await import('../generate-tests.js');
    expect(displayPath(join(REPO_ROOT, 'generated-tests'))).toBe('generated-tests');
    expect(displayPath(join(REPO_ROOT, 'adversarial-reports', 'run-1', 'report.json'))).toBe('adversarial-reports/run-1/report.json');
  });
});

/** The lines from the handoff header to the end of the output; [] when there is no block. */
function handoffBlock(lines: string[]): string[] {
  const at = lines.indexOf('## ADVERSARIAL REVIEW HANDOFF');
  return at < 0 ? [] : lines.slice(at);
}

const posix = (p: string) => p.replace(/\\/g, '/');

// ---- hygiene ---------------------------------------------------------------

describe('repo hygiene (R-144, D-34)', () => {
  it('adversarial-reports/ and .adversarial-tmp/ are git-ignored', () => {
    const gitignore = readFileSync(join(REPO_ROOT, '.gitignore'), 'utf8').split(/\r?\n/);
    expect(gitignore).toContain('adversarial-reports/');
    expect(gitignore).toContain('.adversarial-tmp/');
  });

  it('neither the CLI nor the executed-tier harness ever invokes git', () => {
    for (const f of ['scripts/generate-tests.ts', 'scripts/adversary-exec.ts']) {
      const src = readFileSync(join(REPO_ROOT, f), 'utf8');
      expect(src, f).not.toMatch(/['"`]git['"`]|\bgit\s+(commit|push|add|stage)\b/);
    }
  });
});
