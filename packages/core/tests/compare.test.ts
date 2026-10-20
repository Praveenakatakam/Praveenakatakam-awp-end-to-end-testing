import { describe, it, expect } from 'vitest';
import { compareCodePoint, compareNatural } from '../src/compare.js';

describe('compareCodePoint (R-88: no locale)', () => {
  it('orders by code unit, so uppercase sorts before lowercase on every machine', () => {
    expect(['b', 'B', 'a', 'A'].sort(compareCodePoint)).toEqual(['A', 'B', 'a', 'b']);
  });

  it('orders keys that differ only by punctuation or case deterministically', () => {
    const keys = ['conformance.get-ready/urn:b', 'conformance.Get-ready/urn:b', 'conformance.get_ready/urn:b'];
    expect([...keys].sort(compareCodePoint)).toEqual(['conformance.Get-ready/urn:b', 'conformance.get-ready/urn:b', 'conformance.get_ready/urn:b']);
  });

  it('returns -1, 0, 1', () => {
    expect(compareCodePoint('a', 'b')).toBe(-1);
    expect(compareCodePoint('a', 'a')).toBe(0);
    expect(compareCodePoint('b', 'a')).toBe(1);
  });
});

describe('compareNatural (R-88: numeric runs by value, no locale)', () => {
  it('sorts requirement ids numerically', () => {
    expect(['CRE-R-10', 'CRE-R-2', 'CRE-R-1'].sort(compareNatural)).toEqual(['CRE-R-1', 'CRE-R-2', 'CRE-R-10']);
  });

  it('keeps the source prefix as the primary key', () => {
    expect(['jira-awp/BAWP-2', 'awp-app-plane/XCT-R-11', 'awp-app-plane/CRE-R-24'].sort(compareNatural)).toEqual([
      'awp-app-plane/CRE-R-24',
      'awp-app-plane/XCT-R-11',
      'jira-awp/BAWP-2',
    ]);
  });

  it('is a total order: 01 and 1 are distinct and stable', () => {
    expect(compareNatural('R-01', 'R-1')).not.toBe(0);
    expect(compareNatural('R-01', 'R-1')).toBe(-compareNatural('R-1', 'R-01'));
  });

  it('handles numbers beyond Number.MAX_SAFE_INTEGER and shorter prefixes', () => {
    expect(compareNatural('a99999999999999999999', 'a100000000000000000000')).toBe(-1);
    expect(compareNatural('A-1', 'A-1.1')).toBe(-1);
    expect(compareNatural('', 'a')).toBe(-1);
  });

  it('uses code-unit order for non-digit runs (uppercase before lowercase)', () => {
    expect(['a-1', 'B-1'].sort(compareNatural)).toEqual(['B-1', 'a-1']);
  });
});
