import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import yaml from 'js-yaml';
import { ENTITY_FLOWS, resolveRoles, type EntityFlows } from '../src/api-map.js';
import { flattenContractProperties, normalizeContractSchema } from '../src/schema-model.js';
import { diffContracts } from '../src/diff.js';

const here = dirname(fileURLToPath(import.meta.url));
const org = yaml.load(readFileSync(resolve(here, '__fixtures__/valid-org.odcs.yaml'), 'utf8'));

describe('ENTITY_FLOWS + resolveRoles (T-52 · R-84b, D-84)', () => {
  it('declares TaskPublished as create → get-ready with NO field map (D-85, live contracts 2026-10-09)', () => {
    // The live get-ready contract sources every field from the same-named create field
    // (transformSourceObjects), so no rename is declared.
    expect(ENTITY_FLOWS.TaskPublished).toEqual({ publisher: 'create', consumer: 'get-ready' });
    expect(resolveRoles('TaskPublished', ['create', 'get-ready'])?.fields).toEqual({});
  });

  it('1. a declared flow wins, whatever the label order', () => {
    const flows: EntityFlows = { TaskPublished: { publisher: 'create', consumer: 'get-ready', fields: { taskId: 'id' } } };
    expect(resolveRoles('TaskPublished', ['get-ready', 'create'], flows)).toEqual({
      publisher: 'create',
      consumer: 'get-ready',
      fields: { taskId: 'id' },
    });
  });

  it('a declared flow can name the alphabetically-later source as publisher', () => {
    const flows: EntityFlows = { Score: { publisher: 'score', consumer: 'deliver' } };
    expect(resolveRoles('Score', ['deliver', 'score'], flows)).toEqual({ publisher: 'score', consumer: 'deliver', fields: {} });
  });

  it('a declared flow selects its pair out of three or more sources', () => {
    const flows: EntityFlows = { Event: { publisher: 'score', consumer: 'create' } };
    expect(resolveRoles('Event', ['create', 'deliver', 'score'], flows)).toMatchObject({ publisher: 'score', consumer: 'create' });
  });

  it('2. with no declared flow, literal publisher/consumer labels are the roles (D-60)', () => {
    expect(resolveRoles('org', ['consumer', 'publisher'], {})).toEqual({ publisher: 'publisher', consumer: 'consumer', fields: {} });
  });

  it('3. otherwise undefined — never alphabetical (E-59)', () => {
    expect(resolveRoles('widget', ['deliver', 'score'], {})).toBeUndefined();
    expect(resolveRoles('widget', ['publisher'], {})).toBeUndefined();
    expect(resolveRoles('widget', ['consumer', 'other', 'publisher'], {})).toBeUndefined();
  });

  it('a declared flow whose source does not carry the entity is treated as undeclared', () => {
    const flows: EntityFlows = { TaskPublished: { publisher: 'create', consumer: 'get-ready' } };
    expect(resolveRoles('TaskPublished', ['create', 'deliver'], flows)).toBeUndefined();
  });

  it('defaults to ENTITY_FLOWS', () => {
    expect(resolveRoles('TaskPublished', ['get-ready', 'create'])).toMatchObject({ publisher: 'create', consumer: 'get-ready' });
  });
});

describe('flattenContractProperties (T-52 · R-84d, D-86)', () => {
  const nested = {
    schema: [
      {
        name: 'TaskPublished',
        properties: [
          { name: 'taskId', logicalType: 'string', required: true },
          {
            name: 'items',
            logicalType: 'array',
            required: true,
            items: { logicalType: 'object', properties: [{ name: 'itemId', logicalType: 'string', required: true }, { name: 'label', logicalType: 'string' }] },
          },
          {
            name: 'meta',
            logicalType: 'object',
            required: false,
            properties: [{ name: 'note', logicalType: 'string', required: true }],
          },
        ],
      },
    ],
  };

  it('yields dotted paths for object properties and array items, sorted', () => {
    expect(flattenContractProperties(nested).map((p) => p.name)).toEqual([
      'items',
      'items[].itemId',
      'items[].label',
      'meta',
      'meta.note',
      'taskId',
    ]);
  });

  it('a nested property is required only when it and every ancestor are required', () => {
    const byName = new Map(flattenContractProperties(nested).map((p) => [p.name, p]));
    expect(byName.get('items[].itemId')).toMatchObject({ required: true, logicalType: 'string' });
    expect(byName.get('items[].label')?.required).toBe(false);
    expect(byName.get('meta.note')?.required).toBe(false); // ancestor `meta` is optional
  });

  it('matches normalizeContractSchema exactly on a flat contract', () => {
    const flat = flattenContractProperties(org);
    const top = [...normalizeContractSchema(org).props.values()].sort((a, b) => (a.name < b.name ? -1 : 1));
    expect(flat).toEqual(top);
  });

  it('tolerates malformed input', () => {
    expect(flattenContractProperties(undefined)).toEqual([]);
    expect(flattenContractProperties({ schema: [{ properties: [{ name: 'a', items: 'nope', properties: 7 }] }] }).map((p) => p.name)).toEqual(['a']);
  });

  it('the semantic differ keeps its top-level model (a nested-only change is not a property change)', () => {
    const changed = structuredClone(nested);
    (changed.schema[0].properties[1] as any).items.properties[0].logicalType = 'integer';
    const d = diffContracts(nested, changed);
    expect(JSON.stringify(d)).not.toContain('itemId');
  });
});

describe('nullable properties (T-59a · F-02/F-06, ODCS customProperties)', () => {
  const doc = {
    schema: [{ name: 'T', properties: [
      { name: 'duration', logicalType: 'integer', customProperties: [{ property: 'nullable', value: 'true' }] },
      { name: 'title', logicalType: 'string', required: true },
    ] }],
  };
  it('marks a property nullable from customProperties nullable="true", and leaves others unset', () => {
    const byName = new Map(flattenContractProperties(doc).map((p) => [p.name, p]));
    expect(byName.get('duration')?.nullable).toBe(true);
    expect('nullable' in byName.get('title')!).toBe(false);
    expect(normalizeContractSchema(doc).props.get('duration')?.nullable).toBe(true);
  });
});
