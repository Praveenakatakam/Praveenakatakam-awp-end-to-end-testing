# Red run — T-47a-handoff

- **Recorded:** 2026-10-08T15:22:23.618Z
- **Command:** `npx vitest run scripts/tests/generate-tests.adversarial.test.ts`
- **Result:** 3 failed, 7 passed

| Failing test | First failure line |
|---|---|
| runCli (R-144, D-34) › default mode: one report per §3.9 run and per functional job, both verdicts before the reminder | AssertionError: expected [] to deeply equal [ …(5) ] |
| runCli (R-144, D-34) › --local: the handoff block names the local run and no functional job | AssertionError: expected [] to deeply equal [ …(5) ] |
| runCli (R-144, D-34) › paths inside the repo are printed repo-relative (what the skill expects by default) | AssertionError: expected 'C:\awp-end-to-end-testing\generated-t…' to be 'generated-tests' // Object.is equality |
