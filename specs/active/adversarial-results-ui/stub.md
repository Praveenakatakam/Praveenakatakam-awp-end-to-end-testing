# Adversarial Results UI

**Status:** Pending — idea, not yet initiated  
**Captured:** 2026-10-21

## Problem

The adversarial review agents (`adversarial-test-review` and `adversarial-code-review`) produce structured JSON findings (`review.raw.json`, `verification.json`) and a final `review.md` report, but there is no visual surface for these results. Consumers must read raw JSON or markdown files to understand findings, filter by severity, or compare runs. There is no way to see test-review and code-review results side by side or track changes across runs.

## Proposed approach

Add a new **Adversarial Results** tab to the existing SPA (within `odcs-contract-registry`). The tab exposes two sub-views — one for test-review runs, one for code-review runs — each rendering findings in a filterable, sortable table.

### Table columns (both views)

| Column | Source field |
|---|---|
| ID | `finding.id` (e.g. F-01) |
| Severity | `finding.severity` (Blocker / High Risk / Clarification) |
| Verdict | `verification.json` — CONFIRMED / REFUTED / UNCLEAR |
| File / Requirement | `finding.location` (file path or R-nn reference) |
| Summary | `finding.summary` (one-line description) |
| Run | run timestamp + git range or slug |

### Interactions

- Filter chips: Blocker / High Risk / Clarification; CONFIRMED / REFUTED / UNCLEAR
- Sort by any column
- Click a row → detail drawer: full finding text, adversarial scenario, proposed fix, raw JSON
- Run selector: dropdown to switch between historical runs for the same target

### Data source

Reads from the existing S3 run directory structure:  
`adversarial-runs/<kind>/<run_dir>/review.raw.json` and `verification.json`

A new API route (reader-group-gated) lists runs and fetches findings for a selected run.

### Access control

Reader Cognito group can view. Writer group can trigger a new run from the UI (calls the existing adversarial review entry point).

## Questions to resolve before initiating

- Should test-review and code-review share one table with a kind filter, or be separate tabs?
- Is there a run-comparison view needed (diff findings between two runs on same target)?
- What is the S3 key structure for adversarial run output — does it already follow a consistent convention, or does it need standardising first?
- Should the "trigger run" button be in scope for v1 or deferred?
- Does the SPA already have a drawer/panel component, or does one need to be built?

## Related

- [active/odcs-contract-registry](../../active/odcs-contract-registry/stub.md) — the SPA this extends
- [specs/docs/sdd/subagents.md](../../docs/sdd/subagents.md) — adversarial agent pipeline (Stages 4 + 6)
- `.claude/agents/adversarial-test-blind.md`, `adversarial-code-blind.md` — the agents whose output this surfaces
- `.claude/agents/adversarial-finding-verify.md` — produces `verification.json` consumed by this UI
