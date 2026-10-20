/**
 * T-46a (pure half) — the review composition: reviewTestgen (§3.9) and
 * reviewFunctional (§3.11): gating (R-129), critic report-only (R-130),
 * deterministic manifest block (R-131), verdict (R-132), critic isolation and
 * independence (R-139, R-141), batched mutation (design §12.5).
 */
import { describe, it, expect } from 'vitest';
import { generateArtifacts, serializeManifest } from '@registry/testgen';
import { emitFunctionalTests, type FunctionalTestPlan, type GroundedContext } from '@registry/functest';
import {
  reviewTestgen,
  reviewFunctional,
  mutateTestgen,
  mutateTestgenBatched,
  manifestTierEvaluator,
  manifestTierEvaluatorWith,
  CRITIC_PROMPT_VERSION,
  type BatchEvaluator,
  type CriticCache,
  type CriticClient,
  type CriticPlanResult,
} from '../src/index.js';
import { loadFunctionalSeed, loadTestgenSeed } from './calibration.js';
import type { EntityFlows } from '@registry/core';

/** A manifest-tier batch evaluator whose generator under test runs with `flows` (seed 6, v0.8.0). */
const invertedBatch =
  (flows: EntityFlows): BatchEvaluator =>
  async (cases) =>
    cases.map((c) => manifestTierEvaluatorWith(flows)(c.catalog, c.entity) as 'green' | 'red' | 'absent');

// ---- §3.9 ------------------------------------------------------------------

describe('reviewTestgen (§3.9)', () => {
  it('S06 with an inverted generator flow: the M1 generator finding is Critical, nothing is withheld, the verdict fails', async () => {
    const s = loadTestgenSeed('testgen/S06-publisher-consumer');
    const artifacts = generateArtifacts(s.catalog, s.generatorFlows);
    const { block, report } = await reviewTestgen(artifacts, s.catalog, { roles: s.roles, runBatch: invertedBatch(s.generatorFlows!) });
    expect(block.findings.some((f) => f.rule === 'R-135' && f.mutant === 'M1:sourcedId' && f.target.kind === 'generator')).toBe(true);
    expect(block.findings.every((f) => /^A-\d{2}$/.test(f.id))).toBe(true);
    expect(report.generator).toBe('testgen');
    expect(report.withheld).toEqual([]);
    expect(report.verdict).toBe('FAIL — review findings');
    expect(report.mutation.tier).toBe('manifest');
    expect(report.critic.status).toBe('skipped');
  });

  it('also lints emitted conformance tests: a file with no non-empty check is R-134h, the generator output no longer is', async () => {
    const s = loadTestgenSeed('testgen/S06-publisher-consumer');
    const artifacts = generateArtifacts(s.catalog);
    // The generator now fails a conformance test that sees zero records, so nothing it emits trips R-134h.
    const clean = await reviewTestgen(artifacts, s.catalog, { roles: s.roles });
    expect(clean.block.findings.filter((f) => f.rule === 'R-134h')).toEqual([]);
    // The lint still fires on a file that lacks the check (the pre-fix emitter's output).
    const stripped = {
      ...artifacts,
      files: artifacts.files.map((f) =>
        f.path.startsWith('conformance/') ? { ...f, contents: f.contents.replace(/^\s*expect\(records\.length[^\n]*\n/m, '') } : f
      ),
    };
    const { block } = await reviewTestgen(stripped, s.catalog, { roles: s.roles });
    expect(block.findings).toContainEqual(
      expect.objectContaining({ rule: 'R-134h', target: expect.objectContaining({ ref: 'publisher/org' }) })
    );
  });

  it('on live data (no roles option) the oracle takes roles from ENTITY_FLOWS / literal labels; no OQ-16 note (v0.8.0)', async () => {
    const s = loadTestgenSeed('testgen/S06-publisher-consumer');
    const { block, report } = await reviewTestgen(generateArtifacts(s.catalog), s.catalog);
    expect(block.findings.filter((f) => f.rule === 'R-135')).toEqual([]);
    expect(report.mutation.testgen).toEqual([expect.objectContaining({ entity: 'org', applicable: true, total: 11, killed: 11 })]);
    expect(report.notes.join(' ')).not.toMatch(/OQ-16|manifest’s own/);
  });

  it('on live data a generator that disagrees with the declared roles IS caught (role inversion no longer grades itself)', async () => {
    const s = loadTestgenSeed('testgen/S06-publisher-consumer');
    const { block } = await reviewTestgen(generateArtifacts(s.catalog, s.generatorFlows), s.catalog, { runBatch: invertedBatch(s.generatorFlows!) });
    expect(block.findings.some((f) => f.rule === 'R-135' && f.mutant === 'M1:sourcedId' && f.severity === 'Critical')).toBe(true);
  });

  it('is deterministic: the stamped manifest serialises byte-identically across runs (R-131, R-88)', async () => {
    const s = loadTestgenSeed('testgen/S06-publisher-consumer');
    const stamp = async () => {
      const artifacts = generateArtifacts(s.catalog);
      artifacts.manifest.adversarial = (await reviewTestgen(artifacts, s.catalog, { roles: s.roles })).block;
      return serializeManifest(artifacts.manifest);
    };
    expect(await stamp()).toBe(await stamp());
  });

  it('mutateTestgenBatched gives the same result as the per-case evaluator, in one batch call', async () => {
    const s = loadTestgenSeed('testgen/S06-publisher-consumer');
    const calls: number[] = [];
    const batch = async (cases: { catalog: typeof s.catalog; entity: string }[]) => {
      calls.push(cases.length);
      return cases.map((c) => manifestTierEvaluator(c.catalog, c.entity) as 'green' | 'red' | 'absent');
    };
    const batched = await mutateTestgenBatched(s.catalog, s.roles, batch);
    const single = await mutateTestgen(s.catalog, s.roles);
    expect(batched).toEqual(single);
    expect(calls).toEqual([1, 11]); // baseline batch, then all 11 mutants at once
  });
});

// ---- §3.11 -----------------------------------------------------------------

function seedInputs(paths: string[]) {
  const seeds = paths.map((p) => loadFunctionalSeed(p));
  const plans: FunctionalTestPlan[] = seeds.map((s) => s.plan);
  const contexts = new Map<string, GroundedContext>(seeds.map((s) => [s.plan.inputHash, s.context]));
  return { plans, contexts, files: emitFunctionalTests(plans) };
}

function stubCritic(over: Partial<CriticClient> = {}, critical = true): CriticClient & { calls: number } {
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
        findings: critical
          ? [
              {
                severity: 'Critical',
                defect: 'The test asserts the wrong pairing.',
                failureScenario: 'A correct system fails it.',
                evidence: 'assertion #1',
              },
            ]
          : [],
      };
    },
    ...over,
  };
  return c;
}

const memCache = (): CriticCache => {
  const m = new Map<string, CriticPlanResult>();
  return { get: async (k) => m.get(k), set: async (k, v) => void m.set(k, v) };
};

describe('reviewFunctional (§3.11)', () => {
  it('withholds a plan with a deterministic Critical (S04) and keeps the clean one (R-129)', async () => {
    const { plans, contexts, files } = seedInputs(['functional/clean', 'functional/S04-absent-fieldpath']);
    const r = await reviewFunctional(plans, contexts, files);
    // v0.8.0 (R-117d): canonical `{source}/{id}`.
    expect(r.kept.map((p) => p.requirementIds[0])).toEqual(['publisher/R-10']);
    expect(r.withheld).toHaveLength(1);
    expect(r.withheld[0].requirement).toBe('create/CRE-R-24');
    expect(r.withheld[0].reason).toMatch(/^adversarial: A-\d{2}(, A-\d{2})*$/);
    // every id the reason names is a Critical deterministic finding on that plan
    const ids = r.withheld[0].reason.replace('adversarial: ', '').split(', ');
    for (const id of ids) expect(r.block.findings.find((f) => f.id === id)?.severity).toBe('Critical');
    expect(r.report.verdict).toBe('FAIL — withheld');
    expect(r.report.withheld).toEqual([{ requirement: 'create/CRE-R-24', findings: ids }]);
  });

  it('a critic Critical never withholds and never changes the deterministic block (R-130)', async () => {
    const { plans, contexts, files } = seedInputs(['functional/clean']);
    const without = await reviewFunctional(plans, contexts, files);
    const withCritic = await reviewFunctional(plans, contexts, files, {
      critic: stubCritic(),
      criticCache: memCache(),
      synthModelId: 'us.anthropic.claude-sonnet-4-6',
    });
    expect(withCritic.kept).toEqual(without.kept);
    expect(JSON.stringify(withCritic.block)).toBe(JSON.stringify(without.block));
    expect(withCritic.report.critic.status).toBe('ok');
    expect(withCritic.report.critic.findings).toEqual([expect.objectContaining({ id: 'C-01', attack: 'critic', severity: 'Critical' })]);
    expect(withCritic.report.verdict).toBe('FAIL — review findings');
  });

  it('the critic also reviews withheld plans (report only)', async () => {
    const { plans, contexts, files } = seedInputs(['functional/clean', 'functional/S04-absent-fieldpath']);
    const critic = stubCritic({}, false);
    await reviewFunctional(plans, contexts, files, { critic, criticCache: memCache() });
    expect(critic.calls).toBe(2);
  });

  it('critic AccessDenied → unavailable, not retried for the remaining plans; deterministic output unchanged (R-141)', async () => {
    const { plans, contexts, files } = seedInputs(['functional/clean', 'functional/S04-absent-fieldpath']);
    const denied = Object.assign(new Error('You don’t have access to the model'), { name: 'AccessDeniedException' });
    const critic = stubCritic({
      blind: async () => {
        critic.calls++;
        throw denied;
      },
    });
    const r = await reviewFunctional(plans, contexts, files, { critic, criticCache: memCache() });
    const baseline = await reviewFunctional(plans, contexts, files);
    expect(r.report.critic.status).toBe('unavailable');
    expect(critic.calls).toBe(1);
    expect(r.kept).toEqual(baseline.kept);
    expect(JSON.stringify(r.block)).toBe(JSON.stringify(baseline.block));
  });

  it('records independence: degraded when the critic and synthesiser models match (R-139)', async () => {
    const { plans, contexts, files } = seedInputs(['functional/clean']);
    const r = await reviewFunctional(plans, contexts, files, {
      critic: stubCritic({ modelId: 'same' }, false),
      criticCache: memCache(),
      synthModelId: 'same',
    });
    expect(r.report.critic.independence).toBe('degraded');
  });

  it('no critic configured → critic status skipped; mutation scores recorded per plan', async () => {
    const { plans, contexts, files } = seedInputs(['functional/clean']);
    const r = await reviewFunctional(plans, contexts, files);
    expect(r.report.critic.status).toBe('skipped');
    expect(r.report.mutation.functional).toEqual([{ ref: 'publisher/R-10', score: 1, survivors: [] }]);
  });
});
