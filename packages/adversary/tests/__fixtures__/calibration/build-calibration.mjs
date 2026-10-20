/**
 * Rebuild the VERBATIM parts of the adversarial calibration set (T-48 · R-145, D-80)
 * from the committed repo artifacts. Hand-written seeds (seed.json files, the
 * reconstructed TaskPublished contracts, answer-key.json) are NOT touched.
 *
 *   node packages/adversary/tests/__fixtures__/calibration/build-calibration.mjs
 *
 * Re-run only to refresh the frozen copies on purpose: the seeds are a snapshot
 * of the defects present on 2026-10-06, and the answer key assumes them.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..', '..', '..');
const out = (...p) => join(here, ...p);
const src = (...p) => join(repo, ...p);
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));
const write = (p, v) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(v, null, 2) + '\n');
};
const copy = (from, to) => {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
};

// Real ODCS contract (publisher side of the org pair).
copy(src('packages/core/tests/__fixtures__/valid-org.odcs.yaml'), out('contracts', 'org.publisher.odcs.yaml'));

// S01–S03: the committed CRE-R-24 functional plan + emitted file, verbatim.
// `.txt` so neither vitest nor tsc ever collects the frozen generated test.
const functional = json(src('generated-tests/functional/manifest.json'));
write(out('functional', 'S01-03-committed-cre-r-24', 'plan.v1.json'), functional.plans[0]);
copy(
  src('generated-tests/functional/cre-r-24-taskpublished.generated.test.ts'),
  out('functional', 'S01-03-committed-cre-r-24', 'file.generated.test.ts.txt')
);

// S07: the committed get-ready/TaskPublished conformance entry + emitted file, verbatim.
const manifest = json(src('generated-tests/manifest.json'));
write(
  out('testgen', 'S07-conformance-empty', 'manifest-entry.json'),
  manifest.tests.find((t) => t.kind === 'conformance' && t.entity === 'TaskPublished')
);
copy(
  src('generated-tests/conformance/get-ready.TaskPublished.generated.test.ts'),
  out('testgen', 'S07-conformance-empty', 'file.generated.test.ts.txt')
);

// The committed TaskPublished compat entry — the evidence the reconstructed contracts are built from.
write(
  out('contracts', 'taskpublished.compat-evidence.json'),
  manifest.tests.find((t) => t.kind === 'compat' && t.entity === 'TaskPublished')
);

console.log('calibration verbatim copies refreshed under', here);
