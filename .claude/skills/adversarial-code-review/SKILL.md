---
name: adversarial-code-review
description: Adversarial review of any repo change (`git diff main...HEAD` by default) before you open a PR. Two isolated agent passes — adversarial-code-blind derives what the changed files must do from the spec without seeing the diff, then adversarial-code-reconcile attacks the diff — with the adversarial persona. Local only; report only; never edits, commits, or posts anything.
type: skill
version: "0.5"
updated: 2026-10-15
---

# adversarial-code-review — orchestrator

Definitions, the persona, the finding format, posture lint, verdict rule, run-folder layout and guardrails are in `.claude/skills/adversarial-review-spec.md`. **Read it before starting.** This file holds only the workflow.

The **main conversation** runs this file. The two passes are the named agents in `.claude/agents/`:

| Pass | Agent | Tools | Model |
|---|---|---|---|
| 1 (blind) | `adversarial-code-blind` | Read, Grep, Glob, Write (**no shell**, so no diff) | fable |
| 2 (reconcile) | `adversarial-code-reconcile` | Read, Grep, Glob, Bash (read-only), Write | fable |
| 3 (verify) | `adversarial-finding-verify` | Read, Grep, Glob, Bash (read-only), Write | fable |

Run them **one after the other, never in parallel** (AR-02), each as a fresh agent. Nothing is edited, committed, pushed or posted (AR-04). There is no CI or PR-comment integration (D-83).

## Inputs (from the user's request)

| Input | Default |
|---|---|
| `range` | `main...HEAD` |
| `focus` | none (a file, module or requirement to look at first) |

## Workflow

### Step 1 — Preflight (main conversation; AR-11, AR-13)
1. Validate both ends of the range with `git rev-parse --verify`. If either fails, stop and report. **Never fall back to reviewing the whole repo.**
2. Run `git diff --name-only {range}`. Exclude `generated-tests/**` (that belongs to `adversarial-test-review`) and `pnpm-lock.yaml`, and say so in the report.
3. If the list is empty, stop and report "no changes in {range}". If the working tree has uncommitted changes, mention that they are **not** in `{range}` and ask whether to review them instead. Don't switch on your own.
4. Create `run_dir` = `.adversarial-review/{YYYYMMDD-HHMM}_code_{branch}/`.
5. Governing spec ids: for each changed **path**, collect the ids (`R-nnn`, `D-nn`, `NFR-n`, `E-nn`) that `specs/active/odcs-contract-registry/design.md` and `specs/active/odcs-contract-registry/tasks.md` map to it. Use those docs only, never the changed file.

### Step 2 — Pass 1: `adversarial-code-blind`
Spawn the agent with `subagent_type: adversarial-code-blind` and a task message of exactly:
```
run_dir: {run_dir}
range: {range}
changed_files:
{one path per line}
spec_ids: {comma-separated}
focus: {focus | none}
```
When it returns, confirm `{run_dir}/expected-behaviours.md` exists and is not compromised. If either check fails, stop.

### Step 3 — Pass 2: `adversarial-code-reconcile`
Spawn a **new** agent with `subagent_type: adversarial-code-reconcile` and a task message of exactly:
```
run_dir: {run_dir}
range: {range}
changed_files:
{one path per line}
focus: {focus | none}
```

### Step 3b — Pass 3: `adversarial-finding-verify` (AR-19)
Skip this step only when `review.raw.json` has no findings. Spawn a **new** agent with `subagent_type: adversarial-finding-verify` and a task message of exactly:
```
run_dir: {run_dir}
kind: code
scope: {range}
```
When it returns, confirm `{run_dir}/verification.json` exists. If it doesn't, say so in the report: finalize then prints "Pass 3: not run", and no finding's claim has been independently checked. Don't edit `review.raw.json` after this step: finalize ignores a verification older than it.

### Step 4 — Finalize (deterministic, main conversation)
```
npx tsx scripts/adversarial-review-finalize.ts finalize {run_dir}
```
It lints, assigns ids, applies the verdict, and writes `review.json` and `review.md`. It also runs the citation audit (AR-18) and lists every reference that points at nothing, and shows Pass 3's verdict beside each finding (AR-19); neither changes the verdict. Findings it drops (praise, suggestions, empty or malformed) go verbatim to `{run_dir}/dropped.md` (AR-17). It also accounts for every blind-pass `X-nn` item (AR-15): any item Pass 2 skipped is reported as uncovered and raised as a "needs your decision" item. It refuses if the blind pass is missing, compromised or late. If it refuses, report why and stop.

### Step 5 — Report to the user
Give the verdict line, the counts, the **Needs your decision** items, and every Critical and Major finding (id, `path:line`, one-line defect). Report the "Citations not verified" list and any refuted findings (id, one-line reason) explicitly, since they bear on how far to trust a finding. Link `{run_dir}/review.md`, and `{run_dir}/dropped.md` if anything was dropped. Don't fix anything unless the user asks.

## Calibration (AR-14)
Calibrate on a diff with a planted defect, e.g. a reintroduced alphabetical publisher/consumer assignment, or a timestamp written into an emitted file. Make the planted change in a **throwaway git worktree**, never on the user's branch, and only with the user's go-ahead. Remove it afterwards. Record recall in `packages/adversary/tests/__fixtures__/calibration/results_YYYYMMDD_adversarial-code-review.md`.

## Changelog
- **2026-10-15 (v0.5):** two checks on the reviewers' own output (spec v0.5): finalize runs the citation audit and lists every reference that points at nothing (AR-18), and a new Pass 3, `adversarial-finding-verify`, tries to refute each finding and finalize shows its verdict beside the finding (AR-19). Neither changes the verdict. Pass 2's reading and judging steps are unchanged, so no AR-14 re-run is needed for this change.
- **2026-10-13 (v0.4):** AR-17 (spec v0.4): `adversarial-code-reconcile` writes every candidate finding unfiltered. Finalize keeps what the posture lint drops, plus malformed items, in `dropped.md` for human review. The verdict is unchanged.
- **2026-10-13 (v0.3):** AR-15 (spec v0.3): `adversarial-code-reconcile` must put every X-nn in `covered` or `uncovered`, and finalize reports any it skipped. This changes Pass 2's judging step, so **AR-14 calibration must be re-run**.
- **2026-10-09:** `adversarial-code-reconcile` reads `version` from this file instead of hard-coding "0.1" (found in T-51a). This changes only the output header, not the reading or judging steps, so no AR-14 re-run is needed.
- **2026-10-08 (v0.2):** the passes are now the named agents `adversarial-code-blind` and `adversarial-code-reconcile` (repo `.claude/agents/`, model fable). The blind agent has no shell, so it cannot read the diff.
- **2026-10-07 (v0.1):** first version (T-51), per `adversarial-review-spec.md` v0.1.
