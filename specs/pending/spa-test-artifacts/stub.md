# SPA: Test Artifacts View

**Status:** Pending — idea, not yet initiated

## Problem

Generation runs and generated test artifacts are completely invisible in the SPA today. The only way to see them is via the CLI (`--pull`) or directly in S3/DDB. There is no UI to trigger generation, monitor a run, inspect plans, or compare runs.

## Proposed surface

A fourth toggle in the nav alongside By entity / By source / Requirements:

**Generation runs list** (all users, reader+):
- Run history: runId, status, started, duration, plan count, skip count, baseline badge
- Writer: "Generate tests" button → triggers `POST /generate-functional-tests`, polls status inline (same pattern as the existing Refresh button)

**Run detail**:
- Per-requirement plan: trigger, steps, assertions
- Skip list with reasons
- Step audit trail (once [generation-run-audit](../generation-run-audit/stub.md) lands): per-step model, prompt version, cache hit, tokens, duration
- Download manifest JSON

**Baseline comparison** (follow-on, depends on generation-run-audit):
- Select two runs → per-requirement diff: plan unchanged / changed / new / dropped

## Questions to resolve before initiating

- Should generation be triggerable from the SPA, or read-only (CLI-only trigger)?
- Does the step audit trail belong in v1 of this view or as a follow-on once the audit spec is implemented?
- Should non-functional (compat/conformance) artifact runs have their own view, or share this one?

## Related

- [pending/generation-run-audit](../generation-run-audit/stub.md) — run + step records this view reads
- [pending/configurable-llm-pipeline](../configurable-llm-pipeline/stub.md) — pipeline + prompt CRUD UI (separate view, same SPA)
- [active/odcs-contract-registry/requirements.md](../../active/odcs-contract-registry/requirements.md) §3.9, §3.11 — existing generation endpoints this surfaces
