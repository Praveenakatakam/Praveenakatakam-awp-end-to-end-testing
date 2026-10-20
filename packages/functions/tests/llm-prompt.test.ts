import { describe, it, expect } from 'vitest';
import type { GroundedContext } from '@registry/functest';
import { PROMPTS, userPrompt } from '../src/llm-prompt.js';
import { PROMPT_VERSION } from '../src/functional-gen.js';

/** A grounded TaskPublished context as `ground()` produces it under the declared flow (R-117c). */
function ctx(): GroundedContext {
  const prop = (name: string, logicalType = 'string') => ({ name, required: true, logicalType });
  return {
    requirement: { source: 'awp-app-plane', id: 'CRE-R-24', text: 'WHEN approved the TaskPublished event SHALL be published', earsType: 'event-driven', section: '3.2' },
    entity: 'TaskPublished',
    sources: ['create', 'get-ready'],
    roles: { publisher: 'create', consumer: 'get-ready' },
    fieldMap: { taskId: 'id', itemCount: 'totalItemCount' },
    schema: [prop('taskId'), prop('itemCount', 'integer')],
    schemasBySource: { create: [prop('taskId'), prop('itemCount', 'integer')], 'get-ready': [prop('id'), prop('totalItemCount', 'integer')] },
    apiTargets: [{ source: 'get-ready', target: { path: '/api/grdy/assignments/getTasks', baseUrlEnv: 'GET_READY_API_URL', tokenEnv: 'GET_READY_TOKEN', recordsAt: '' } }],
    inputHash: 'f'.repeat(64),
  };
}

describe('functional prompt v3 (T-54a · R-117c, D-84, D-85)', () => {
  it('the worker uses prompt v3, and v1/v2 stay registered for cached-plan provenance', () => {
    expect(PROMPT_VERSION).toBe('v3');
    expect(Object.keys(PROMPTS).sort()).toEqual(['v1', 'v2', 'v3']);
  });

  it('v3 tells the model the trigger source MUST be the declared publisher and to use consumer field names', () => {
    expect(PROMPTS.v3).toMatch(/trigger\.source` MUST be the declared publisher/);
    expect(PROMPTS.v3).toMatch(/field correspondence/i);
  });

  it('the user prompt states the flow and the field correspondence', () => {
    const p = userPrompt(ctx());
    expect(p).toContain('Flow: create (publisher) → get-ready (consumer)');
    expect(p).toContain('Field correspondence (publisher → consumer):');
    expect(p).toContain('  - taskId → id');
    expect(p).toContain('  - itemCount → totalItemCount');
  });

  it('with no field map, the correspondence block says names match', () => {
    const p = userPrompt({ ...ctx(), fieldMap: {} });
    expect(p).toContain('Field correspondence (publisher → consumer): none declared; names match across the flow');
  });
});
