---
name: adversarial-requirements-review
description: Adversarial review of requirements changes in specs/active/**/*.md (or a user-named range) before a PR. Two isolated agent passes — adversarial-requirements-blind derives what the changed requirements must specify from surrounding spec context without seeing the diff, then adversarial-requirements-reconcile attacks the actual diff for EARS violations, ambiguity, consistency breaks and weakened SHALLs. Local only; report only; never edits, commits, or posts anything.
type: skill
version: "0.1"
updated: 2026-10-21
---

# adversarial-requirements-review — orchestrator

Definitions, the persona, the finding format, posture lint, verdict rule, run-folder layout and guardrails are in `.claude/skills/adversarial-review-spec.md`. **Read it before starting.** This file holds only the workflow.

The **main conversation** runs this file. The two passes are the named agents in `.claude/agents/`:

| Pass | Agent | Tools | Model |
|---|---|---|---|
| 1 (blind) | `adversarial-requirements-blind` | Read, Grep, Glob, Write (**no shell**) | fable |
| 2 (reconcile) | `adversarial-requirements-reconcile` | Read, Grep, Glob, Bash (read-only), Write | fable |
| 3 (verify) | `adversarial-finding-verify` | Read, Grep, Glob, Bash (read-only), Write | fable |

Run them **one after the other, never in parallel** (AR-02), each as a fresh agent. Nothing is edited, committed, pushed or posted (AR-04).

## Inputs (from the user's request)

| Input | Default |
|---|---|
| `range` | `main...HEAD` |
| `focus` | none (a specific requirement id or section to prioritise) |

## Workflow

### Step 1 — Preflight (main conversation)

1. Validate both ends of the range with `git rev-parse --verify`. If either fails, stop and report. **Never fall back to reviewing the whole repo.**
2. Run `git diff --name-only {range}`. Keep only paths matching `specs/active/**/*.md` or `specs/pending/**/*.md`; exclude `pnpm-lock.yaml`. Note excluded paths in the report.
3. If the filtered list is empty, stop and report "no requirements changes in {range}". If the working tree has uncommitted changes, mention they are **not** in `{range}` and ask whether to review them instead. Don't switch on your own.
4. Create `run_dir` = `.adversarial-review/{YYYYMMDD-HHMM}_requirements_{branch}/` where every `/` in `{branch}` is replaced with `-` (R-0 — makes `run_dir` a single path segment safe for S3 keys, DynamoDB sort keys, and URL paths).
5. For each changed path, collect the governing spec ids (`R-nnn`, `D-nn`, `NFR-n`, `E-nn`) that `specs/active/odcs-contract-registry/design.md` and `specs/active/odcs-contract-registry/tasks.md` map to that section. Use those docs only, never the changed file.

### Step 2 — Pass 1: `adversarial-requirements-blind`

Spawn the agent with `subagent_type: adversarial-requirements-blind` and a task message of exactly:
```
run_dir: {run_dir}
range: {range}
changed_files:
{one path per line}
spec_ids: {comma-separated}
focus: {focus | none}
```
When it returns, confirm `{run_dir}/expected-behaviours.md` exists and does not start with the line `BLIND PASS COMPROMISED`. If either check fails, stop and report. **Never run Pass 2 on a missing or compromised blind pass.**

### Step 3 — Pass 2: `adversarial-requirements-reconcile`

Spawn a **new** agent with `subagent_type: adversarial-requirements-reconcile` and a task message of exactly:
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
kind: requirements
scope: {range}
```
When it returns, confirm `{run_dir}/verification.json` exists. If it doesn't, say so in the report: finalize then prints "Pass 3: not run".

### Step 4 — Finalize (deterministic, main conversation)

```
npx tsx scripts/adversarial-review-finalize.ts finalize {run_dir}
```
It lints, assigns ids, applies the verdict, and writes `review.json` and `review.md`. It also runs the citation audit (AR-18) and shows Pass 3's verdict beside each finding (AR-19). Findings it drops go verbatim to `{run_dir}/dropped.md` (AR-17). It refuses if the blind pass is missing, compromised or late; report why and stop.

### Step 5 — Report to the user

Give the verdict line, the counts, the **Needs your decision** items, and every Critical and Major finding (id, `path:line`, one-line defect). Report the "Citations not verified" list and any refuted findings explicitly. Link `{run_dir}/review.md`, and `{run_dir}/dropped.md` if anything was dropped. Don't fix anything unless the user asks.

## Calibration

Plant an EARS violation (e.g. a missing trigger clause) or an ambiguous SHALL in a throwaway branch's requirements, run the skill, and verify it is caught. Record recall in `packages/adversary/tests/__fixtures__/calibration/results_YYYYMMDD_adversarial-requirements-review.md`.

## Changelog

- **2026-10-21 (v0.1):** first version — three-pass pipeline (blind → reconcile → verify) matching the adversarial-code-review pattern; requirements-specific checks in Pass 2 (EARS structural validity, ambiguity, consistency, weakened SHALLs, design coverage).
