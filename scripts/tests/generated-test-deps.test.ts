/**
 * Code review F-08 (run 20261014-1309): a generated conformance test lives under `generated-tests/` at
 * the repo root and imports `ajv` and `ajv-formats`. They must be declared in the ROOT package.json, or
 * the future runner (R-93) fails to resolve them even though every package-level test is green.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const rootPkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const declared = { ...rootPkg.dependencies, ...rootPkg.devDependencies };

/** Bare module specifiers imported by the committed generated tests. */
function importedPackages(dir: string): Set<string> {
  const found = new Set<string>();
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.generated.test.ts')) {
        for (const m of readFileSync(p, 'utf8').matchAll(/^import\s.*?from\s+"([^".][^"]*)";?$/gm)) found.add(m[1].split('/').slice(0, m[1].startsWith('@') ? 2 : 1).join('/'));
      }
    }
  };
  walk(dir);
  return found;
}

describe('the root package declares what generated tests import (code review F-08)', () => {
  it('declares ajv and ajv-formats', () => {
    expect(declared.ajv).toBeDefined();
    expect(declared['ajv-formats']).toBeDefined();
  });

  it('declares every package the committed generated tests import', () => {
    const imports = importedPackages(join(ROOT, 'generated-tests'));
    expect(imports.has('vitest')).toBe(true);
    for (const pkg of imports) expect(declared[pkg], `${pkg} is imported by a generated test but not declared in the root package.json`).toBeDefined();
  });
});
