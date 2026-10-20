/**
 * The EXECUTED mutation tier (T-47 · R-135, D-71): run the emitted §3.9 compat
 * test files for real, under Vitest, against mutated catalogs — so a defect in
 * the EMITTER (not just the manifest logic) is caught too.
 *
 * Narrow by design (§2 amendment): only compat files — pure, no live app — and
 * only offline, in a temp dir. One Vitest child process per batch: every case's
 * file is written side by side, run once with the JSON reporter, and mapped back
 * by file name. The temp dir lives inside the repo (git-ignored
 * `.adversarial-tmp/`) so the emitted `import ... from "vitest"` resolves to the
 * repo's own node_modules; it is removed after every batch.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { generateArtifacts } from '@registry/testgen';
import type { BatchEvaluator, CompatOutcome } from '@registry/adversary';
import type { EntityFlows } from '@registry/core';

const require = createRequire(import.meta.url);

/** Absolute path of the vitest CLI entry, resolved from this repo's install. */
function vitestBin(): string {
  return join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
}

interface VitestJson {
  testResults?: { name: string; status: string }[];
}

/** `flows` feeds the generator under test (default: the declared `ENTITY_FLOWS`); seed 6 passes a mis-declared one. */
export function createExecutedBatchEvaluator(opts: { workDir: string; flows?: EntityFlows }): BatchEvaluator {
  return async (cases) => {
    const outcomes: CompatOutcome[] = new Array(cases.length);
    rmSync(opts.workDir, { recursive: true, force: true });
    mkdirSync(opts.workDir, { recursive: true });
    try {
      const written = new Map<string, number>();
      cases.forEach((c, i) => {
        const file = generateArtifacts(c.catalog, opts.flows).files.find((f) => f.path === `compat/${c.entity}.generated.test.ts`);
        if (!file) {
          outcomes[i] = 'absent';
          return;
        }
        const name = `case-${String(i).padStart(4, '0')}.generated.test.ts`;
        writeFileSync(join(opts.workDir, name), file.contents);
        written.set(name, i);
      });
      if (written.size === 0) return outcomes;

      const config = join(opts.workDir, 'vitest.config.mjs');
      writeFileSync(config, "export default { test: { include: ['*.generated.test.ts'], watch: false } };\n");
      const results = join(opts.workDir, 'results.json');
      // The parent may itself be a Vitest worker; drop its VITEST* markers so the child runs standalone.
      const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('VITEST')));
      spawnSync(
        process.execPath,
        [vitestBin(), 'run', '--config', config, '--root', opts.workDir, '--reporter=json', `--outputFile=${results}`],
        { cwd: opts.workDir, env, stdio: 'ignore', timeout: 300_000 }
      );
      if (!existsSync(results)) throw new Error('executed tier: vitest produced no results (is vitest installed?)');

      const report = JSON.parse(readFileSync(results, 'utf8')) as VitestJson;
      for (const r of report.testResults ?? []) {
        const i = written.get(basename(r.name.replace(/\\/g, '/')));
        if (i !== undefined) outcomes[i] = r.status === 'passed' ? 'green' : 'red';
      }
      for (const [name, i] of written) {
        if (outcomes[i] === undefined) throw new Error(`executed tier: no vitest result for ${name}`);
      }
      return outcomes;
    } finally {
      rmSync(opts.workDir, { recursive: true, force: true });
    }
  };
}
