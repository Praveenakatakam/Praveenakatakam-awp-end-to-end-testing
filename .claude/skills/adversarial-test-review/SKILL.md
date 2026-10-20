---
name: adversarial-test-review
description: Deeper red-team of the generated end-to-end tests (generated-tests/**) AND the generators that produced them (packages/testgen, packages/functest), after `npm run generate-tests` and before a human reviews `git diff`. Two isolated agent passes (adversarial-test-blind → adversarial-test-reconcile) with the adversarial persona; report only, never edits.
type: skill
version: "0.8"
updated: 2026-10-15
---

# adversarial-test-review — orchestrator

Definitions, the persona, the finding format, posture lint, verdict rule, run-folder layout and guardrails are in `.claude/skills/adversarial-review-spec.md`. **Read it before starting.** This file holds only the workflow.

The **main conversation** runs this file. The two passes are the named agents in `.claude/agents/`:

| Pass | Agent | Tools | Model |
|---|---|---|---|
| 1 (blind) | `adversarial-test-blind` | Read, Grep, Glob, Write (**no shell**) | fable |
| 2 (reconcile) | `adversarial-test-reconcile` | Read, Grep, Glob, Bash (read-only), Write | fable |
| 3 (verify) | `adversarial-finding-verify` | Read, Grep, Glob, Bash (read-only), Write | fable |

The persona, the read/never-read rules and the output format live in the agent definitions. Don't restate or override them in the task message. Run the passes **one after the other, never in parallel** (AR-02), each as a fresh agent. Nothing is ever edited except the run folder (AR-04).

## Inputs

Usually from the `## ADVERSARIAL REVIEW HANDOFF` block that `npm run generate-tests` prints last (the repo `CLAUDE.md` chains it). Otherwise from the user's request.

| Input | From the handoff block | Default (manual run) |
|---|---|---|
| `generated_dir` | `generated_dir:` | `generated-tests` |
| `in_product_reports` | `in_product_reports:` (comma-separated, or `none`) | the newest `adversarial-reports/<id>/report.json`, if any |
| `run` / `functional_job` | `run:` / `functional_job:` | — (used only in the report header) |
| `focus` | — | none (a requirement id, entity or file to look at first) |

## Workflow

### Step 1 — Preflight (main conversation)
1. Confirm `{generated_dir}/manifest.json` exists. If it doesn't, stop: "nothing to review — run `npm run generate-tests` first".
2. Take `in_product_reports` from the handoff block. On a manual run, use the newest `adversarial-reports/<id>/report.json` by folder name, or `none`. Confirm each listed file exists, and drop any that don't (noting that in the final report).
3. Create `run_dir` = `.adversarial-review/{YYYYMMDD-HHMM}_test_{branch}/`. Get the branch from `git branch --show-current`, with `/` replaced by `-`.
4. Blind-safe inputs:
   ```
   npx tsx scripts/adversarial-review-finalize.ts blind-inputs {generated_dir} {run_dir}
   ```
   Keep the JSON output verbatim. The command also snapshots it to `{run_dir}/blind-inputs.json`, so finalize can refuse if the tree changes mid-review (AR-16). Don't regenerate tests until the run is finalized. **Do not read the manifests yourself** before Pass 1 finishes.
5. Optional sources, only when `REGISTRY_API_URL` and `REGISTRY_TOKEN` are set **and** point at a non-prod stage: fetch each contract in the blind-safe inputs with `GET /contracts/{source}/{id}/raw` into `{run_dir}/sources/contracts/{source}__{id}.odcs.yaml`, with `:` replaced by `_`. Fetch the requirement texts with `GET /requirements` into `{run_dir}/sources/requirements.json`. Otherwise `sources` = `none`. The blind agent has no shell, so this is the only way it sees live sources.

### Step 2 — Pass 1: `adversarial-test-blind`
Spawn the agent with `subagent_type: adversarial-test-blind` and a task message of exactly:
```
run_dir: {run_dir}
blind_inputs: {the JSON from step 1.4}
sources: {run_dir}/sources | none
focus: {focus | none}
```
When it returns, confirm `{run_dir}/expected-behaviours.md` exists and does not start with the line `BLIND PASS COMPROMISED` (the marker is the whole file when a pass reports itself compromised; a behaviour that merely mentions it is fine). If either check fails, stop and report. **Never run Pass 2 on a missing or compromised blind pass.** Don't read the file further.

### Step 3 — Pass 2: `adversarial-test-reconcile`
Spawn a **new** agent with `subagent_type: adversarial-test-reconcile` and a task message of exactly:
```
run_dir: {run_dir}
generated_dir: {generated_dir}
in_product_reports: {comma-separated paths | none}
sources: {run_dir}/sources | none
focus: {focus | none}
```
Pass the same `sources` value that Pass 1 got.

### Step 3b — Pass 3: `adversarial-finding-verify` (AR-19)
Skip this step only when `review.raw.json` has no findings. Spawn a **new** agent with `subagent_type: adversarial-finding-verify` and a task message of exactly:
```
run_dir: {run_dir}
kind: test
scope: {generated_dir}
```
When it returns, confirm `{run_dir}/verification.json` exists. If it doesn't, say so in the report: finalize then prints "Pass 3: not run", and no finding's claim has been independently checked. Don't edit `review.raw.json` after this step: finalize ignores a verification older than it.

### Step 4 — Finalize (deterministic, main conversation)
```
npx tsx scripts/adversarial-review-finalize.ts finalize {run_dir}
```
It runs the citation audit (AR-18, lists every reference that points at nothing) and shows Pass 3's verdict beside each finding (AR-19); neither changes the verdict. It applies the posture lint (spec §6, with the product's own patterns), assigns F-nn/D-nn ids, applies the verdict rule (§7), and writes `review.json` and `review.md` (§8). Findings it drops (praise, suggestions, empty or malformed) go verbatim, each with its reason, to `{run_dir}/dropped.md` (AR-17). It also accounts for every blind-pass `X-nn` item (AR-15). Any item Pass 2 skipped is reported as uncovered ("not assessed by Pass 2") and raised as a "needs your decision" item. It **refuses** if the blind pass is missing, compromised, or was written after the reconcile pass, or if `{generated_dir}` changed since the preflight snapshot (AR-16). If it refuses, report why and stop. Never hand-edit `review.raw.json`.

### Step 5 — Report to the user
Give the verdict line, the counts, the **Needs your decision** items, and the Critical findings (id, target, one-line defect). Report the "Citations not verified" list and any refuted findings (id, one-line reason) explicitly, since they bear on how far to trust a finding. Link `{run_dir}/review.md`, and `{run_dir}/dropped.md` if anything was dropped. Do **not** fix anything or offer a patch unless the user asks.

## Calibration (AR-10)
Run against the committed tree (`generated_dir` = `generated-tests`) and score recall against `packages/adversary/tests/__fixtures__/calibration/answer-key.json`, counting only the seeds whose defect is present in the committed tree or the generator source: D-80 seeds 1–5 and 7. Seed 6 was fixed by D-84 (2026-10-08), and seeds 8–9 exist only as fixtures. Record the result in `packages/adversary/tests/__fixtures__/calibration/results_YYYYMMDD_adversarial-test-review.md`.

Re-run after any change to:
- the spec's §5–§7;
- either agent definition;
- the agents' model.

## Changelog
- **2026-10-15 (v0.8):** two checks on the reviewers' own output (spec v0.5):
  - AR-18: finalize runs the citation audit (`scripts/audit-references.ts`) and lists every reference that points at nothing under "Citations not verified";
  - AR-19: a new Pass 3, `adversarial-finding-verify`, tries to refute each finding against the code, and finalize shows its verdict beside the finding.

  Neither changes the verdict. Pass 2's reading and judging steps are unchanged, so no AR-10 re-run is needed for this change.
- **2026-10-13 (v0.7):** AR-17 (spec v0.4): `adversarial-test-reconcile` writes every candidate finding unfiltered. Finalize keeps what the posture lint drops, plus malformed items, in `dropped.md` for human review. The verdict is unchanged.
- **2026-10-13 (v0.6):** closes two cross-check gaps (spec v0.3):
  - AR-15: `adversarial-test-reconcile` must put every X-nn in `covered` or `uncovered`, and finalize reports any it skipped;
  - AR-16: preflight snapshots the blind-safe inputs to `blind-inputs.json`, and finalize refuses if the generated tree changed;
  - Pass 2 now also gets `sources` and checks fields against the live contracts.

  This changes Pass 2's reading steps, so **AR-10 calibration must be re-run**.
- **2026-10-08 (v0.5):** reconcile check 2 reworded. The field map governs value correspondence only, and a consumer assertion naming a publisher-side field is absent (it fixes the S04 regression in the v0.4 re-run). **Calibration re-run deferred to T-49** (after regeneration), at the user's direction.
- **2026-10-08 (v0.4, T-56):** after the T-50a calibration (77% strict), `adversarial-test-reconcile` gained mandatory checks:
  - every unmapped trigger/read-back path is its own R-133e Major finding;
  - an assertion on an absent field is R-133a Critical even when it never executes;
  - counts are computed (Grep `count` mode, or `node -e` where permitted) before they are stated;
  - rule ids go in `evidence`;
  - `version` is read from this file.

  Seed 6 no longer exists in the generator source (D-84), so calibration scores seeds 1–5 and 7.
- **2026-10-08 (v0.3):** chained by the `## ADVERSARIAL REVIEW HANDOFF` block that `generate-tests` prints last (rule in the repo `CLAUDE.md`). `in_product_reports` (plural) comes from the block and covers both the §3.9 run and the §3.11 job.
- **2026-10-08 (v0.2):** the passes are now the named agents `adversarial-test-blind` and `adversarial-test-reconcile` (repo `.claude/agents/`, model fable). The blind agent has no shell, which enforces blindness; the orchestrator fetches live sources into `{run_dir}/sources/` instead.
- **2026-10-07 (v0.1):** first version (T-50), per `adversarial-review-spec.md` v0.1.
