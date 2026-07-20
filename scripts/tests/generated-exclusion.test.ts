import { describe, it, expect } from "vitest";
import vitestConfig from "../../vitest.config.js";

/**
 * T-25a · R-93 · AC-93 — the generated tests (generated-tests/**) must never be
 * collected by the registry's own unit suites; they depend on the live apps and
 * are the future runner's concern (D-29).
 */
describe("generated-tests exclusion (T-25 · R-93)", () => {
  const test = (vitestConfig as any).test;

  it("excludes generated-tests/** from the offline suite", () => {
    expect(test.exclude).toContain("generated-tests/**");
  });

  it("no include glob reaches a root-level generated-tests file", () => {
    // include globs are all rooted at packages/ · stacks/ · scripts/ — never generated-tests/.
    for (const glob of test.include as string[]) {
      expect(glob.startsWith("generated-tests")).toBe(false);
    }
    const sample = "generated-tests/conformance/publisher.org.generated.test.ts";
    // Belt-and-suspenders: the sample path is not under any included root.
    const roots = (test.include as string[]).map((g) => g.split("/")[0]);
    expect(roots).not.toContain("generated-tests");
    expect(sample.startsWith("generated-tests/")).toBe(true);
  });
});
