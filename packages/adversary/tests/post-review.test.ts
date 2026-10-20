/**
 * Post-review fixes: adversarial-test-review runs 20261013-1055 and 20261013-1121.
 * Each describe names the finding it closes.
 */
import { describe, it, expect } from 'vitest';
import {
  emitFunctionalTests,
  generateFunctionalPlans,
  ground,
  stampPlan,
  type ContractInput,
  type FunctionalGenInputs,
  type FunctionalTestPlan,
  type LlmClient,
  type PlanBody,
  type PlanCache,
  type RequirementInput,
} from '@registry/functest';
import type { EntityApiTarget } from '@registry/core';
import { groundPlan, reviewFunctional, scorePlan, finalizeFindings, type DraftFinding, type FunctionalUnderReview } from '../src/index.js';
import { locateClause } from '../src/text.js';

// ---- fixtures --------------------------------------------------------------

const PROPS = [
  '      - name: sourcedId',
  '        required: true',
  '        logicalType: string',
  '      - name: title',
  '        required: true',
  '        logicalType: string',
  '      - name: tags',
  '        logicalType: array',
  '        items:',
  '          logicalType: object',
  '          properties:',
  '            - name: tagId',
  '              logicalType: string',
  '      - name: extras',
  '        logicalType: array',
  '      - name: meta',
  '        logicalType: object',
];

function contractYaml(entity: string, props: string[] = PROPS) {
  return ['version: 1.0.0', 'apiVersion: v3.1.0', 'kind: DataContract', `id: ${entity}-contract`, `name: ${entity}`, 'schema:', `  - name: ${entity}`, '    properties:', ...props].join('\n');
}
const contract = (source: string, entity: string, hash: string, props?: string[]): ContractInput => ({ source, entity, id: `${entity}-contract`, contentHash: hash, rawYaml: contractYaml(entity, props) });
const req = (source: string, id: string, text: string): RequirementInput => ({ source, id, text, earsType: 'ubiquitous', section: '3.1' });
const target = (prefix: string, recordsAt = 'items'): EntityApiTarget => ({ path: '/orgs', baseUrlEnv: `${prefix}_API_URL`, tokenEnv: `${prefix}_TOKEN`, recordsAt });
const API_MAP = { publisher: { org: target('PUBLISHER') }, consumer: { org: target('CONSUMER') } };
const TEXT = 'WHEN an org is created it SHALL be published';

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
const consumerExists = (fieldPath: string) => ({ service: 'consumer' as const, fieldPath, operator: 'exists' as const, clause: 'it SHALL be published' });

function underReview(assertions: PlanBody['assertions']): FunctionalUnderReview {
  const contracts = [contract('publisher', 'org', 'a'), contract('consumer', 'org', 'b')];
  const g = ground(req('publisher', 'R-10', TEXT), contracts, API_MAP, 'm', 'v1');
  if (!g.ok) throw new Error('fixture must ground');
  const plan = stampPlan(body(assertions), g.context);
  return { plan, context: g.context, file: emitFunctionalTests([plan])[0] };
}
const r133a = (fs: DraftFinding[]) => fs.filter((f) => f.rule === 'R-133a').map((f) => f.severity);

// ---- run 2 F-02 -------------------------------------------------------------

describe('R-133a resolves the whole fieldPath, not only its first segment (run 2 F-02)', () => {
  it('a clean top-level path is not flagged (control)', () => {
    expect(r133a(groundPlan(underReview([consumerExists('title')])))).toEqual([]);
  });

  it('a child path under a scalar property is Critical: title.foo', () => {
    const fs = groundPlan(underReview([consumerExists('title.foo')]));
    expect(r133a(fs)).toEqual(['Critical']);
    expect(fs.find((f) => f.rule === 'R-133a')?.evidence).toMatch(/title\.foo/);
  });

  it('a declared nested path resolves, indexed either way: tags.0.tagId and tags[0].tagId', () => {
    expect(r133a(groundPlan(underReview([consumerExists('tags.0.tagId'), consumerExists('tags[0].tagId')])))).toEqual([]);
  });

  it('an undeclared child of a declared nested object is Critical: tags.0.nope', () => {
    expect(r133a(groundPlan(underReview([consumerExists('tags.0.nope')])))).toEqual(['Critical']);
  });

  it('a path into an array/object whose structure the contract never declares is Major (unverifiable), not silently accepted', () => {
    expect(r133a(groundPlan(underReview([consumerExists('extras.0.itemId')])))).toEqual(['Major']);
    expect(r133a(groundPlan(underReview([consumerExists('meta.anything')])))).toEqual(['Major']);
  });

  it('an absent top-level field is still Critical', () => {
    expect(r133a(groundPlan(underReview([consumerExists('nope')])))).toEqual(['Critical']);
  });

  it('a matchesType literal is checked against the NESTED property', () => {
    const wrong = underReview([{ service: 'consumer', fieldPath: 'tags.0.tagId', operator: 'matchesType', expected: { from: 'literal', value: 'integer' }, clause: 'it SHALL be published' }]);
    expect(r133a(groundPlan(wrong))).toEqual(['Critical']);
    const right = underReview([{ service: 'consumer', fieldPath: 'tags.0.tagId', operator: 'matchesType', expected: { from: 'literal', value: 'string' }, clause: 'it SHALL be published' }]);
    expect(r133a(groundPlan(right))).toEqual([]);
  });

  it('a context built without flat schemas keeps the old top-level behaviour', () => {
    const u = underReview([consumerExists('title.foo')]);
    const { flatSchemasBySource: _flat, ...legacy } = u.context;
    expect(r133a(groundPlan({ ...u, context: legacy }))).toEqual([]);
  });
});

// ---- run 2 F-07 -------------------------------------------------------------

describe('mutation scoring uses the DECLARED consumer (run 2 F-07, R-135 v0.8.0)', () => {
  it('with a third source that sorts first, mutants come from the declared consumer, not source order', () => {
    const props = (names: string[]) => names.flatMap((n) => [`      - name: ${n}`, '        required: true', '        logicalType: string']);
    const contracts = [
      contract('aaa', 'Task', 'x', props(['unrelated'])),
      contract('create', 'Task', 'c', props(['title'])),
      contract('get-ready', 'Task', 'g', props(['title'])),
    ];
    const apiMap = { create: { Task: target('CREATE') }, 'get-ready': { Task: target('GET_READY') } };
    const g = ground(req('create', 'R-1', 'WHEN a Task is created it SHALL be published'), contracts, apiMap, 'm', 'v1', undefined, { Task: { publisher: 'create', consumer: 'get-ready' } });
    if (!g.ok) throw new Error('fixture must ground');
    const plan = stampPlan(
      {
        ...body([{ service: 'consumer', fieldPath: 'title', operator: 'equals', expected: { from: 'trigger.payload', path: 'title' }, clause: 'it SHALL be published' }]),
        trigger: { source: 'create', entity: 'Task', method: 'POST', path: '/orgs', payload: { title: 'T' } },
        propagation: { kind: 'cdc', waitFor: 'x', timeoutSeconds: 30, pollIntervalSeconds: 2, readBack: { service: 'consumer', path: '/orgs', matchOn: 'title' } },
      },
      g.context
    );
    const score = scorePlan({ plan, context: g.context, file: emitFunctionalTests([plan])[0] });
    expect(g.context.roles.consumer).toBe('get-ready');
    // MP-drop/corrupt/type for `title` (declared consumer) + M-noprop. Source order would pick `aaa`: M-noprop only.
    expect(score.total).toBe(4);
    expect(score.killed).toContain('MP-corrupt:title');
  });
});

// ---- run 1 F-04 / F-06 ------------------------------------------------------

describe('identical requirement texts and withheld plans in reviewFunctional (run 1 F-04, F-06)', () => {
  const absent = body([consumerExists('nope')]); // R-133a Critical on every plan
  const llm: LlmClient = { synthesizePlan: async () => absent };
  const cache = (): PlanCache => {
    const m = new Map<string, FunctionalTestPlan>();
    return { get: async (k) => m.get(k), set: async (k, v) => void m.set(k, v) };
  };
  const inputs = (reqs: RequirementInput[]): FunctionalGenInputs => ({
    requirements: reqs,
    contracts: [contract('publisher', 'org', 'a'), contract('consumer', 'org', 'b')],
    apiMap: API_MAP,
    modelId: 'm',
    promptVersion: 'v1',
  });

  it('two requirements with the same text are each reviewed under their own id and file', async () => {
    const { plans, contexts } = await generateFunctionalPlans(inputs([req('publisher', 'R-1', TEXT), req('publisher', 'R-2', TEXT)]), llm, cache());
    expect(plans).toHaveLength(2);
    expect(plans[0].inputHash).toBe(plans[1].inputHash);
    const files = emitFunctionalTests(plans);
    const r = await reviewFunctional(plans, contexts, files);
    expect(r.withheld.map((w) => w.requirement)).toEqual(['publisher/R-1', 'publisher/R-2']);
    const byRef = (ref: string) => r.report.deterministic.filter((f) => f.target.ref === ref);
    expect(byRef('publisher/R-1').length).toBeGreaterThan(0);
    expect(byRef('publisher/R-2').length).toBeGreaterThan(0);
    expect(new Set(byRef('publisher/R-1').map((f) => f.target.file))).toEqual(new Set(['functional/r-1-org.generated.test.ts']));
    expect(new Set(byRef('publisher/R-2').map((f) => f.target.file))).toEqual(new Set(['functional/r-2-org.generated.test.ts']));
  });

  it('the committed block drops `file` for a withheld plan (no such file exists) and marks it withheld', async () => {
    const { plans, contexts } = await generateFunctionalPlans(inputs([req('publisher', 'R-1', TEXT)]), llm, cache());
    const r = await reviewFunctional(plans, contexts, emitFunctionalTests(plans));
    expect(r.kept).toEqual([]);
    expect(r.block.findings.length).toBeGreaterThan(0);
    for (const f of r.block.findings) {
      expect(f.target.file).toBeUndefined();
      expect(f.target).toMatchObject({ kind: 'functional', ref: 'publisher/R-1', withheld: true });
    }
    // The local report keeps the path: the file was rendered for review even though it is not committed.
    expect(r.report.deterministic.every((f) => f.target.file === 'functional/r-1-org.generated.test.ts')).toBe(true);
  });

  it('a kept plan keeps its file and is not marked withheld', async () => {
    const clean: LlmClient = { synthesizePlan: async () => body([consumerExists('title'), { service: 'consumer', fieldPath: 'title', operator: 'equals', expected: { from: 'trigger.payload', path: 'title' }, clause: 'it SHALL be published' }]) };
    const { plans, contexts } = await generateFunctionalPlans(inputs([req('publisher', 'R-1', TEXT)]), clean, cache());
    const r = await reviewFunctional(plans, contexts, emitFunctionalTests(plans));
    for (const f of r.block.findings) {
      expect(f.target.file).toBe('functional/r-1-org.generated.test.ts');
      expect(f.target).not.toHaveProperty('withheld');
    }
  });

  it('the ids of the committed findings do not depend on the withheld marking', () => {
    const drafts: DraftFinding[] = [
      { attack: 'grounding', severity: 'Critical', rule: 'R-133a', target: { kind: 'functional', ref: 'p/R-1', file: 'functional/r-1.ts' }, defect: 'd', failureScenario: 's' },
    ];
    expect(finalizeFindings(drafts)[0].id).toBe('A-01');
  });
});

// ---- run 1 F-08 / run 2 F-09 ------------------------------------------------

describe('finding order is locale-independent (run 1 F-08, run 2 F-09, R-88)', () => {
  const f = (ref: string): DraftFinding => ({ attack: 'grounding', severity: 'Major', rule: 'R-133e', target: { kind: 'functional', ref }, defect: 'd', failureScenario: 's' });

  it('assigns ids in code-point order of the target ref: uppercase first', () => {
    const out = finalizeFindings([f('b/R-1'), f('B/R-1'), f('a/R-10'), f('a/R-2')]);
    expect(out.map((x) => `${x.id} ${x.target.ref}`)).toEqual(['A-01 B/R-1', 'A-02 a/R-2', 'A-03 a/R-10', 'A-04 b/R-1']);
  });
});

// ---- run 20261013-1055, clause check -------------------------------------------------------------

describe('R-133c compares clauses modulo formatting, not wording (run 20261013-1055)', () => {
  const TEXT_FMT = 'WHEN a Task is approved the event SHALL be published\n  containing taskId, title and “taskType”.';
  const withClause = (clause: string, text = TEXT_FMT): FunctionalUnderReview => {
    const contracts = [contract('publisher', 'org', 'a'), contract('consumer', 'org', 'b')];
    const g = ground(req('publisher', 'R-10', text.replace('Task', 'org')), contracts, API_MAP, 'm', 'v1');
    if (!g.ok) throw new Error('fixture must ground');
    const plan = stampPlan(body([{ service: 'consumer', fieldPath: 'title', operator: 'exists', clause }]), g.context);
    return { plan, context: g.context, file: emitFunctionalTests([plan])[0] };
  };
  const r133c = (u: FunctionalUnderReview) => groundPlan(u).filter((f) => f.rule === 'R-133c').length;

  it('accepts markdown backticks the requirement text does not carry', () => {
    expect(r133c(withClause('containing `taskId`'))).toBe(0);
  });

  it('accepts a different run of whitespace or a line break', () => {
    expect(r133c(withClause('published containing taskId'))).toBe(0);
  });

  it('accepts straight quotes for the requirement’s curly quotes, and emphasis markers', () => {
    expect(r133c(withClause('and "taskType"'))).toBe(0);
    expect(r133c(withClause('**SHALL** be published'))).toBe(0);
  });

  it('is still Critical when the words differ', () => {
    expect(r133c(withClause('containing `itemId`'))).toBe(1);
    expect(r133c(withClause('SHALL NOT be published'))).toBe(1);
  });

  it('is still case-sensitive (SHALL is not shall)', () => {
    expect(r133c(withClause('shall be published'))).toBe(1);
  });

  it('an empty clause is still Critical', () => {
    expect(r133c(withClause(''))).toBe(1);
  });
});

describe('locateClause maps a tolerant match back to the original text', () => {
  it('returns the original start and length, so R-134f coverage uses real offsets', () => {
    const text = 'A SHALL do `x`\n  and y.';
    const hit = locateClause(text, 'do x and y');
    expect(hit && text.slice(hit.start, hit.start + hit.len)).toBe('do `x`\n  and y');
  });

  it('is undefined when the words are absent', () => {
    expect(locateClause('A SHALL do x.', 'do y')).toBeUndefined();
    expect(locateClause('A SHALL do x.', '')).toBeUndefined();
  });
});
