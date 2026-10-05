---
name: enhancer-review-reconcile
description: Pass 2 of the enhancer review. Compares the blind pass's expected coverage with what jira-test-enhancer actually wrote, runs checks R1–R10, applies the fixed verdict rule, and writes review.md. Report only; never edits the suite.
type: skill
version: "1.1"
updated: 2026-10-02
---

# enhancer-review-reconcile — Pass 2 workflow

Definitions, the R1–R10 checklist, severities, the verdict rule, file formats and shared guardrails are in `C:\Users\pkatakam\.claude\skills\enhancer-review-spec.md`. Read it before starting. This file holds only the Pass 2 workflow.

## Inputs
From the RECONCILE HANDOFF, plus `suite` from the REVIEW HANDOFF:
- `run_dir`
- `expected_coverage`
- `tickets`
- `cycle`
- `suite`

## Workflow

### Step 1 — Check the inputs and the blind pass
1. **Required files:** `run_dir` contains exactly one `snapshot_*` file, `change-summary.md` and `expected-coverage.md`. If any is missing, stop and report. The snapshot and `suite` must have the same extension (`.xlsx` or `.md`); if they don't, stop and report.
2. **Blind pass is genuine:**
   - its header says `Not used (by design): live suite, change-summary.md`;
   - `expected-coverage.md` was last modified **before** you started (check the file times with PowerShell `Get-Item … | Select LastWriteTime`).

   If both hold, record `Blind pass: verified`. Otherwise record `NOT VERIFIED — {reason}` and carry on. This doesn't change the verdict, but it goes at the top of "Needs your decision".
3. **Don't edit `expected-coverage.md`.** You compare against it; you never change it.
4. **Cycle 2:** read the cycle 1 `review.md` so you know which findings were sent back for fixing.

### Step 2 — Run the mechanical diff (R8, R10, R4 candidates)
Run, writing `diff.txt` for cycle 1 or `diff_cycle2.txt` for cycle 2:
```
python "C:\Users\pkatakam\.claude\skills\enhancer-review-reconcile\suite_diff.py" "{run_dir}\{snapshot file}" "{suite}" --summary "{run_dir}\change-summary.md" --out "{run_dir}\diff.txt"
```
The script detects the format from the file extension. Read the output in full.

- **R8 and R10 results are taken straight from it.** Don't override them with your own judgement.
- **If R10 reports `NOT MACHINE-CHECKABLE`**, compare the summary with the diff by hand and say so in the reason.
- **md only: `## R8 warnings` lists changed lines outside TCs.** Each one is an R8 **Critical** finding unless an `- UPDATED-HEADER:` line in `change-summary.md` covers it **and** the ticket supports the change (e.g. a new system added to "Systems Involved"). If it's explained, record it as checked under R8's reason.

For cycle 2, the diff is still **snapshot vs. live suite**. It covers the whole change, including the fixes.

### Step 3 — Read the enhancer's claim
Read `change-summary.md`:
- the changes;
- exclusions (with reasons);
- information gaps;
- user-stated inputs;
- Jira `updated` timestamps.

Only now are you seeing the enhancer's reasoning. Use it to recognise **deliberate exclusions**, never to explain away a missing item that has no recorded reason (spec §7.5).

### Step 4 — Re-fetch the ticket(s) for evidence
- **Fetch:** for each ticket, use `getJiraIssue` (cloudId in spec §2) to have the exact text for R1 traceability quotes.
- **Compare timestamps:** compare the ticket's `updated` with both `expected-coverage.md` and `change-summary.md`. If any differ, add "ticket changed after enhancement" to "Needs your decision".
- **If Jira is unavailable:** use the quotes recorded in `expected-coverage.md` as evidence. Note `Jira re-fetch unavailable`, and mark any R1 judgement that can't be quoted as `N/A — source unavailable`, never as PASS.

### Step 5 — Reconcile the coverage
For every expected item X-nn in `expected-coverage.md`, set its status:
- **already covered:** "Already covered by" is filled in and that TC still exists in the diff (not removed).
- **covered:** an added or changed TC in `diff.txt` clearly tests it. Cite the TC ID.
- **excluded:** `change-summary.md` names this item and gives a reason (spec §7.5).
- **ambiguous:** the tag is Ambiguous. Goes to "Needs your decision".
- **missed:** none of the above. Becomes an R2 or R3 finding, graded by tag (spec §7.4).

Then list every added TC that matches **no** expected item under "Enhancer additions with no matching expected item". These get extra R1 scrutiny.

**Pass 1 might be wrong.** If an expected item looks wrong — its quote doesn't support it, or it misreads the ticket — don't count it as a miss. Put it in "Needs your decision" as a disagreement, with both readings.

### Step 6 — Run every check, R1 to R10
Use the definitions in spec §6. For each check, record `PASS`, `FAIL` or `N/A` with a one-line reason. Each failure becomes a finding F-01, F-02, … with check, severity, TC / row, finding and evidence.

| Check | How |
|---|---|
| **R1** | For every added or changed TC, check each specific detail (error codes, flags, API / system names, values, expected outcomes) against the ticket text, the E2E file(s), the snapshot, and the "User-stated inputs" in `change-summary.md`. Any detail found in none of them → Critical. Generic test wording ("log in", "navigate to") doesn't need a source. |
| **R2 / R3** | From Step 5. |
| **R4** | Confirm or reject each candidate in `diff.txt`. A `same Jira Ref + Source` candidate (md) is a duplicate unless the two TCs test clearly different scenarios. Also check new TCs against each other. |
| **R5** | Check the E2E TCs brought in against the regression rules and against `expected-coverage.md` exclusions. |
| **R6** | Check each added TC's priority and category against spec §6 R6. md TCs have Category and Priority fields. In the xlsx, priority may sit in the Scenario text or not be recorded at all; if it isn't recorded, mark N/A with that reason. |
| **R7** | For each changed TC in `diff.txt`: is the `[UPDATED by …]` notice present? Does the change keep the TC's original scenario? |
| **R8 / R10** | Copy the result from `diff.txt`, one finding per listed failure. |
| **R9** | Check that each step of every added or changed TC can be carried out, and that each expected result can be checked. |

**Rules:**
- **Evidence or drop** (spec §7.1).
- **Raising Minor to Major** needs quoted evidence of impact (spec §7.3).

### Step 7 — Apply the verdict rule
Apply spec §8 exactly, in order. Then write the recommended action:
- **FAIL — roll back recommended:** "Restore `{run_dir}\{snapshot file}` over `{suite}` — only after you confirm."
- **FAIL — fix recommended:**
  - **Cycle 1:** list the finding IDs to fix, then the FIX HANDOFF block.
  - **Cycle 2:** "Fix-cycle limit reached (2). Remaining findings need your decision." No hand-off.
- **PASS WITH NOTES / PASS:** "Accept."

### Step 8 — Write the outputs
1. **The report:** `{run_dir}\review.md` for cycle 1 or `review_cycle2.md` for cycle 2, in exactly the spec §9.3 format.
2. **RunHistory:** append one line to `C:\Users\pkatakam\.claude\skills\jira-test-enhancer\runs\RunHistory.md` (spec §9.4) with PowerShell `Add-Content`. **Never** rewrite the file with Write: a full rewrite loses lines another review appended in the meantime, which happened on 2026-10-02. Create the file with its header only if it doesn't exist. For a calibration run (`run_dir` under `_calibration`), add ` (calibration)` after the run folder name.
3. **Nothing else.** Write no other files.

### Step 9 — Final message
Report:
- **Verdict line:** the verdict and the recommended action.
- **Needs your decision:** all items, in full.
- **Findings:** each Critical and Major finding on one line (ID, check, TC, short reason); Minor findings as a count only.
- **Path:** the path to the report.

If the verdict is **FAIL — fix recommended** and this is cycle 1, end with exactly (spec §4.C):
```
## FIX HANDOFF
run_dir: {run_dir}
review: {run_dir}\review.md
fix_findings: {F-xx, F-yy}
cycle: 2
```

**Never restore the snapshot yourself.** Only the main conversation does that, after the user confirms.

## Changelog
- **2026-10-02 (v1.1):** `.md` target support. `suite_diff.py` handles `.xlsx` and `.md`; md-specific R8 checks (heading level, Index rows, warnings for changed lines outside TCs); exact Jira Ref + Source duplicate key for md.
- **2026-10-02 (v1.0):** first version, from the approved design in `skills\enhancer-review-plan.md`.
