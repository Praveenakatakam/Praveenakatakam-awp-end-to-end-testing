/**
 * F-01 of the adversarial-code-review run 20261014-1531: a cached critic result is trusted only if its
 * CONTENTS are valid, so a junk or foreign cache object is a miss and never takes a review down (R-141, R-142).
 */
import { describe, it, expect } from 'vitest';
import { emitFunctionalTests, ground, stampPlan, type ContractInput, type PlanBody, type RequirementInput } from '@registry/functest';
import type { EntityApiTarget } from '@registry/core';
import { CRITIC_RESULT_VERSION, criticCacheKey, reviewFunctional, runCritic, type CriticCache, type CriticPlanResult, type FunctionalUnderReview } from '../src/index.js';

const PROPS = ['      - name: sourcedId', '        required: true', '        logicalType: string', '      - name: title', '        required: true', '        logicalType: string'];
const yamlOf = (entity: string) => ['version: 1.0.0', 'apiVersion: v3.1.0', 'kind: DataContract', `id: ${entity}-contract`, `name: ${entity}`, 'schema:', `  - name: ${entity}`, '    properties:', ...PROPS].join('\n');
const contract = (source: string, hash: string): ContractInput => ({ source, entity: 'org', id: 'org-contract', contentHash: hash, rawYaml: yamlOf('org') });
const target = (prefix: string): EntityApiTarget => ({ path: '/orgs', baseUrlEnv: `${prefix}_API_URL`, tokenEnv: `${prefix}_TOKEN`, recordsAt: 'items' });
const API_MAP = { publisher: { org: target('PUBLISHER') }, consumer: { org: target('CONSUMER') } };
const req: RequirementInput = { source: 'publisher', id: 'R-10', text: 'WHEN an org is created it SHALL be published', earsType: 'ubiquitous', section: '3.1' };

const body: PlanBody = {
  requirementIds: ['R-10'],
  title: 'org reaches the consumer',
  setup: [],
  trigger: { source: 'publisher', entity: 'org', method: 'POST', path: '/orgs', payload: { sourcedId: 'o1', title: 'T' } },
  propagation: { kind: 'cdc', waitFor: 'consumer reflects', timeoutSeconds: 30, pollIntervalSeconds: 2, readBack: { service: 'consumer', path: '/orgs', matchOn: 'sourcedId' } },
  assertions: [{ service: 'consumer', fieldPath: 'title', operator: 'exists', clause: 'it SHALL be published' }],
};

function underReview(): FunctionalUnderReview {
  const g = ground(req, [contract('publisher', 'a'), contract('consumer', 'b')], API_MAP, 'm', 'v1');
  if (!g.ok) throw new Error('fixture must ground');
  const plan = stampPlan(body, g.context);
  return { plan, context: g.context, file: emitFunctionalTests([plan])[0] };
}
const u = underReview();

const goodFinding = { attack: 'critic', severity: 'Minor', target: { kind: 'functional', ref: 'publisher/R-10' }, defect: 'A defect.', failureScenario: 'A scenario.' };
const goodResult = { status: 'ok', findings: [goodFinding], droppedByPostureLint: 0, malformed: 0 };

function client() {
  const c = {
    modelId: 'critic-model',
    promptVersion: 'p1',
    calls: 0,
    async blind() {
      c.calls++;
      return { behaviours: [] };
    },
    async reconcile() {
      return { findings: [{ severity: 'Minor', defect: 'A real defect.', failureScenario: 'A scenario.', evidence: 'x' }] };
    },
  };
  return c;
}
const cacheReturning = (value: unknown): CriticCache => ({ get: async () => value as CriticPlanResult, set: async () => {} });

describe('a junk critic cache object is a miss, never a crash', () => {
  it.each([
    ['a non-object finding', { ...goodResult, findings: [1] }],
    ['an empty finding', { ...goodResult, findings: [{}] }],
    ['an unknown severity', { ...goodResult, findings: [{ ...goodFinding, severity: 'Blocker' }] }],
    ['an unknown attack', { ...goodResult, findings: [{ ...goodFinding, attack: 'telepathy' }] }],
    ['a finding with no target', { ...goodResult, findings: [{ ...goodFinding, target: undefined }] }],
    ['a finding with a target that has no ref', { ...goodResult, findings: [{ ...goodFinding, target: { kind: 'functional' } }] }],
    ['a finding with an empty defect', { ...goodResult, findings: [{ ...goodFinding, defect: '' }] }],
    ['a missing malformed counter', { status: 'ok', findings: [], droppedByPostureLint: 0 }],
    ['a non-numeric counter', { ...goodResult, droppedByPostureLint: 'many' }],
    ['a negative counter', { ...goodResult, malformed: -1 }],
    ['a fractional counter', { ...goodResult, malformed: 0.5 }],
    ['an unknown status', { ...goodResult, status: 'great' }],
    ['null', null],
    ['an array', []],
    ['a string', 'ok'],
  ])('treats %s as a miss and asks the critic', async (_what, junk) => {
    const c = client();
    const r = await runCritic(u, [], c, cacheReturning(junk));
    expect(c.calls).toBe(1);
    expect(r.status).toBe('ok');
  });

  it('reuses a well-formed cached result without calling the critic', async () => {
    const c = client();
    const r = await runCritic(u, [], c, cacheReturning(goodResult));
    expect(c.calls).toBe(0);
    expect(r.findings).toHaveLength(1);
  });

  it('a failed result with a reason is also well-formed', async () => {
    const c = client();
    await runCritic(u, [], c, cacheReturning({ status: 'failed', findings: [], droppedByPostureLint: 0, malformed: 0, reason: 'critic model unavailable' }));
    expect(c.calls).toBe(0);
  });

  it('a junk cache object no longer takes the whole review down', async () => {
    const c = client();
    const out = await reviewFunctional([u.plan], new Map([[u.plan.requirementIds[0], u.context]]), [u.file], {
      critic: c,
      criticCache: cacheReturning({ status: 'ok', findings: [1], droppedByPostureLint: 0, malformed: 0 }),
    });
    expect(out.report.critic.status).toBe('ok');
    expect(out.report.counts).toBeDefined();
    expect(c.calls).toBe(1);
  });
});

describe('the cache key carries the result-shape version', () => {
  const parts = { planInputHash: 'h', fileContents: 'f', deterministic: [], modelId: 'm', promptVersion: 'p' };

  it('defaults to the current version', () => {
    expect(criticCacheKey(parts)).toBe(criticCacheKey({ ...parts, resultVersion: CRITIC_RESULT_VERSION }));
  });

  it('a different version gives a different key, so entries written before a shape change are never read', () => {
    expect(criticCacheKey({ ...parts, resultVersion: CRITIC_RESULT_VERSION + 1 })).not.toBe(criticCacheKey(parts));
  });
});
