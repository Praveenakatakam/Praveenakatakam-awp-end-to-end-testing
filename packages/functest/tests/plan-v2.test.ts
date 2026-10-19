/**
 * PLAN_SCHEMA v2 + CRITIQUE_SCHEMA (configurable-llm-pipeline v0.4.0 · T-18).
 *
 * Requirements: R-61, R-62, R-64, D-25 · Tests: TS-47 (validator half)
 */
import { describe, it, expect } from 'vitest';
import { validatePlan, validateCritique, PLAN_SCHEMA, CRITIQUE_SCHEMA, type PlanBody } from '../src/index.js';

const grounded = { entity: 'TaskPublished', sources: ['create-evb', 'get-ready'] };

/** A v1-shaped plan: no v2 fields at all. */
function v1Plan(): Omit<PlanBody, 'rationale'> {
  return {
    requirementIds: ['get-ready/R-1'],
    title: 'published task reaches get-ready',
    setup: [],
    trigger: { source: 'create-evb', entity: 'TaskPublished', method: 'POST', path: '/tasks', payloadShape: '{ taskId }' },
    propagation: { kind: 'cdc', waitFor: 'get-ready lists the task' },
    assertions: [{ service: 'get-ready', assertion: 'getTasks includes taskId' }],
  };
}

function v2Plan(): PlanBody {
  return {
    ...v1Plan(),
    rationale: 'R-1 requires published tasks to be visible to get-ready.',
    trigger: { ...v1Plan().trigger, examplePayload: '{"taskId":"t-1"}' },
    propagation: { kind: 'eventbridge', waitFor: 'event delivered', channel: 'default / TaskPublished' },
    assertions: [{ service: 'get-ready', assertion: 'task present', field: 'taskId', expected: 't-1' }],
    negativeCases: [{ description: 'missing taskId', expectedOutcome: '400' }],
  };
}

describe('PLAN_SCHEMA v2 (R-61)', () => {
  it('accepts a plan using every v2 field', () => {
    expect(validatePlan(v2Plan(), grounded)).toEqual({ ok: true, body: v2Plan() });
  });

  it('requires rationale for model output', () => {
    const v = validatePlan(v1Plan(), grounded);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/rationale/);
    expect(PLAN_SCHEMA.required).toContain('rationale');
  });

  it('tolerates an absent rationale for stored/cached v1 plans (D-25)', () => {
    expect(validatePlan(v1Plan(), grounded, { requireRationale: false }).ok).toBe(true);
  });

  it('accepts propagation kinds cdc | eventbridge | sync and rejects others', () => {
    for (const kind of ['cdc', 'eventbridge', 'sync']) {
      expect(validatePlan({ ...v2Plan(), propagation: { kind, waitFor: 'x' } }, grounded).ok).toBe(true);
    }
    expect(validatePlan({ ...v2Plan(), propagation: { kind: 'kafka', waitFor: 'x' } }, grounded).ok).toBe(false);
  });

  it('assertions[].service is not an enum — any grounded source passes', () => {
    expect(PLAN_SCHEMA.properties.assertions.items.properties.service).toEqual({ type: 'string' });
  });

  it('TS-47: an assertion service outside the grounded sources is a hallucinated target', () => {
    const bad = { ...v2Plan(), assertions: [{ service: 'consumer', assertion: 'x' }] };
    const v = validatePlan(bad, grounded);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/hallucinated target: assertion service 'consumer'/);
  });
});

describe('CRITIQUE_SCHEMA (R-62)', () => {
  const critique = {
    verdict: 'revise',
    summary: 'Trigger path is wrong.',
    issues: [{ severity: 'major', target: 'trigger.path', problem: 'not an API path', suggestion: 'use /tasks' }],
  };

  it('accepts a well-formed critique', () => {
    expect(validateCritique(critique)).toEqual({ ok: true, body: critique });
  });

  it('rejects an unknown verdict / severity and missing fields', () => {
    expect(validateCritique({ ...critique, verdict: 'maybe' }).ok).toBe(false);
    expect(validateCritique({ ...critique, issues: [{ ...critique.issues[0], severity: 'huge' }] }).ok).toBe(false);
    const v = validateCritique({ verdict: 'approve' });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/malformed critique/);
  });

  it('is a closed object schema', () => {
    expect(CRITIQUE_SCHEMA.additionalProperties).toBe(false);
    expect(CRITIQUE_SCHEMA.required).toEqual(['verdict', 'summary', 'issues']);
  });
});
