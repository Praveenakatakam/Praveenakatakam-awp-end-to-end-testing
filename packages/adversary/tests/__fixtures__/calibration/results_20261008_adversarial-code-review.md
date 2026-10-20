# Calibration — adversarial-code-review (T-51a · AR-14)

- **Date:** 2026-10-08
- **Skill:** `adversarial-code-review` v0.2. Agents `adversarial-code-blind` → `adversarial-code-reconcile`, model `claude-fable-5-1`.
- **Planted branch:** throwaway worktree `.claude/worktrees/t51a`, branch `calib/t51a-planted`, one commit `d14af00` on `c473e83` titled "refactor(testgen,functest): tidy emitted headers and plan-cache hash inputs". It touches 2 source files and 0 tests. The worktree and branch were removed after the run. The diff is kept at `.adversarial-review/20261008-1341_code_calib-t51a-planted/planted.diff` (git-ignored).
- **Range:** `c473e83...HEAD` · **Run folder:** `.adversarial-review/20261008-1341_code_calib-t51a-planted/`
- **Verdict:** FAIL — Critical · Critical 4 · Major 2 · Minor 1 · posture-dropped 0 · unevidenced 0 · needs decision 2

## Planted defects (answer key, fixed before the run)

| # | Planted | Rule | Expected | Found | Match |
|---|---|---|---|---|---|
| P1 | `testgen/src/emit.ts`: `// Provenance: rendered ${new Date().toISOString()}` in every conformance file | R-88, E-22, NFR-8 | Critical | F-01 Critical (`emit.ts:20`) | ✅ |
| P2 | `testgen/src/emit.ts`: compat type-equality `expect` deleted, so a type mismatch is green | R-84, R-84a | Critical | F-02 Critical (`emit.ts:73-77`), plus the oracle gap that no test runs the emitted compat file | ✅ |
| P3 | `functest/src/ground.ts`: `promptVersion` dropped from the plan-cache hash, so stale plans are reused after a prompt bump | R-119 | Critical | F-03 Critical (`ground.ts:119-129`); it also names the T-33a test that now fails | ✅ |
| bonus | No paired test change for T-19/T-33 | AR-12 paired-test rule | any | Major | ✅ |

**Recall: 3 / 3 planted defects (100%), all at the expected severity, plus the paired-test violation.** No false Critical: the 4th Critical (no test runs the emitted compat assertions) is a real oracle gap that P2 exposed.

## Caveats

1. **Commit title leaked to the blind pass.** The harness's git context showed Pass 1 the commit subject ("tidy emitted headers and plan-cache hash inputs"), and it used that to rank risks. That points at the areas of P1 and P3. Pass 2 legitimately sees the commit, so the effect on the final findings is limited, but the blind pass was not title-blind. Next calibration: give the planted commit a neutral subject.
2. **Small, single-commit diff.** Three defects in a 3-line diff is an easy setting. Recall on a large mixed diff is untested.
3. **No execution.** The worktree had no workspace package links, so Pass 2 could not run Vitest and evidenced everything statically.
4. **Header version.** The raw output reports `version: "0.1"`, which is hard-coded in the `adversarial-code-reconcile` output template, while the skill is v0.2. This is the same defect the test reconcile had until T-56.

## Needs decision raised (not scored)

- The pre-existing alphabetical role assignment in `testgen/src/generate.ts` at `c473e83`. It was correctly identified, and it is fixed in the working tree by D-84 (spec v0.8.0).
- Whether `earsType`/`section` belong in the R-119 hash, given that R-117 feeds them to the model.
