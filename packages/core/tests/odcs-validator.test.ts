import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseAndValidate } from '../src/odcs-validator.js';

const here = dirname(fileURLToPath(import.meta.url));
const validOrg = readFileSync(resolve(here, '__fixtures__/valid-org.odcs.yaml'), 'utf8');
const validApiContract = readFileSync(resolve(here, '__fixtures__/valid-trpc-api.odcs.yaml'), 'utf8');
const validEventContract = readFileSync(resolve(here, '__fixtures__/valid-eventbridge.odcs.yaml'), 'utf8');

describe('parseAndValidate (T-02 · R-20, R-21)', () => {
  // AC-20: a real ODCS v3.1.0 contract validates.
  it('accepts a valid ODCS v3.1.0 contract', () => {
    const r = parseAndValidate(validOrg);
    expect(r.validation).toBe('valid');
    expect(r.errors).toEqual([]);
    expect((r.parsed as any).kind).toBe('DataContract');
    expect((r.parsed as any).apiVersion).toBe('v3.1.0');
  });

  // AC-21a: not-valid YAML → invalid with a parse error, never throws.
  it('flags non-YAML input as invalid with a parse error', () => {
    const r = parseAndValidate(':\n  - this is not: valid: yaml: at all\n\t bad tab');
    expect(r.validation).toBe('invalid');
    expect(r.parsed).toBeUndefined();
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors[0].keyword).toBe('parse');
  });

  it('accepts a valid tRPC API contract', () => {
    const r = parseAndValidate(validApiContract);
    expect(r.validation).toBe('valid');
    expect(r.errors).toEqual([]);
    expect((r.parsed as any).kind).toBe('DataContract');
    expect((r.parsed as any).apiVersion).toBe('v3.1.0');
  });

  it('accepts a valid EventBridge event contract', () => {
    const r = parseAndValidate(validEventContract);
    expect(r.validation).toBe('valid');
    expect(r.errors).toEqual([]);
    expect((r.parsed as any).kind).toBe('DataContract');
    expect((r.parsed as any).apiVersion).toBe('v3.1.0');
  });

  // AC-21b: parses as YAML but fails the ODCS schema → invalid with failing paths.
  it('flags a schema-violating contract as invalid, listing the failing rule', () => {
    const missingKind = ['version: 1.0.0', 'apiVersion: v3.1.0', 'id: 123-abc', 'status: active', 'name: No Kind Here'].join('\n');
    const r = parseAndValidate(missingKind);
    expect(r.validation).toBe('invalid');
    // The ODCS meta-schema requires `kind`.
    const kindError = r.errors.find((e) => e.keyword === 'required' && /kind/.test(e.message));
    expect(kindError).toBeTruthy();
  });
});
