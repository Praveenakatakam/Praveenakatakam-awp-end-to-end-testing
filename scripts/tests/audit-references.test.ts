/**
 * The reference audit must itself be trustworthy: it has to flag a fabricated citation and not flag a
 * real one. Uses real files from this repo as the "real" side and invented ones as the "fabricated" side.
 */
import { describe, it, expect } from 'vitest';
import { checkEvidence, idsIn, pathsIn, snippetsIn, specIds } from '../audit-references.js';

const known = specIds();
const check = (target: string, evidence = '') => checkEvidence('t', target, evidence, known);

describe('extraction', () => {
  it('reads spec ids but not the tail of a domain-prefixed requirement id', () => {
    expect(idsIn('see R-133a, D-84, NFR-4, E-61 and awp-app-plane/CRE-R-24')).toEqual(['R-133a', 'D-84', 'NFR-4', 'E-61']);
  });

  it('reads an id written in bold, but not a family such as AC-16*', () => {
    expect(idsIn('**AR-03** — every finding; and AC-16*, AC-56')).toEqual(['AR-03', 'AC-56']);
  });

  it('reads path, path:line and path:from-to', () => {
    expect(pathsIn('packages/core/src/compare.ts:12 and scripts/adversary-exec.ts:3-9, plus specs/README.md')).toEqual([
      { path: 'packages/core/src/compare.ts', from: 12, to: undefined },
      { path: 'scripts/adversary-exec.ts', from: 3, to: 9 },
      { path: 'specs/README.md', from: undefined, to: undefined },
    ]);
  });

  it('reads long quoted snippets only', () => {
    expect(snippetsIn('"short" and `a long enough snippet` and "another long enough one"')).toEqual(['a long enough snippet', 'another long enough one']);
  });
});

describe('a real citation passes', () => {
  it('an existing file, an in-range line, a real quote, a defined rule id', () => {
    expect(check('packages/core/src/compare.ts:10', 'compareCodePoint is `export function compareCodePoint(a: string, b: string)`; R-88')).toEqual([]);
  });

  it('a line range inside the file', () => {
    expect(check('packages/core/src/compare.ts:10-20')).toEqual([]);
  });
});

describe('a fabricated citation is caught', () => {
  it('a file that does not exist', () => {
    expect(check('packages/core/src/does-not-exist.ts:5').map((i) => `${i.severity}: ${i.problem}`)).toEqual(['hard: file does not exist']);
  });

  it('a line beyond the end of a real file', () => {
    const [i] = check('packages/core/src/compare.ts:99999');
    expect(i.problem).toMatch(/line out of range \(file has \d+ lines\)/);
  });

  it('a quote that is not in the cited file', () => {
    const issues = check('packages/core/src/compare.ts:10', 'it does `return localeCompare(a, b, locale)` here');
    expect(issues.map((i) => `${i.severity}: ${i.problem}`)).toEqual(['hard: quoted text not found anywhere in the repo']);
  });

  it('a quote that is nowhere in the repo, when no file is cited', () => {
    const issues = check('', 'the code says `thisIdentifierWasInventedByAnAgent(42)`');
    expect(issues.map((i) => `${i.severity}: ${i.problem}`)).toEqual(['hard: quoted text not found anywhere in the repo']);
  });

  it('a rule id the spec never defines', () => {
    expect(check('', 'violates R-9999').map((i) => `${i.severity} ${i.ref}: ${i.problem}`)).toEqual(['hard R-9999: rule id is not defined in specs/']);
  });

  it('reports each problem separately', () => {
    expect(check('packages/nope.ts:1', 'R-9998 and `an invented quotation here`')).toHaveLength(3);
  });
});

describe('imprecise but real references are soft, not fabrications', () => {
  it('a real quote cited against the wrong file is soft and names where it is', () => {
    const [i] = check('packages/core/src/compare.ts:10', 'quoting `export function apiTarget(source: string, entity: string)`');
    expect(i.severity).toBe('soft');
    expect(i.problem).toBe('found in packages/core/src/api-map.ts, not in the cited file(s)');
  });

  it('a sub-clause id whose parent is defined is soft: R-134d is clause (d) of R-134', () => {
    const [i] = check('', 'covered by R-134d');
    expect(i.severity).toBe('soft');
    expect(i.problem).toMatch(/sub-clause shorthand: R-134 is defined/);
  });

  it('a sub-clause id whose parent is NOT defined is hard', () => {
    expect(check('', 'R-8888z').map((i) => i.severity)).toEqual(['hard']);
  });

  it('a quotation with an ellipsis is checked piece by piece', () => {
    expect(check('packages/core/src/compare.ts:10', '`export function compareCodePoint(…) { … }`')).toEqual([]);
    const issues = check('packages/core/src/compare.ts:10', '`export function compareCodePoint(…) invented-tail-text`');
    expect(issues.map((i) => i.severity)).toEqual(['hard']);
  });

  it('a file path inside backticks is a path reference, not a quotation', () => {
    expect(check('', 'see `packages/core/src/compare.ts:12` and `ls docs/red-runs`')).toEqual([]);
  });
});

describe('tool output is not mistaken for code', () => {
  it('numeric and arrow-only quotations are skipped', () => {
    expect(check('packages/core/src/compare.ts:10', 'count `159 + 7 + 2 = 168` and `→ 2 → 3`')).toEqual([]);
  });

  it('whitespace differences do not matter', () => {
    expect(check('packages/core/src/compare.ts:10', '`export function  compareCodePoint(a: string,\n b: string)`')).toEqual([]);
  });
});
