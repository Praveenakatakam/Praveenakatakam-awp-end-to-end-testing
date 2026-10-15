/**
 * Tests for the selectRequirements sampling-strategy helper (T-08a).
 *
 * All four strategies are pure logic with no AWS calls — this is a [gen-unit]
 * tier test (packages/core, no infrastructure dependencies).
 *
 * Requirements: R-47, R-48, R-49, R-50
 */

import { describe, it, expect } from 'vitest';
import { selectRequirements } from '../src/pipeline.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate N requirement IDs of the form "PREFIX-NNN" (zero-padded to 3 digits). */
function makeIds(n: number, prefix = 'R'): string[] {
  return Array.from({ length: n }, (_, i) => `${prefix}-${String(i + 1).padStart(3, '0')}`);
}

// ---------------------------------------------------------------------------
// first_n strategy (R-48)
// ---------------------------------------------------------------------------

describe('selectRequirements — first_n (R-48)', () => {
  it('returns the first N IDs sorted lexicographically', () => {
    // GIVEN an unsorted list of 5 IDs
    const ids = ['R-05', 'R-01', 'R-03', 'R-02', 'R-04'];

    // WHEN selecting first 3
    const result = selectRequirements(ids, { strategy: 'first_n', n: 3 });

    // THEN the three smallest lex IDs are returned in sorted order
    expect(result).toEqual(['R-01', 'R-02', 'R-03']);
  });

  it('n=0 returns an empty array', () => {
    // GIVEN
    const ids = ['R-01', 'R-02'];

    // WHEN selecting 0
    const result = selectRequirements(ids, { strategy: 'first_n', n: 0 });

    // THEN
    expect(result).toEqual([]);
  });

  it('n > total returns all IDs sorted', () => {
    // GIVEN 3 IDs in reverse order
    const ids = ['R-03', 'R-01', 'R-02'];

    // WHEN n exceeds total
    const result = selectRequirements(ids, { strategy: 'first_n', n: 100 });

    // THEN all IDs are returned, sorted
    expect(result).toEqual(['R-01', 'R-02', 'R-03']);
  });

  it('does not mutate the source array', () => {
    // GIVEN an unsorted source array
    const ids = ['R-03', 'R-01', 'R-02'];
    const copy = [...ids];

    // WHEN selecting
    selectRequirements(ids, { strategy: 'first_n', n: 2 });

    // THEN the source is unchanged
    expect(ids).toEqual(copy);
  });
});

// ---------------------------------------------------------------------------
// percentage strategy (R-48 — SHA-256 hash of ID mod 100 < percentage)
// ---------------------------------------------------------------------------

describe('selectRequirements — percentage (R-48)', () => {
  it('is deterministic — same inputs produce the same subset on every call', () => {
    // GIVEN 100 IDs
    const ids = makeIds(100);

    // WHEN called twice with the same percentage
    const first = selectRequirements(ids, { strategy: 'percentage', percentage: 50 });
    const second = selectRequirements(ids, { strategy: 'percentage', percentage: 50 });

    // THEN both results are identical
    expect(first).toEqual(second);
  });

  it('0% returns an empty array', () => {
    // GIVEN
    const ids = makeIds(50);

    // WHEN percentage = 0
    const result = selectRequirements(ids, { strategy: 'percentage', percentage: 0 });

    // THEN nothing is selected
    expect(result).toEqual([]);
  });

  it('100% returns all IDs (sorted)', () => {
    // GIVEN 20 IDs in arbitrary (reversed) order
    const ids = [...makeIds(20)].reverse();

    // WHEN percentage = 100
    const result = selectRequirements(ids, { strategy: 'percentage', percentage: 100 });

    // THEN all IDs are returned (sorted)
    const sorted = [...ids].sort();
    expect(result).toEqual(sorted);
    expect(result.length).toBe(20);
  });

  it('50% on a large set selects a non-empty, non-complete subset', () => {
    // GIVEN 120 IDs — large enough that 50% hash-sampling cannot accidentally
    // return 0 or all 120 with any reasonable hash distribution
    const ids = makeIds(120);

    // WHEN percentage = 50
    const result = selectRequirements(ids, { strategy: 'percentage', percentage: 50 });

    // THEN the count is somewhere in the middle — wide tolerance prevents
    // flakiness while verifying the strategy does meaningful filtering
    expect(result.length).toBeGreaterThan(20);
    expect(result.length).toBeLessThan(100);
  });

  it('result is sorted regardless of input order', () => {
    // GIVEN IDs in reverse order
    const ids = makeIds(30).reverse();

    // WHEN applying percentage sampling
    const result = selectRequirements(ids, { strategy: 'percentage', percentage: 40 });

    // THEN the subset is in lexicographic order
    expect(result).toEqual([...result].sort());
  });
});

// ---------------------------------------------------------------------------
// ids strategy (R-48)
// ---------------------------------------------------------------------------

describe('selectRequirements — ids (R-48)', () => {
  it('returns only IDs present in both the pool and the sampling.ids list, sorted', () => {
    // GIVEN a pool of 5 IDs; sampling requests 2 present ones plus one absent
    const ids = ['R-05', 'R-01', 'R-03', 'R-02', 'R-04'];
    const selectedIds = ['R-03', 'R-01', 'R-MISSING'];

    // WHEN applying ids strategy
    const result = selectRequirements(ids, { strategy: 'ids', ids: selectedIds });

    // THEN only the matched IDs appear, sorted, with the absent ID excluded
    expect(result).toEqual(['R-01', 'R-03']);
  });

  it('IDs in sampling.ids that are absent from the pool are silently excluded', () => {
    // GIVEN sampling.ids contains IDs entirely absent from the pool
    const ids = ['R-01', 'R-02'];
    const result = selectRequirements(ids, { strategy: 'ids', ids: ['R-GHOST-1', 'R-GHOST-2'] });

    // THEN nothing is selected
    expect(result).toEqual([]);
  });

  it('extra IDs in sampling.ids beyond the pool are ignored without error', () => {
    // GIVEN sampling.ids has many more IDs than the pool contains
    const ids = ['R-01', 'R-02', 'R-03'];
    const samplingIds = [...ids, ...makeIds(20, 'X')];

    // WHEN
    const result = selectRequirements(ids, { strategy: 'ids', ids: samplingIds });

    // THEN only the pool members are returned
    expect(result).toEqual(['R-01', 'R-02', 'R-03']);
  });

  it('returns results in sorted order regardless of sampling.ids order', () => {
    // GIVEN sampling.ids in reverse order
    const ids = ['R-01', 'R-02', 'R-03', 'R-04'];
    const result = selectRequirements(ids, { strategy: 'ids', ids: ['R-04', 'R-02'] });

    // THEN sorted
    expect(result).toEqual(['R-02', 'R-04']);
  });
});

// ---------------------------------------------------------------------------
// all strategy (R-48)
// ---------------------------------------------------------------------------

describe('selectRequirements — all (R-48)', () => {
  it('returns all IDs in a sorted copy', () => {
    // GIVEN IDs in unsorted order
    const ids = ['R-05', 'R-03', 'R-01', 'R-04', 'R-02'];

    // WHEN selecting all
    const result = selectRequirements(ids, { strategy: 'all' });

    // THEN all IDs returned sorted
    expect(result).toEqual(['R-01', 'R-02', 'R-03', 'R-04', 'R-05']);
  });

  it('empty input returns empty array', () => {
    // GIVEN no IDs in pool
    const result = selectRequirements([], { strategy: 'all' });

    // THEN
    expect(result).toEqual([]);
  });

  it('does not mutate the source array', () => {
    // GIVEN an unsorted source
    const ids = ['R-03', 'R-01', 'R-02'];
    const copy = [...ids];

    // WHEN
    selectRequirements(ids, { strategy: 'all' });

    // THEN source unchanged
    expect(ids).toEqual(copy);
  });
});
