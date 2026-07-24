import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import yaml from 'js-yaml';
import { normalizeContractSchema, enumValues } from '../src/schema-model.js';

const here = dirname(fileURLToPath(import.meta.url));
const org = yaml.load(readFileSync(resolve(here, '__fixtures__/valid-org.odcs.yaml'), 'utf8'));

describe('normalizeContractSchema (T-18 · R-84a — shared with diff.ts)', () => {
  it('keys properties by name and records required/logicalType/physicalType', () => {
    const { entity, props } = normalizeContractSchema(org);
    expect(entity).toBe('org');
    const sourcedId = props.get('sourcedId');
    expect(sourcedId).toMatchObject({ required: true, logicalType: 'string', physicalType: 'S' });
    expect(props.get('identifier')?.required).toBe(false);
  });

  it("derives enum validValues from a property's data-quality rules", () => {
    const { props } = normalizeContractSchema(org);
    expect(props.get('status')?.validValues).toEqual(['active', 'tobedeleted']);
    expect(props.get('type')?.validValues).toEqual(['department', 'school', 'district', 'local', 'state', 'national']);
    // A property with no enum rule has undefined validValues.
    expect(props.get('name')?.validValues).toBeUndefined();
  });

  it('is order-independent and tolerant of malformed input', () => {
    const a = normalizeContractSchema({ schema: [{ name: 'x', properties: [{ name: 'b' }, { name: 'a' }] }] });
    const b = normalizeContractSchema({ schema: [{ name: 'x', properties: [{ name: 'a' }, { name: 'b' }] }] });
    expect([...a.props.keys()].sort()).toEqual([...b.props.keys()].sort());
    // Malformed docs normalise to an empty model, never throw.
    expect(normalizeContractSchema(undefined)).toEqual({ entity: '', props: new Map() });
    expect(normalizeContractSchema({ schema: [] }).props.size).toBe(0);
  });

  it('enumValues reads arguments.validValues from any library rule', () => {
    expect(enumValues({ quality: [{ arguments: { validValues: [1, 2] } }] })).toEqual([1, 2]);
    expect(enumValues({ quality: [] })).toBeUndefined();
    expect(enumValues({})).toBeUndefined();
  });
});
