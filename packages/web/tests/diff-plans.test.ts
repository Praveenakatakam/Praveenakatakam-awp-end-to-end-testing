/**
 * [web] tier — `diffPlans` (T-27 · R-77 Changes tab) and plan/critique parsing.
 */
import { describe, it, expect } from 'vitest';
import { diffPlans, parsePlan, parseCritique } from '../src/lib.js';

const base = {
  requirementIds: ['publisher/R-01'],
  title: 'T',
  rationale: 'why',
  setup: [{ description: 'token' }],
  trigger: { source: 'publisher', entity: 'Task', method: 'POST', path: '/tasks', payloadShape: 'body' },
  propagation: { kind: 'cdc', waitFor: 'stream' },
  assertions: [
    { service: 'consumer', assertion: 'A' },
    { service: 'consumer', assertion: 'B' },
  ],
};

describe('diffPlans', () => {
  it('returns no changes for identical plans, regardless of key order', () => {
    const reordered = { ...base, assertions: base.assertions.map((a) => ({ assertion: a.assertion, service: a.service })) };
    expect(diffPlans(base, reordered)).toEqual([]);
  });

  it('reports a changed scalar field with before/after', () => {
    expect(diffPlans(base, { ...base, trigger: { ...base.trigger, path: '/v2/tasks' } })).toEqual([
      { field: 'trigger.path', kind: 'changed', before: '/tasks', after: '/v2/tasks' },
    ]);
  });

  it('reports added and removed optional scalars', () => {
    const withExample = { ...base, trigger: { ...base.trigger, examplePayload: '{}' } };
    expect(diffPlans(base, withExample)).toEqual([{ field: 'trigger.examplePayload', kind: 'added', after: '{}' }]);
    const { rationale: _r, ...noRationale } = base;
    expect(diffPlans(base, noRationale)).toEqual([{ field: 'rationale', kind: 'removed', before: 'why' }]);
  });

  it('reports a list item edit as one removed + one added', () => {
    const b = { ...base, assertions: [base.assertions[0], { service: 'consumer', assertion: 'B2', field: 'status', expected: 'DONE' }] };
    expect(diffPlans(base, b)).toEqual([
      { field: 'assertions', kind: 'removed', before: '[consumer] B' },
      { field: 'assertions', kind: 'added', after: '[consumer] B2 (status = DONE)' },
    ]);
  });

  it('ignores reordering of list items and treats duplicates as a multiset', () => {
    const swapped = { ...base, assertions: [base.assertions[1], base.assertions[0]] };
    expect(diffPlans(base, swapped)).toEqual([]);
    const dup = { ...base, assertions: [...base.assertions, base.assertions[0]] };
    expect(diffPlans(base, dup)).toEqual([{ field: 'assertions', kind: 'added', after: '[consumer] A' }]);
  });

  it('diffs setup, negativeCases and requirementIds', () => {
    const b = {
      ...base,
      requirementIds: ['publisher/R-01', 'publisher/R-02'],
      setup: [],
      negativeCases: [{ description: 'bad id', expectedOutcome: '404' }],
    };
    expect(diffPlans(base, b)).toEqual([
      { field: 'requirementIds', kind: 'added', after: 'publisher/R-02' },
      { field: 'setup', kind: 'removed', before: 'token' },
      { field: 'negativeCases', kind: 'added', after: 'bad id → 404' },
    ]);
  });
});

describe('parsePlan / parseCritique', () => {
  it('parses plan-shaped JSON and rejects anything else', () => {
    expect(parsePlan(JSON.stringify(base))?.title).toBe('T');
    expect(parsePlan('not json')).toBeNull();
    expect(parsePlan('{"verdict":"approve","issues":[]}')).toBeNull();
    expect(parsePlan(null)).toBeNull();
  });

  it('parses critique-shaped JSON and rejects anything else', () => {
    expect(parseCritique('{"verdict":"approve","summary":"ok","issues":[]}')).toEqual({ verdict: 'approve', summary: 'ok', issues: [] });
    expect(parseCritique(JSON.stringify(base))).toBeNull();
    expect(parseCritique('{')).toBeNull();
  });
});
