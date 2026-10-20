/**
 * Nested items (adversarial-test-review run 20261013-1055): an array whose description names a sibling
 * schema object takes that object as its item type, in the derived conformance schema and in compat.
 */
import { describe, it, expect } from 'vitest';
import yaml from 'js-yaml';
import { checkCompat } from '../src/compat.js';
import { deriveJsonSchema } from '../src/derive-schema.js';

const publisher = (itemProps: unknown[]) => ({
  schema: [
    {
      name: 'TaskPublished',
      properties: [
        { name: 'taskId', logicalType: 'string', required: true },
        { name: 'items', logicalType: 'array', required: true, description: 'Ordered list of TaskPublishedItem objects.', logicalTypeOptions: { minItems: 1 } },
      ],
    },
    { name: 'TaskPublishedItem', logicalType: 'object', properties: itemProps },
  ],
});
const consumer = (itemProps: unknown[]) => ({
  schema: [
    {
      name: 'TaskPublished',
      properties: [
        { name: 'taskId', logicalType: 'string', required: true },
        { name: 'items', logicalType: 'array', required: true, items: { logicalType: 'object', properties: itemProps } },
      ],
    },
  ],
});
const ITEM = [
  { name: 'itemId', logicalType: 'string', required: true, logicalTypeOptions: { format: 'uuid' } },
  { name: 'itemType', logicalType: 'string', required: false },
];

describe('derived conformance schema nests a sibling item object (review run 20261013-1055)', () => {
  it('items becomes an object schema with the sibling properties, required list and constraints', () => {
    const { properties } = deriveJsonSchema(publisher(ITEM));
    expect(properties.items).toEqual({
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['itemId'],
        properties: { itemId: { type: 'string', format: 'uuid' }, itemType: { type: 'string' } },
      },
    });
  });

  it('a bare array with no named sibling is unchanged', () => {
    const d = publisher(ITEM);
    (d.schema[0].properties as any[])[1].description = 'An ordered list.';
    expect(deriveJsonSchema(d).properties.items).toEqual({ type: 'array', minItems: 1 });
  });
});

describe('compat compares nested item fields through a sibling item object (review run 20261013-1055)', () => {
  it('passes when the publisher sibling object carries what the consumer requires', () => {
    const r = checkCompat(yaml.load(yaml.dump(consumer([{ name: 'itemId', logicalType: 'string', required: true }]))), yaml.load(yaml.dump(publisher(ITEM))));
    expect(r.violations).toEqual([]);
    expect(r.publisherProps.map((p) => p.name)).toContain('items[].itemId');
  });

  it('fails when the publisher sibling object lacks a field the consumer requires: D-86 now fires on the live shape', () => {
    const r = checkCompat(
      yaml.load(yaml.dump(consumer([{ name: 'itemId', logicalType: 'string', required: true }]))),
      yaml.load(yaml.dump(publisher([{ name: 'itemType', logicalType: 'string', required: false }])))
    );
    expect(r.violations).toEqual([{ path: 'TaskPublished.items[].itemId', reason: 'required by consumer but absent in publisher' }]);
  });

  it('fails on a type change inside the sibling object', () => {
    const r = checkCompat(
      yaml.load(yaml.dump(consumer([{ name: 'itemId', logicalType: 'string', required: true }]))),
      yaml.load(yaml.dump(publisher([{ name: 'itemId', logicalType: 'integer', required: true }])))
    );
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0].reason).toMatch(/type mismatch/);
  });
});

describe('deriveJsonSchema terminates on a self-referencing sibling (code review F-01, NFR-4)', () => {
  it('does not recurse forever, and nests the repeat no further', () => {
    const d = {
      schema: [
        { name: 'Root', properties: [{ name: 'xs', logicalType: 'array', description: 'List of A objects.' }] },
        { name: 'A', logicalType: 'object', properties: [{ name: 'id', logicalType: 'string', required: true }, { name: 'next', logicalType: 'array', description: 'List of A objects.' }] },
      ],
    };
    expect(() => deriveJsonSchema(d)).not.toThrow();
    const xs = deriveJsonSchema(d).properties.xs;
    expect(xs.items?.properties?.id).toEqual({ type: 'string' });
    expect(xs.items?.properties?.next).toEqual({ type: 'array' });
  });

  it('checkCompat terminates on the same shape', () => {
    const d = {
      schema: [
        { name: 'Root', properties: [{ name: 'xs', logicalType: 'array', required: true, description: 'List of A objects.' }] },
        { name: 'A', logicalType: 'object', properties: [{ name: 'next', logicalType: 'array', description: 'List of A objects.' }] },
      ],
    };
    expect(() => checkCompat(d, d)).not.toThrow();
  });
});
