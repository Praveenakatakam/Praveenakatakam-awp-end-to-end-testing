import { defineConfig } from "vitest/config";

// Backend suite (node). The web package (packages/web) has its own jsdom-based
// vitest config and is excluded here; run it via `npm run test:web`.
export default defineConfig({
  test: {
    // Stub SST resource bindings (sst/node/*) so the offline suite resolves
    // table/bucket/config values without AWS. Runs before any source import.
    setupFiles: ["./vitest.setup.ts"],
    include: ["packages/**/*.test.ts", "stacks/**/*.test.ts", "scripts/**/*.test.ts"],
    // Generated tests (generated-tests/**) depend on the live apps and are the
    // future runner's concern (R-93, D-29) — never collected by the unit suites.
    exclude: ["**/node_modules/**", "packages/web/**", "generated-tests/**"],
    // SST's stack registry (getStack) is process-global, so the synth-based
    // stack tests must not run in parallel across files.
    fileParallelism: false,
  },
});
