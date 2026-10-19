/**
 * Functional-test emitter v2 (configurable-llm-pipeline v0.4.0 · T-19).
 *
 * Requirements: R-66 · Tests: TS-50 · Acceptance: legacy output byte-identical.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { emitFunctionalTest, emitFunctionalTests, functionalTestPath, type FunctionalTestPlan } from '../src/index.js';

const golden = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

/** v1 plan — no v2 fields (matches the fixture the golden files were rendered from). */
function v1OrgPlan(): FunctionalTestPlan {
  return {
    requirementIds: ['R-10'],
    title: 'publisher-created org appears to the consumer',
    setup: [{ description: 'a writer access token for the publisher' }],
    trigger: { source: 'publisher', entity: 'org', method: 'POST', path: '/orgs', payloadShape: '{ sourcedId: string, name: string }' },
    propagation: { kind: 'cdc', waitFor: "the consumer's read model to reflect the new org (≤ 30s)" },
    assertions: [{ service: 'consumer', assertion: 'GET /orgs includes the new org by sourcedId' }],
    inputHash: 'f'.repeat(64),
  };
}

function taskPublishedPlan(): FunctionalTestPlan {
  return {
    requirementIds: ['get-ready/R-3'],
    title: 'published task is listed by get-ready',
    rationale: 'R-3 requires a published task to appear in the get-ready task list.\nIt crosses create-evb → get-ready.',
    setup: [],
    trigger: {
      source: 'get-ready',
      entity: 'TaskPublished',
      method: 'POST',
      path: '/api/grdy/assignments/publish',
      payloadShape: '{ taskId, title }',
      examplePayload: '{\n  "taskId": "t-1",\n  "title": "Essay"\n}',
    },
    propagation: { kind: 'eventbridge', waitFor: 'TaskPublished delivered', channel: 'default / TaskPublished' },
    assertions: [
      { service: 'create-evb', assertion: 'event recorded' },
      { service: 'get-ready', assertion: 'task listed', field: 'taskId', expected: 't-1' },
    ],
    negativeCases: [{ description: 'missing taskId', expectedOutcome: 'HTTP 400, no event' }],
    inputHash: 'a'.repeat(64),
  };
}

const taskTargets = [
  {
    source: 'get-ready',
    target: { baseUrlEnv: 'GET_READY_API_URL', tokenEnv: 'GET_READY_TOKEN' },
  },
];

function compiles(src: string): boolean {
  const diags = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  }).diagnostics;
  return (diags ?? []).length === 0;
}

describe('emitter v2 — legacy output unchanged (R-66)', () => {
  it('v1 plan without opts renders byte-identically to the pre-v0.4.0 emitter', () => {
    expect(emitFunctionalTest(v1OrgPlan(), 0)).toBe(golden('emit-v1-org.golden.txt'));
    expect(emitFunctionalTest({ ...v1OrgPlan(), setup: [], assertions: [] }, 3)).toBe(golden('emit-v1-empty.golden.txt'));
  });

  it('v1 plan with publisher/consumer apiTargets also renders byte-identically', () => {
    const apiTargets = [
      { source: 'consumer', target: { baseUrlEnv: 'CONSUMER_API_URL', tokenEnv: 'CONSUMER_TOKEN' } },
      { source: 'publisher', target: { baseUrlEnv: 'PUBLISHER_API_URL', tokenEnv: 'PUBLISHER_TOKEN' } },
    ];
    expect(emitFunctionalTest(v1OrgPlan(), 0, { apiTargets })).toBe(golden('emit-v1-org.golden.txt'));
  });

  it('emitFunctionalTests path is unchanged and exposed via functionalTestPath', () => {
    expect(emitFunctionalTests([v1OrgPlan()])[0].path).toBe('functional/r-10-org.generated.test.ts');
    expect(functionalTestPath(v1OrgPlan())).toBe('functional/r-10-org.generated.test.ts');
  });
});

describe('emitter v2 — apiTargets + v2 fields (R-66)', () => {
  const out = emitFunctionalTest(taskPublishedPlan(), 0, { apiTargets: taskTargets });

  it('TS-50: TaskPublished (get-ready, create-evb) reads GET_READY_* and never PUBLISHER_API_URL', () => {
    expect(out).toContain('const getReadyBase = process.env.GET_READY_API_URL;');
    expect(out).toContain('const getReadyToken = process.env.GET_READY_TOKEN;');
    expect(out).toContain('fetch(`${getReadyBase}/api/grdy/assignments/publish`');
    expect(out).toContain('Bearer ${getReadyToken}');
    expect(out).toContain('const ready = Boolean(getReadyBase && getReadyToken);');
    expect(out).not.toContain('PUBLISHER_API_URL');
    expect(out).not.toContain('CONSUMER_API_URL');
  });

  it('renders rationale, examplePayload, channel, property assertions and negative cases', () => {
    expect(out).toContain('// Rationale:\n//   R-3 requires a published task');
    expect(out).toContain('//   It crosses create-evb → get-ready.');
    expect(out).toContain('      // example body:\n      //   {\n      //     "taskId": "t-1",');
    expect(out).toContain('// PROPAGATION (eventbridge): TaskPublished delivered [channel: default / TaskPublished]');
    expect(out).toContain('it.todo("[create-evb] event recorded");');
    expect(out).toContain('it.todo("[get-ready] taskId = t-1 — task listed");');
    expect(out).toContain('it.todo("[negative] missing taskId → HTTP 400, no event");');
    expect(out).toContain('→ EVENTBRIDGE → create-evb reflects change');
  });

  it('is valid TypeScript and deterministic', () => {
    expect(compiles(out)).toBe(true);
    expect(emitFunctionalTest(taskPublishedPlan(), 0, { apiTargets: taskTargets })).toBe(out);
  });

  it('a trigger source without an API target gets a derived env pair', () => {
    const plan = { ...taskPublishedPlan(), trigger: { ...taskPublishedPlan().trigger, source: 'create-evb' } };
    const src = emitFunctionalTest(plan, 0, { apiTargets: taskTargets });
    expect(src).toContain('const createEvbBase = process.env.CREATE_EVB_API_URL;');
    expect(src).toContain('fetch(`${createEvbBase}');
    expect(src).toContain('const ready = Boolean(createEvbBase && createEvbToken && getReadyBase && getReadyToken);');
    expect(compiles(src)).toBe(true);
  });
});
