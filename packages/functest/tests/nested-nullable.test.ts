/**
 * F-03 of the adversarial-code-review run 20261014-1531: `stampPlan` decides nullability from the FLATTENED
 * schema, so a nested nullable field (`tags[0].note`) is recognised, not only a top-level one (R-117b).
 */
import { describe, it, expect } from 'vitest';
import { emitFunctionalTests, ground, stampPlan, type ContractInput, type PlanBody, type RequirementInput } from '../src/index.js';
import type { EntityApiTarget } from '@registry/core';

const nullable = [{ property: 'nullable', value: 'true' }];
const nestedContract = (source: string): ContractInput => ({
  source,
  entity: 'org',
  id: 'org-contract',
  contentHash: `${source}-h`,
  // JSON is valid YAML, which keeps the nested structure readable here.
  rawYaml: JSON.stringify({
    version: '1.0.0',
    apiVersion: 'v3.1.0',
    kind: 'DataContract',
    id: 'org-contract',
    name: 'org',
    schema: [
      {
        name: 'org',
        properties: [
          { name: 'sourcedId', required: true, logicalType: 'string' },
          { name: 'name', required: true, logicalType: 'string', customProperties: nullable },
          {
            name: 'tags',
            logicalType: 'array',
            items: {
              logicalType: 'object',
              properties: [
                { name: 'note', logicalType: 'string', customProperties: nullable },
                { name: 'tagId', logicalType: 'string' },
              ],
            },
          },
        ],
      },
    ],
  }),
});

const target = (prefix: string): EntityApiTarget => ({ path: '/orgs', baseUrlEnv: `${prefix}_API_URL`, tokenEnv: `${prefix}_TOKEN`, recordsAt: 'items' });
const API_MAP = { publisher: { org: target('PUBLISHER') }, consumer: { org: target('CONSUMER') } };
const req: RequirementInput = { source: 'publisher', id: 'R-10', text: 'WHEN an org is created it SHALL be published', earsType: 'ubiquitous', section: '3.1' };

const body = (assertions: PlanBody['assertions']): PlanBody => ({
  requirementIds: ['R-10'],
  title: 'org reaches the consumer',
  setup: [],
  trigger: { source: 'publisher', entity: 'org', method: 'POST', path: '/orgs', payload: { sourcedId: 'o1', name: 'N' } },
  propagation: { kind: 'cdc', waitFor: 'consumer reflects', timeoutSeconds: 30, pollIntervalSeconds: 2, readBack: { service: 'consumer', path: '/orgs', matchOn: 'sourcedId' } },
  assertions,
});
const exists = (fieldPath: string) => ({ service: 'consumer' as const, fieldPath, operator: 'exists' as const, clause: 'it SHALL be published' });

function context() {
  const g = ground(req, [nestedContract('publisher'), nestedContract('consumer')], API_MAP, 'm', 'v1');
  if (!g.ok) throw new Error('fixture must ground');
  return g.context;
}
const stampWith = (assertions: PlanBody['assertions']) => stampPlan(body(assertions), context());

describe('a nested nullable field is recognised as nullable', () => {
  it('flags it under dotted, bracketed and bare-array spellings', () => {
    expect(stampWith([exists('tags[0].note'), exists('tags.0.note'), exists('tags[].note')]).nullable).toEqual([
      'consumer:tags.0.note',
      'consumer:tags[0].note',
      'consumer:tags[].note',
    ]);
  });

  it('does not flag a nested field the contract does not mark nullable', () => {
    expect(stampWith([exists('tags[0].tagId')]).nullable).toBeUndefined();
  });

  it('still flags a top-level nullable field, and not a non-nullable one', () => {
    expect(stampWith([exists('name'), exists('sourcedId')]).nullable).toEqual(['consumer:name']);
  });

  it('the emitted exists check accepts null for the nested nullable field and keeps rejecting it for the other', () => {
    const lenient = emitFunctionalTests([stampWith([exists('tags[0].note')])])[0].contents;
    const strict = emitFunctionalTests([stampWith([exists('tags[0].tagId')])])[0].contents;
    expect(lenient).not.toContain('not.toBeNull');
    expect(strict).toContain('not.toBeNull');
  });

  it('a context built without flat schemas keeps the old top-level behaviour', () => {
    const { flatSchemasBySource: _flat, ...legacy } = context();
    expect(stampPlan(body([exists('tags[0].note'), exists('name')]), legacy).nullable).toEqual(['consumer:name']);
  });
});
