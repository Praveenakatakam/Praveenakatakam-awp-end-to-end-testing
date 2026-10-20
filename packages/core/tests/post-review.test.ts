/**
 * Post-review fixes (adversarial-test-review run 20261013-1055, nested items and declared flows).
 */
import { describe, it, expect } from 'vitest';
import { flattenContractProperties, resolveItemsProperties, resolveRoles, ENTITY_FLOWS } from '../src/index.js';

/** A contract shaped like create.content-events: `items` names a sibling schema object in its description. */
const doc = (itemsDescription: string, itemObjectName = 'TaskPublishedItem', extra: Record<string, unknown> = {}) => ({
  schema: [
    {
      name: 'TaskPublished',
      properties: [
        { name: 'taskId', logicalType: 'string', required: true },
        { name: 'items', logicalType: 'array', required: true, description: itemsDescription, ...extra },
      ],
    },
    {
      name: itemObjectName,
      logicalType: 'object',
      properties: [
        { name: 'itemId', logicalType: 'string', required: true },
        { name: 'itemType', logicalType: 'string', required: false },
      ],
    },
  ],
});
const names = (d: unknown) => flattenContractProperties(d).map((p) => `${p.name}${p.required ? '*' : ''}`);

describe('an array whose description names a sibling schema object takes that object as its items (review run 20261013-1055)', () => {
  it('flattens the sibling object under items[] with required carried through', () => {
    expect(names(doc('Ordered list of TaskPublishedItem objects — one per item.'))).toEqual(['items*', 'items[].itemId*', 'items[].itemType', 'taskId*']);
  });

  it('an optional array makes its nested properties optional too', () => {
    const d = doc('List of TaskPublishedItem objects.');
    (d.schema[0].properties as any[])[1].required = false;
    expect(names(d)).toEqual(['items', 'items[].itemId', 'items[].itemType', 'taskId*']);
  });

  it('matches the whole word only: TaskPublishedItems is not TaskPublishedItem', () => {
    expect(names(doc('List of TaskPublishedItems.'))).toEqual(['items*', 'taskId*']);
  });

  it('does nothing when the description names no sibling object', () => {
    expect(names(doc('An ordered list of things.'))).toEqual(['items*', 'taskId*']);
  });

  it('does nothing when the named object is not in the same document (the get-ready case)', () => {
    const d = doc('Projected subset of TaskPublishedItem objects from create.content-events.', 'SomethingElse');
    expect(names(d)).toEqual(['items*', 'taskId*']);
  });

  it('an explicit items.properties wins over the description', () => {
    const d = doc('List of TaskPublishedItem objects.', 'TaskPublishedItem', { items: { logicalType: 'object', properties: [{ name: 'only', logicalType: 'string', required: true }] } });
    expect(names(d)).toEqual(['items*', 'items[].only*', 'taskId*']);
  });

  it('never resolves a non-array property, nor the entity under test itself', () => {
    const d = doc('Mentions TaskPublished and TaskPublishedItem.');
    (d.schema[0].properties as any[])[1].logicalType = 'object';
    expect(names(d)).toEqual(['items*', 'taskId*']);
    expect(resolveItemsProperties({ logicalType: 'array', description: 'the TaskPublished record' }, d)).toBeUndefined();
  });

  it('resolveItemsProperties returns the sibling object properties', () => {
    const d = doc('List of TaskPublishedItem objects.');
    expect(resolveItemsProperties((d.schema[0].properties as any[])[1], d)?.map((p: any) => p.name)).toEqual(['itemId', 'itemType']);
  });
});

describe('declared flows for the multi-source entities (review run 20261013-1055)', () => {
  it('declares ClassAssignment deliver → frontend, ResultPackage deliver → score, StudentTaskScoredEvent score → report', () => {
    expect(ENTITY_FLOWS.ClassAssignment).toEqual({ publisher: 'deliver', consumer: 'frontend' });
    expect(ENTITY_FLOWS.ResultPackage).toEqual({ publisher: 'deliver', consumer: 'score' });
    expect(ENTITY_FLOWS.StudentTaskScoredEvent).toEqual({ publisher: 'score', consumer: 'report' });
    expect(ENTITY_FLOWS.TaskPublished).toEqual({ publisher: 'create', consumer: 'get-ready' });
  });

  it('resolveRoles resolves each from the sources that carry the entity, never from label order', () => {
    expect(resolveRoles('ClassAssignment', ['frontend', 'deliver'])).toMatchObject({ publisher: 'deliver', consumer: 'frontend' });
    expect(resolveRoles('ResultPackage', ['score', 'deliver'])).toMatchObject({ publisher: 'deliver', consumer: 'score' });
    expect(resolveRoles('StudentTaskScoredEvent', ['report', 'score'])).toMatchObject({ publisher: 'score', consumer: 'report' });
  });

  it('a flow whose sources are not both present stays unresolved', () => {
    expect(resolveRoles('ResultPackage', ['deliver', 'onboard'])).toBeUndefined();
  });
});

// ---- code review F-01 (Critical): sibling resolution must terminate ---------

describe('resolveItemsProperties never recurses forever (code review F-01, NFR-4)', () => {
  const cyc = (a: string, b: string, selfName?: string) => ({
    schema: [
      { name: 'Root', properties: [{ name: 'xs', logicalType: 'array', required: true, description: 'List of ' + a + ' objects.' }] },
      {
        name: 'A',
        logicalType: 'object',
        properties: [
          { name: 'id', logicalType: 'string', required: true },
          { name: 'next', logicalType: 'array', required: false, description: selfName ? 'List of ' + selfName + ' objects.' : 'List of ' + b + ' objects.' },
        ],
      },
      {
        name: 'B',
        logicalType: 'object',
        properties: [
          { name: 'bid', logicalType: 'string', required: true },
          { name: 'back', logicalType: 'array', required: false, description: 'List of A objects.' },
        ],
      },
    ],
  });

  it('a sibling whose own array names itself terminates; the repeat is left undeclared', () => {
    const d = cyc('A', 'B', 'A');
    expect(() => flattenContractProperties(d)).not.toThrow();
    expect(flattenContractProperties(d).map((p) => p.name)).toEqual(['xs', 'xs[].id', 'xs[].next']);
  });

  it('A names B and B names A: terminates, expanding each object once along the path', () => {
    const d = cyc('A', 'B');
    expect(() => flattenContractProperties(d)).not.toThrow();
    expect(flattenContractProperties(d).map((p) => p.name)).toEqual(['xs', 'xs[].id', 'xs[].next', 'xs[].next[].back', 'xs[].next[].bid']);
  });

  it('the same sibling used by two different arrays is expanded under both (not a cycle)', () => {
    const d = {
      schema: [
        {
          name: 'Root',
          properties: [
            { name: 'a', logicalType: 'array', description: 'List of A objects.' },
            { name: 'b', logicalType: 'array', description: 'More A objects.' },
          ],
        },
        { name: 'A', logicalType: 'object', properties: [{ name: 'id', logicalType: 'string' }] },
      ],
    };
    expect(flattenContractProperties(d).map((p) => p.name)).toEqual(['a', 'a[].id', 'b', 'b[].id']);
  });

  it('resolveItemsProperties returns nothing for a property already being expanded', () => {
    const d = cyc('A', 'B', 'A');
    const a = (d.schema[1].properties as any[])[1];
    const aProps = d.schema[1].properties;
    expect(resolveItemsProperties(a, d)).toBe(aProps);
    expect(resolveItemsProperties(a, d, new Set([aProps]))).toBeUndefined();
  });
});
