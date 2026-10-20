/**
 * Fixes for the Major findings of the adversarial-code-review run 20261014-1309
 * (F-02 … F-06). Each describe names the finding it closes.
 */
import { describe, it, expect } from 'vitest';
import { generateArtifacts, type CatalogContract, type ConformanceTest } from '@registry/testgen';
import { emitFunctionalTests, ground, stampPlan, type ContractInput, type PlanBody, type RequirementInput } from '@registry/functest';
import type { EntityApiTarget } from '@registry/core';
import {
  groundPlan,
  lintConformance,
  lintFunctional,
  runCritic,
  type CriticCache,
  type CriticClient,
  type CriticPlanResult,
  type FunctionalUnderReview,
} from '../src/index.js';

// ---- fixtures --------------------------------------------------------------

const PROPS = ['      - name: sourcedId', '        required: true', '        logicalType: string', '      - name: title', '        required: true', '        logicalType: string'];
const contractYaml = (entity: string) => ['version: 1.0.0', 'apiVersion: v3.1.0', 'kind: DataContract', `id: ${entity}-contract`, `name: ${entity}`, 'schema:', `  - name: ${entity}`, '    properties:', ...PROPS].join('\n');
const contract = (source: string, entity: string, hash: string): ContractInput => ({ source, entity, id: `${entity}-contract`, contentHash: hash, rawYaml: contractYaml(entity) });
const target = (prefix: string): EntityApiTarget => ({ path: '/orgs', baseUrlEnv: `${prefix}_API_URL`, tokenEnv: `${prefix}_TOKEN`, recordsAt: 'items' });
const API_MAP = { publisher: { org: target('PUBLISHER') }, consumer: { org: target('CONSUMER') } };
const TEXT = 'WHEN an org is created it SHALL be published';
const req: RequirementInput = { source: 'publisher', id: 'R-10', text: TEXT, earsType: 'ubiquitous', section: '3.1' };

function body(assertions: PlanBody['assertions']): PlanBody {
  return {
    requirementIds: ['R-10'],
    title: 'org reaches the consumer',
    setup: [],
    trigger: { source: 'publisher', entity: 'org', method: 'POST', path: '/orgs', payload: { sourcedId: 'o1', title: 'T' } },
    propagation: { kind: 'cdc', waitFor: 'consumer reflects', timeoutSeconds: 30, pollIntervalSeconds: 2, readBack: { service: 'consumer', path: '/orgs', matchOn: 'sourcedId' } },
    assertions,
  };
}
const clause = 'it SHALL be published';

function underReview(assertions: PlanBody['assertions']): FunctionalUnderReview {
  const g = ground(req, [contract('publisher', 'org', 'a'), contract('consumer', 'org', 'b')], API_MAP, 'm', 'v1');
  if (!g.ok) throw new Error('fixture must ground');
  const plan = stampPlan(body(assertions), g.context);
  return { plan, context: g.context, file: emitFunctionalTests([plan])[0] };
}
const withContents = (u: FunctionalUnderReview, contents: string): FunctionalUnderReview => ({ ...u, file: { ...u.file, contents } });

// ---- F-05 -------------------------------------------------------------------

describe('R-134a recognises the assertion shapes the emitter really renders (code review F-05)', () => {
  const rules = (u: FunctionalUnderReview) => lintFunctional(u).filter((f) => f.rule === 'R-134a');

  it('a matchesType-only plan is not told it has no assertion on a record field', () => {
    const u = underReview([{ service: 'consumer', fieldPath: 'title', operator: 'matchesType', expected: { from: 'literal', value: 'string' }, clause }]);
    expect(u.file.contents).toContain('expect(typeMatches(at(');
    expect(rules(u)).toEqual([]);
  });

  it('exists and equals plans are unaffected', () => {
    expect(rules(underReview([{ service: 'consumer', fieldPath: 'title', operator: 'exists', clause }]))).toEqual([]);
    expect(rules(underReview([{ service: 'consumer', fieldPath: 'title', operator: 'equals', expected: { from: 'trigger.payload', path: 'title' }, clause }]))).toEqual([]);
  });

  it('is still Critical when the file only checks the HTTP status', () => {
    const u = underReview([{ service: 'consumer', fieldPath: 'title', operator: 'exists', clause }]);
    const stripped = u.file.contents.replace(/^\s*expect\((?:typeMatches\()?at\([^\n]*\n/gm, '');
    expect(rules(withContents(u, stripped)).map((f) => f.severity)).toEqual(['Critical']);
  });
});

// ---- F-06 -------------------------------------------------------------------

describe('R-134h accepts only a real non-empty check (code review F-06)', () => {
  const catalog: CatalogContract[] = ['publisher', 'consumer'].map((source) => ({
    source,
    entity: 'org',
    id: `${source}-org`,
    contentHash: `${source}-hash0000000`,
    validation: 'valid' as const,
    rawYaml: JSON.stringify({ version: '1.0.0', apiVersion: 'v3.1.0', kind: 'DataContract', id: `${source}-org`, name: 'org', schema: [{ name: 'org', properties: [{ name: 'sourcedId', required: true, logicalType: 'string' }] }] }),
  }));
  const artifacts = generateArtifacts(catalog);
  const t = artifacts.manifest.tests.find((x): x is ConformanceTest => x.kind === 'conformance')!;
  const real = artifacts.files.find((f) => f.path.startsWith('conformance/'))!;
  const CHECK = /^\s*expect\(records\.length[^\n]*\n/m;
  const swap = (replacement: string) => ({ ...real, contents: real.contents.replace(CHECK, replacement) });
  const flagged = (file: { path: string; contents: string }) => lintConformance(t, file).filter((f) => f.rule === 'R-134h').length;

  it('the generator output (a real check) is clean', () => {
    expect(CHECK.test(real.contents)).toBe(true);
    expect(flagged(real)).toBe(0);
  });

  it.each([
    ['the token records.length only in a comment', '    // records.length is never checked\n'],
    ['an unrelated toHaveLength', '    expect(Object.keys(schema)).toHaveLength(3);\n'],
    ['toBeGreaterThanOrEqual(0), which every length satisfies', '    expect(records.length, "x").toBeGreaterThanOrEqual(0);\n'],
    ['a check on a different array', '    expect(other.length, "x").toBeGreaterThan(0);\n'],
  ])('flags %s', (_what, replacement) => {
    expect(flagged(swap(replacement))).toBe(1);
  });

  it.each([
    ['toBeGreaterThan(0)', '    expect(records.length, "x").toBeGreaterThan(0);\n'],
    ['toBeGreaterThanOrEqual(1)', '    expect(records.length).toBeGreaterThanOrEqual(1);\n'],
    ['.not.toHaveLength(0)', '    expect(records).not.toHaveLength(0);\n'],
  ])('accepts %s', (_what, replacement) => {
    expect(flagged(swap(replacement))).toBe(0);
  });
});

// ---- F-02 / F-03 ------------------------------------------------------------

describe('the critic is isolated and its failure reason is redacted (code review F-02, F-03, R-141, NFR-2)', () => {
  const u = underReview([{ service: 'consumer', fieldPath: 'title', operator: 'exists', clause }]);
  const okFindings = { findings: [{ severity: 'Minor', defect: 'A real defect.', failureScenario: 'A scenario.', evidence: 'x' }] };
  const client = (over: Partial<CriticClient> = {}): CriticClient & { calls: number } => {
    const c = {
      modelId: 'critic-model',
      promptVersion: 'p1',
      calls: 0,
      async blind() {
        c.calls++;
        return { behaviours: [] };
      },
      async reconcile() {
        return okFindings;
      },
      ...over,
    };
    return c;
  };
  const memCache = (over: Partial<CriticCache> = {}): CriticCache => {
    const m = new Map<string, CriticPlanResult>();
    return { get: async (k) => m.get(k), set: async (k, v) => void m.set(k, v), ...over };
  };

  it('redacts credentials from a failure reason: GitHub tokens, AWS keys, bearer tokens, JWTs, secret keys', async () => {
    const secrets = [
      'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
      'AKIAABCDEFGHIJKLMNOP',
      'Bearer abc.DEF-123_xyz',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk',
      'aws_secret_access_key=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    ];
    const r = await runCritic(u, [], client({ reconcile: async () => { throw new Error(`denied: ${secrets.join(' | ')}`); } }), memCache());
    expect(r.status).toBe('failed');
    for (const s of secrets) expect(r.reason).not.toContain(s);
    expect(r.reason).toContain('[redacted]');
  });

  it('redacts the account id in an ARN and keeps the useful part of the message', async () => {
    const r = await runCritic(u, [], client({ reconcile: async () => { throw new Error('User: arn:aws:iam::185718115448:user/x is not authorized to perform bedrock:InvokeModel'); } }), memCache());
    expect(r.status).toBe('unavailable');
    expect(r.reason).not.toContain('185718115448');
    expect(r.reason).toContain('bedrock:InvokeModel');
  });

  it('a cache read that throws is a miss: the critic still runs', async () => {
    const c = client();
    const r = await runCritic(u, [], c, memCache({ get: async () => { throw new Error('S3 503'); } }));
    expect(r.status).toBe('ok');
    expect(c.calls).toBe(1);
  });

  it('a cache write that throws does not fail the plan', async () => {
    const r = await runCritic(u, [], client(), memCache({ set: async () => { throw new Error('S3 AccessDenied'); } }));
    expect(r.status).toBe('ok');
    expect(r.findings).toHaveLength(1);
  });

  it('a corrupt cached object is a miss, not a result', async () => {
    const c = client();
    const r = await runCritic(u, [], c, memCache({ get: async () => ({ junk: true }) as unknown as CriticPlanResult }));
    expect(r.status).toBe('ok');
    expect(c.calls).toBe(1);
  });

  it('a good cached result is still reused without calling the critic', async () => {
    const cache = memCache();
    const first = client();
    await runCritic(u, [], first, cache);
    const second = client();
    const r = await runCritic(u, [], second, cache);
    expect(second.calls).toBe(0);
    expect(r.status).toBe('ok');
  });
});

// ---- F-04 -------------------------------------------------------------------

describe('R-133(d) catches a request sent to another service’s base URL (code review F-04)', () => {
  const u = underReview([{ service: 'consumer', fieldPath: 'title', operator: 'exists', clause }]);
  const d = (x: FunctionalUnderReview) => groundPlan(x).filter((f) => f.rule === 'R-133d');

  it('the emitted file is clean', () => {
    expect(d(u)).toEqual([]);
  });

  it('flags a base-URL variable bound to the other service’s env var', () => {
    const swapped = u.file.contents.replace('const publisherBase = process.env.PUBLISHER_API_URL', 'const publisherBase = process.env.CONSUMER_API_URL');
    expect(swapped).not.toBe(u.file.contents);
    const f = d(withContents(u, swapped));
    expect(f.every((x) => x.severity === 'Critical')).toBe(true);
    expect(f.some((x) => /another service's base URL/.test(x.defect) && /publisherBase is bound to CONSUMER_API_URL/.test(x.evidence ?? ''))).toBe(true);
  });

  it('flags a trigger sent to the consumer’s base URL', () => {
    const swapped = u.file.contents.replace('fetch(`${publisherBase}`', 'fetch(`${consumerBase}`');
    expect(swapped).not.toBe(u.file.contents);
    expect(d(withContents(u, swapped)).map((x) => x.severity)).toEqual(['Critical']);
  });

  it('flags a read-back polled on the wrong service’s base URL', () => {
    const swapped = u.file.contents.replace('url: `${consumerBase}`', 'url: `${publisherBase}`');
    expect(swapped).not.toBe(u.file.contents);
    expect(d(withContents(u, swapped)).map((x) => x.severity)).toEqual(['Critical']);
  });

  it('says nothing about a file whose shape it cannot read', () => {
    expect(d(withContents(u, '// not a recognisable functional test\n'))).toHaveLength(1); // R-133d (never reads the mapped env vars) still fires
    expect(groundPlan(withContents(u, '// x\n')).filter((f) => f.defect.includes('another service'))).toEqual([]);
  });
});
