/**
 * T-46a (worker half) — the adversarial stage inside the functional job:
 * gate → withhold → re-emit kept → critic (report-only) → persist (R-127,
 * R-129…R-132, R-141, R-142, R-143, E-58). Offline: stub LLM + stub critic +
 * in-memory repo; the Bedrock clients are never loaded.
 */
import { describe, it, expect } from 'vitest';
import { serializeFunctionalManifest, type LlmClient, type PlanBody, type GroundedContext } from '@registry/functest';
import { CRITIC_PROMPT_VERSION, type CriticClient } from '@registry/adversary';
import { runFunctionalJob, type FunctionalGenRepo } from '../src/functional-gen.js';
import type { CatalogEntry, RequirementRecord, FunctionalJobRecord } from '../src/repository.js';

const ORG_YAML = [
  'version: 1.0.0',
  'apiVersion: v3.1.0',
  'kind: DataContract',
  'id: org-contract',
  'name: org',
  'schema:',
  '  - name: org',
  '    properties:',
  '      - name: sourcedId',
  '        required: true',
  '        logicalType: string',
  '      - name: name',
  '        required: true',
  '        logicalType: string',
].join('\n');

const entry = (source: string): CatalogEntry => ({
  source,
  id: 'org-contract',
  entity: 'org',
  currentVersion: 1,
  currentHash: `${source}-hash`,
  validation: 'valid',
  commitSha: 'sha',
  filePath: 'contracts/org.yaml',
  lastCrawledAt: '2026-10-07T00:00:00Z',
});

const req = (id: string, text: string): RequirementRecord => ({
  source: 'publisher',
  id,
  text,
  section: '3.1',
  earsType: 'event',
  modality: 'SHALL',
  earsConforming: true,
  changedInLastCrawl: false,
  specHash: 'h',
  lastCrawledAt: '2026-10-07T00:00:00Z',
});

const R10 = 'WHEN an org is created, the consumer SHALL reflect its name.';
const R11 = 'WHEN an org is renamed, the consumer SHALL reflect the new name.';

/** R-10: a sound plan. R-11: never looks at the consumer → R-134d Critical → withheld. */
function body(ctx: GroundedContext): PlanBody {
  const sound = ctx.requirement.id === 'R-10';
  const clause = sound ? 'the consumer SHALL reflect its name' : 'the consumer SHALL reflect the new name';
  return {
    requirementIds: [ctx.requirement.id],
    title: `${ctx.requirement.id} propagates`,
    setup: [],
    trigger: { source: 'publisher', entity: 'org', method: 'POST', path: '/orgs', payload: { sourcedId: 'o-1', name: 'New High' } },
    propagation: {
      kind: 'cdc',
      waitFor: 'consumer reflects the org',
      timeoutSeconds: 30,
      pollIntervalSeconds: 2,
      readBack: { service: sound ? 'consumer' : 'publisher', path: '/orgs', matchOn: 'sourcedId' },
    },
    assertions: [
      {
        service: sound ? 'consumer' : 'publisher',
        fieldPath: 'name',
        operator: 'equals',
        expected: { from: 'trigger.payload', path: 'name' },
        clause,
      },
    ],
  };
}

function stubLlm(): LlmClient & { calls: number } {
  const l = {
    calls: 0,
    async synthesizePlan(ctx: GroundedContext) {
      l.calls++;
      return body(ctx);
    },
  };
  return l;
}

function stubCritic(over: Partial<CriticClient> = {}): CriticClient & { calls: number } {
  const c = {
    modelId: 'us.anthropic.claude-opus-4-8',
    promptVersion: CRITIC_PROMPT_VERSION,
    calls: 0,
    async blind() {
      c.calls++;
      return { behaviours: [] };
    },
    async reconcile() {
      return {
        findings: [
          {
            severity: 'Critical',
            defect: 'The name check reads the wrong record.',
            failureScenario: 'A correct consumer fails it.',
            evidence: 'assertion #1',
          },
        ],
      };
    },
    ...over,
  };
  return c;
}

/** In-memory repo that persists plan + critic caches across runs (E-58). */
function fakeRepo(shared = { plans: new Map<string, unknown>(), critic: new Map<string, unknown>() }) {
  const jobs: FunctionalJobRecord[] = [];
  const artifacts: Record<string, any> = {};
  const repo: FunctionalGenRepo & { jobs: typeof jobs; artifacts: typeof artifacts } = {
    jobs,
    artifacts,
    listEntries: async () => [entry('publisher'), entry('consumer')],
    getRaw: async () => ORG_YAML,
    listRequirements: async () => [req('R-10', R10), req('R-11', R11)],
    writeFunctionalJob: async (j) => void jobs.push(j),
    putFunctionalArtifacts: async (id, a) => {
      artifacts[id] = a;
      return `functional-tests/${id}/artifacts.json`;
    },
    getCachedPlan: async (h) => shared.plans.get(h),
    putCachedPlan: async (h, p) => void shared.plans.set(h, p),
    getCachedCritic: async (k) => shared.critic.get(k) as never,
    putCachedCritic: async (k, v) => void shared.critic.set(k, v),
  };
  return { repo, shared };
}

const clock = { now: () => '2026-10-07T12:00:00Z' };
const last = (jobs: FunctionalJobRecord[]) => jobs[jobs.length - 1];

describe('runFunctionalJob — adversarial stage (T-46a)', () => {
  it('withholds the plan with a deterministic Critical, emits only the kept one, records the skip (R-129, E-49)', async () => {
    const { repo } = fakeRepo();
    const job = await runFunctionalJob('fj-1', repo, stubLlm(), clock);
    expect(job.status).toBe('succeeded');
    const a = repo.artifacts['fj-1'];
    // v0.8.0 (R-117d): plans carry the canonical `{source}/{id}`, the same form as skips.
    expect(a.manifest.plans.map((p: any) => p.requirementIds[0])).toEqual(['publisher/R-10']);
    expect(a.files).toHaveLength(1);
    expect(a.files[0].path).toMatch(/r-10-org/);
    const skip = a.manifest.skipped.find((s: any) => s.requirement === 'publisher/R-11');
    expect(skip?.reason).toMatch(/^adversarial: A-\d{2}/);
    expect(a.manifest.adversarial.findings.some((f: any) => f.rule === 'R-134d' && f.severity === 'Critical')).toBe(true);
    expect(job.planCount).toBe(1);
  });

  it('the job record carries {verdict, counts}; the artifact object carries the full report (R-131, R-143)', async () => {
    const { repo } = fakeRepo();
    await runFunctionalJob('fj-2', repo, stubLlm(), clock);
    const job = last(repo.jobs);
    expect(job.adversarial).toEqual({ verdict: 'FAIL — withheld', counts: expect.objectContaining({ vacuity: expect.any(Object) }) });
    expect(repo.artifacts['fj-2'].report).toMatchObject({
      generator: 'functest',
      verdict: 'FAIL — withheld',
      critic: { status: 'skipped' },
    });
  });

  it('a critic Critical changes neither the manifest nor the files (R-130)', async () => {
    const plain = fakeRepo();
    const critiqued = fakeRepo();
    await runFunctionalJob('fj-p', plain.repo, stubLlm(), clock);
    await runFunctionalJob('fj-c', critiqued.repo, stubLlm(), clock, stubCritic());
    const p = plain.repo.artifacts['fj-p'];
    const c = critiqued.repo.artifacts['fj-c'];
    expect(serializeFunctionalManifest(c.manifest)).toBe(serializeFunctionalManifest(p.manifest));
    expect(c.files).toEqual(p.files);
    expect(c.report.critic.findings.length).toBeGreaterThan(0);
    expect(c.report.critic.findings[0].id).toBe('C-01');
  });

  it('critic AccessDenied → job still succeeded, report says unavailable (R-141, E-56)', async () => {
    const denied = Object.assign(new Error('You don’t have access to the model'), { name: 'AccessDeniedException' });
    const { repo } = fakeRepo();
    const job = await runFunctionalJob(
      'fj-d',
      repo,
      stubLlm(),
      clock,
      stubCritic({
        blind: async () => {
          throw denied;
        },
      })
    );
    expect(job.status).toBe('succeeded');
    expect(repo.artifacts['fj-d'].report.critic.status).toBe('unavailable');
  });

  it('an unchanged re-run: byte-identical manifest, withheld plan stays withheld, no LLM or critic call (E-58, D-82)', async () => {
    const first = fakeRepo();
    await runFunctionalJob('fj-1', first.repo, stubLlm(), clock, stubCritic());
    const second = fakeRepo(first.shared);
    const llm = stubLlm();
    const critic = stubCritic();
    await runFunctionalJob('fj-2', second.repo, llm, clock, critic);
    expect(llm.calls).toBe(0);
    expect(critic.calls).toBe(0);
    expect(serializeFunctionalManifest(second.repo.artifacts['fj-2'].manifest)).toBe(
      serializeFunctionalManifest(first.repo.artifacts['fj-1'].manifest)
    );
    expect(second.repo.artifacts['fj-2'].manifest.skipped.some((s: any) => s.requirement === 'publisher/R-11')).toBe(true);
  });
});
