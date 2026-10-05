---
name: jira-test-enhancer
description: Reads existing test case files and Jira ticket IDs, then enhances and updates the test cases with new requirements, edge cases, and acceptance criteria derived from the Jira tickets.
type: skill
trigger: /enhance-tests
---

# jira-test-enhancer

Enhance and update existing test cases by cross-referencing them against one or more Jira tickets or test cases excel file.

## Invocation


```
/enhance-tests
```

Or describe the task naturally: "enhance my test cases using DAPI-12345" or "update test cases from Jira ticket XYZ-99".

## Core principles (enforced at all times)

> These principles override everything else. Never skip or abbreviate them.

1. **Never hallucinate** — every test case, step, expected result, API name, flag value, or system behavior written must be explicitly stated in the source ticket, the existing test file, or confirmed by the user. If something is uncertain, stop and ask. Do not invent plausible-sounding details.
2. **Gather all information before executing** — complete Steps 1–3 (inputs, existing test cases, all Jira ticket data) fully before writing a single new test case. Do not write while still collecting data.
3. **E2E coverage across all teams** — read the existing test cases not just for individual unit behavior but for end-to-end flow coverage: identify every system/team in the integration chain and verify the test suite covers hand-offs, contracts, and failure modes at each boundary.
4. **Ask when stuck, not guess** — if at any point the agent is in a loop (retrying the same Jira fetch, unable to parse a requirement, receiving conflicting information from multiple sources, or unsure whether a new test case duplicates an existing one), stop immediately and ask the user for clarification. Do not retry more than twice on any single operation without pausing to ask.

---

## What this skill does

1. **Collects inputs** — the path to the existing test case file and one or more Jira ticket IDs.
2. **Fetches ticket data** — reads each Jira ticket (summary, description, acceptance criteria, comments, linked issues, fix version, priority).
3. **Reads existing test cases for E2E and multi-team coverage** — parses the full test case file: extracts every system involved, every integration boundary, every team handoff, and maps which test cases cover which part of the end-to-end chain.
4. **Gap analysis** — identifies:
   - Requirements or acceptance criteria in the ticket not covered by any existing test case.
   - Changed behavior (updated rules, new flags, modified flows) that invalidates or needs to update existing test cases.
   - New edge cases implied by the ticket (error codes, null inputs, boundary values, concurrency).
   - New negative/failure scenarios added by the ticket.
   - Missing E2E coverage: integration boundaries between teams not tested end-to-end.
5. **Generates enhancements** — for each gap, produces either:
   - A **new test case** (appended to the file with the next sequential ID).
   - An **update** to an existing test case (clearly marked with what changed and why).
6. **Saves a snapshot, then updates the test case file.** A copy of the file goes into a run folder first. Changes are then written back to the original, append-only, preserving all existing content and formatting.
7. **Produces a change summary.** It's written to `change-summary.md` in the run folder (in the format the reviewer parses) and printed as a short report of what was added or modified and which ticket requirement each change addresses.
8. **Hands off to the independent review.** For both `.xlsx` and `.md` targets, it ends with a REVIEW HANDOFF block. The main conversation then runs `enhancer-review-blind` → `enhancer-review-reconcile`, which return a verdict. The enhancer never reviews its own work.

## Workflow (follow in order)

### Step 1 — Collect inputs

If the user has not provided them, ask for:
- **Test case file path** *(required)*: path to the `.xlsx` or `.md` regression suite file to enhance.
- **Jira ticket ID(s)** *(optional if E2E reference file provided)*: one or more ticket IDs (e.g., `DAPI-31678`, `SAT-1234`). Multiple IDs are comma-separated. May be omitted when an E2E reference file is supplied instead.
- **E2E reference file(s)** *(optional if Jira ticket ID provided)*: path(s) to pre-generated E2E test case files (`.xlsx` or `.md`) produced by jira-e2e-test-writer or any other source. The agent reads them and selects regression-appropriate TCs to bring into the target file. Multiple paths are comma-separated. May be omitted when Jira ticket IDs are supplied instead.

> **At least one of** Jira ticket ID(s) **or** E2E reference file(s) **must be provided.** Both may be provided together for maximum coverage. If neither is provided, stop and ask.

**Run modes.** Decide the mode before Step 2:

| Mode | How it's triggered | What changes |
|---|---|---|
| **Normal** (default) | Any enhancement request | All steps, including the snapshot (5.5), `change-summary.md` (7) and the review hand-off (9) |
| **No review** | The user says "no review" / "skip review" | Snapshot and `change-summary.md` are still written; Step 9 hands off nothing and says "review skipped at user request" |
| **Fix cycle** | You're given a `## FIX HANDOFF` block | See "Fix-cycle mode" below; Steps 2–4 are replaced |

The automatic review (`enhancer-review-blind` → `enhancer-review-reconcile`, spec `C:\Users\pkatakam\.claude\skills\enhancer-review-spec.md`) supports **`.xlsx` and `.md` targets**. For any other format, still do Steps 5.5 and 7, but Step 9 reports "review not supported for {extension} targets" and hands off nothing.

#### Fix-cycle mode
When you're given a `## FIX HANDOFF` block (`run_dir`, `review`, `fix_findings`, `cycle: 2`):
1. Read `{review}` and take **only** the findings listed in `fix_findings`. Ignore all other findings and anything else in the review.
2. Read `{run_dir}\change-summary.md` and the live suite (actual state, Step 6 pre-write validation).
3. For each listed finding, make the smallest change that resolves it, following all the usual rules (no invented details, append-only, sequential IDs). If a finding can't be fixed without inventing information, don't fix it; record it under "Information gaps" as `F-xx not fixed: {reason}`.
4. **Don't take a new snapshot.** `snapshot_*` in `run_dir` stays the pre-cycle-1 state, so the cycle 2 review sees the whole change.
5. Update `change-summary.md` (Step 7) so the `- ADDED:` / `- UPDATED:` lines describe the **total** change from the snapshot to now, and add a `## Cycle 2 fixes` section listing each finding ID with what you did.
6. Step 9 emits the REVIEW HANDOFF with `cycle: 2`.

A fix cycle is only allowed once per run. If `cycle` in the FIX HANDOFF is anything other than `2`, stop and report.

### Step 2 — Read test case file for E2E and multi-team coverage

Use the Read tool to load the **full** test case file (do not truncate). Extract:
- The metadata header (ticket reference, systems involved, rule matrix).
- The test case index table.
- Each individual test case block (ID, title, category, priority, preconditions, steps, expected results, notes).

Keep track of:
- The highest existing test case sequence number (e.g., if last ID is `TC-DAPI-31678-032`, next new ID is `TC-DAPI-31678-033`).
- Which categories exist (Happy, Alternate, Negative, Edge).

**E2E and multi-team map** — build an explicit coverage map before moving on:
- List every system/team in the integration chain (e.g., CTO → Mission Control → CHOO → Bluebook).
- For each boundary (System A → System B), note which existing test case(s) cover that handoff.
- Flag any boundary with zero test coverage — these are mandatory gaps to fill.
- Note which teams own each system so new test cases can call out the responsible team.

### Step 3 — Fetch Jira ticket(s) and read E2E reference file(s)

**3a — Fetch Jira ticket(s)** *(skip if no Jira ticket IDs were provided)*

For each Jira ticket ID, use the available Atlassian MCP tools (`getJiraIssue`, `search`, `getJiraIssueRemoteIssueLinks`) to retrieve:
- Summary and full description.
- Acceptance criteria (look in description, custom fields, or comments).
- Status, priority, fix version, components, labels.
- Linked issues (clones, relates-to, blocks) — note their summaries.
- Any comments that clarify behavior or add edge cases.
- Attachments mentioned (note them as information gaps if not accessible).
- The ticket's **`updated` timestamp**, exactly as returned. It goes into `change-summary.md` (Step 7) so the reviewer can tell whether the ticket changed between your fetch and its own.

If the Atlassian MCP tools are unavailable, ask the user to paste the ticket content directly.

**JQL scope restriction**: When using `searchJiraIssuesUsingJql`, always scope queries to the specific project key of the ticket being worked on (e.g., `project = DAPI AND ...` or `project = DAP AND ...`). Never run unscoped JQL that could return tickets from other teams' projects. If the project key cannot be determined from the ticket ID, derive it from the prefix (e.g., `DAPI-31678` → project `DAPI`).

**3b — Read E2E reference file(s)** *(skip if none provided)*

> E2E xlsx files from jira-e2e-test-writer follow the shared column contract defined in `C:\Users\pkatakam\.claude\skills\QA-AGENTS.md` (sheet `TestCases`; columns Test ID → Notes/Assumptions). If the file doesn't match that structure, report the mismatch rather than guessing column meanings.

If the user provided one or more E2E reference files:
- For `.md` files: use the Read tool to load the full file.
- For `.xlsx` files: use the PowerShell tool to run Python with openpyxl, write the TC rows to a temp `.txt` file, then Read that file.

For each E2E TC found, extract: TC ID, title, category, priority, Jira Ref, source (AC), teams/systems, steps, expected result, notes.

Build an **E2E TC selection list** — categorize every E2E TC as:
- **Include in regression**: happy path, critical negative (data loss / security / blocking flow), integration boundary smoke tests. These are P1/P2 TCs that exercise the core contract at each system handoff.
- **Exclude from regression**: deep edge cases, lockout timing, load/soak/perf tests, fuzzing, race conditions, one-off security scans. Document the reason for exclusion. These remain available in the E2E file for targeted expansion.

### Step 4 — Gap analysis

Compare ticket requirements (and E2E reference TCs if provided) against existing test cases:

**Coverage check** — for each discrete requirement or acceptance criterion in the ticket, identify which existing test case(s) cover it. Flag uncovered ones.

**E2E reference coverage check** *(if E2E reference file(s) were provided)* — for each TC in the "Include in regression" list from Step 3b:
- Check whether the existing target file already has a TC covering the same Jira Ref + Source combination (idempotency check).
- If not covered → it is a gap. Mark it for addition.
- If already covered → skip.

**Staleness check** — check whether any ticket update (e.g., a rule change, a new flag, a revised API contract) makes an existing test case incorrect or incomplete. Flag those.

**Implicit gaps** — derive additional cases the ticket implies but doesn't state:
- Boundary values (min/max, empty, null, zero).
- Error/exception paths (timeout, 4xx, 5xx, malformed payload).
- Concurrency or ordering scenarios.
- Cross-system inconsistency scenarios.
- Data type edge cases (string vs int, locale differences, special characters).

### Step 5 — Generate new / updated test cases

For each gap identified in Step 4, produce a test case block using this exact format:

```markdown
### TC-{TICKET_ID}-{NNN} — {Short descriptive title}

| Field | Value |
|---|---|
| **Category** | Happy / Alternate / Negative / Edge |
| **Priority** | P1 / P2 / P3 |
| **Jira Ref** | {Ticket ID(s)} |
| **Source** | {Which requirement / acceptance criterion this covers} |

**Preconditions**
- List preconditions

**Steps**
1. Step one
2. Step two
3. ...

**Expected Result**
- What should happen

**Notes / Assumptions**
- Any open questions or assumptions made
```

For **updates** to existing test cases, show a clear before/after diff in comments within the file, like:

```markdown
> **[UPDATED by {Ticket ID} on {date}]** {What changed and why}
```

Priority assignment:
- P1: core happy path, critical negative (data loss, security, blocking flow).
- P2: important alternates, common edge cases.
- P3: rare edge cases, cosmetic, non-blocking.

### Step 5.5 — Save a snapshot before writing

Skip this step in fix-cycle mode (the snapshot from cycle 1 is kept).

1. Create the run folder: `C:\Users\pkatakam\.claude\skills\jira-test-enhancer\runs\{YYYYMMDD-HHMM}_{TICKETS}\`.
   - `{TICKETS}` is the ticket IDs joined with `+`, e.g. `DAP-1654+DAPI-31678`; use `E2E` if no ticket was given.
   - If the folder already exists, add `-2`, `-3`, … to the name.
2. Copy the target file into it **unchanged**, as `snapshot_{original filename}`, e.g. `snapshot_BST CRA Regression Suite.xlsx`. Use PowerShell `Copy-Item`; never open and re-save the file to make the copy.
3. Check the copy: its SHA-256 matches the original's (PowerShell `Get-FileHash`). For xlsx, also check that `suite_info.py` on the copy reports the same last TC as the original. If either check fails, stop and report. **Don't write the suite without a good snapshot.**
4. **Retention:** keep `snapshot_*` files only in the 20 most recent run folders (by folder name). Delete `snapshot_*` files in older run folders, but **never** delete any other file or folder. Skip `_calibration`.

If Steps 2–4 found no gaps, there's nothing to write: don't create a run folder, and go straight to Step 7's printed summary ("no changes").

### Step 6 — Write changes to file

**Pre-write validation (do this before any write — the actual file is always authoritative):**
- Read directly from the xlsx using openpyxl: the actual max row, the actual last TC ID/number, and the actual boundaries of the section being appended to.
- Use these **actual values** — never the cached ones — to determine the next TC number and the append position. The cache below is a performance hint for skipping the full coverage re-read; it must never gate or drive a write.
- If the actual values differ from the cached values, do not stop — proceed using the actual values, note the drift in the change summary ("cache was stale: cached last TC 137, actual 139"), and refresh the cache in Step 8.
- Only stop and ask the user if the actual file state is *internally* inconsistent (e.g., duplicate TC IDs, the expected section header is missing) — that indicates real corruption, not cache staleness.

Then use the Edit tool to:
1. Update the Test Case Index table with new rows.
2. Append new test case blocks at the end of the file.
3. Insert update notices into modified existing test case blocks.
4. Update the metadata header if the ticket adds new systems, rules, or a new rule matrix row.

Do **not** delete or reorder existing test cases.

**Append-only rule for xlsx (never break).**
- **Never insert or delete rows in the middle of the sheet** (`insert_rows` / `delete_rows`). Section titles are merged cells (A:B), and openpyxl doesn't shift merged ranges. A mid-sheet insert or delete misaligns every section title below it and corrupts unrelated TCs. This was confirmed in testing on 2026-10-02: one deleted row damaged 6 TCs.
- **New TCs go after the last used row.** New sections go there too, with a blank separator row, a bold merged section title naming the ticket, and a header row (bold, fill `D9E1F2`, centered, wrap text).
- **Updates to existing TCs change cell values in place only.**
- If the user wants new TCs *inside* an existing mid-sheet section, stop and ask. Explain the merged-cell risk and offer to put them in a new section at the end instead.

**Markdown targets (`.md`):**
- **Append new TC blocks at the end of the file**, after the last existing TC block and before any trailing checklist or appendix section. Use the **same heading level** (`##` or `###`) and the **same body style** (field table, `- **Field:**`, or `- **Field**:`) as the existing TCs.
- **Continue the existing `TC-{TICKET}-` prefix sequence.** A new ticket's prefix starts at `001`.
- **Index:** if the file has a Test Case Index table, add one row per new TC, and never remove an existing row.
- **Updates to existing TC blocks** get a `> **[UPDATED by {ticket} on {date}]** …` notice. Never delete or reorder existing blocks.
- **Outside TC blocks, only change the metadata header**, and only when the ticket adds systems or rules. Record each such change in `change-summary.md` under `## Changes` as an `UPDATED-HEADER:` line with the reason; otherwise the reviewer treats it as a Critical integrity failure.

`suite_diff.py` in the review flags any violation as an R8 Critical finding.

### Step 7 — Write `change-summary.md` and output the change summary

**7a — Write `{run_dir}\change-summary.md`** in exactly the format in `enhancer-review-spec.md` §9.1. The reviewer depends on it, and `suite_diff.py` parses its `- ADDED:` / `- UPDATED:` lines to check R10. Rules:
- **One `- ADDED: {TC ID} — …` line per new TC and one `- UPDATED: {TC ID} — …` line per changed existing TC**, with the exact IDs as written in the file. A TC that isn't listed counts as an R10 mismatch.
- **Under `## Exclusions`, name every item you deliberately left out** (each excluded E2E TC ID, each requirement judged out of scope) with a specific reason. Unnamed exclusions count as misses in review.
- **Under "User-stated inputs", record every fact the user gave in chat that a TC relies on.** Otherwise the reviewer will treat those details as invented (R1).
- **Record each ticket's `updated` timestamp** from Step 3a.

**7b — Print** a concise change summary to the user:

```
## Enhancement Summary

**Ticket(s):** {IDs}
**Test case file:** {path}

### New test cases added ({N})
- TC-XXX-NNN — {title} [source: {requirement}]
- ...

### Existing test cases updated ({N})
- TC-XXX-NNN — {title} [reason: {what changed}]
- ...

### Information gaps (action required)
- {Any ambiguities or missing data that could not be resolved from the ticket}
```

### Step 8 — Refresh the cache in this SKILL.md

After every successful write to a known test suite file, use the Edit tool to update the corresponding cache block in the "Known test suite files" section of this SKILL.md:
- Update the affected section's TC ID range and row range.
- Update "Last TC number in file" and "Next new TC".
- Update the "last cached" date to today.
- If a new section was added, add its row to the sections table.

This keeps the cache useful as a performance hint. Skipping this step does not corrupt anything (Step 6 always reads actuals), but it makes future runs slower and the drift notes noisier.

### Step 9 — Hand off to the review

This step only applies when something was written in this run, the mode isn't "No review", and the target is `.xlsx` or `.md` (see Run modes).

**End your final message with exactly this block.** The main conversation copies it as written to start the review (spec `enhancer-review-spec.md` §4.A):

```
## REVIEW HANDOFF
run_dir: {absolute path of the run folder}
suite: {absolute path of the target file}
tickets: {ID, ID | none}
e2e_files: {path, path | none}
cycle: {1 | 2}
```

- **Cycle 1:** the main conversation starts `enhancer-review-blind` with this block minus `suite`, then `enhancer-review-reconcile` with the blind agent's RECONCILE HANDOFF plus `suite`.
- **Cycle 2 (fix-cycle mode):** the main conversation skips the blind agent and starts `enhancer-review-reconcile` directly with `run_dir`, `expected_coverage: {run_dir}\expected-coverage.md`, `tickets`, `suite` and `cycle: 2`.

**Don't start the review yourself, and don't describe what the reviewer should find.** Keeping your view out of the review is what makes it independent.

## Rules and constraints

### Absolute rules (never break)
- **No hallucination — ever** — every fact, API name, flag value, system behavior, step, or expected result must trace directly to the ticket text, the existing test file, or an explicit user statement. If you cannot cite the source, do not write it — stop and ask instead. This is the single most important rule.
- **Gather everything before writing** — do not generate or write any test case until Steps 1–3 are fully complete. Partial information leads to hallucinated gaps.
- **Ask when looping** — if you attempt the same operation (fetch, parse, search, deduplication check) more than twice without progress, stop and tell the user exactly what is blocking you. Never silently retry in an infinite loop.
- **E2E and multi-team coverage is mandatory** — the coverage map built in Step 2 must be used. Every uncovered integration boundary is a gap that must result in at least one new test case or a documented reason it was intentionally excluded.

### Structural rules
- **Preserve all existing content** — never delete, reorder, or renumber existing test cases.
- **Sequential IDs** — new test cases continue the existing sequence; do not reuse IDs.
- **Format consistency** — match the heading level, table style, and terminology of the existing file exactly.
- **Idempotency** — if run twice with the same ticket and file, the second run detects existing cases and adds nothing (check for duplicate Jira Ref + Source combinations).
- **Multi-ticket support** — when multiple ticket IDs are provided, process each in sequence and deduplicate overlapping requirements before writing.
- **Data science context** — if test cases involve data pipelines, model outputs, or ML systems, include data quality and schema validation assertions where appropriate.

## Known test suite files (cached for faster re-runs)

**The cache is a performance hint only — it never gates or drives a write.** When the user references a file listed here, use the cached structure to skip the full coverage re-read in Step 2. The actual file is always authoritative: Step 6 reads the real max row, last TC ID, and section boundaries from the xlsx before any write, and Step 8 refreshes this cache afterward.

### `C:\2026\Fall 2026\Test Cases\BST CRA Regression Suite.xlsx` — last cached 2026-06-25 (via suite_info.py)

> **Verified 2026-06-25 (authoritative snapshot):** max_row=163; last TC = CRA_TempcredsMR_Regr_137 (row 163); next = 138. Actual section-title rows: Happy Path 2 | Cancel 8 | Update 13 | Device Swap 26 | Merge 32 | DI Score Send 40 | Misc 46 | Temp creds 50 | CHOO 63 | PSAT 8/9 (DAPI-31678) 75 | Accommodated 95 | Temp Creds MR (DAP-1654) 148. The per-section row *ranges* in the table below drifted from these actuals (e.g., PSAT title cached as 73, actual 75; Accommodated cached 101–146, actual title at 95) — treat ranges as approximate hints only; Step 6 always reads actuals before writing.

**Sheets:** Version | CRA Regression Suite | Common Validations

**CRA Regression Suite columns:** TC Name | Scenario | Stay in Regression | Test Steps | Expected Result

**Common Validations sheet columns:** TC# | Scenario | Test Steps | Expected Result
**Common Validations TCs:** CHOO-PIVOT_CommVal | SSOR_CommVal | msTOP_CommVal | DAP_CommVal | ATLAS_CommVal | SCM_CommVal | PEARSON_CommVal | TESTDAY_CommVal

**Sections and TC ranges (after DAPI-31678 + Common Validations alignment, 2026-05-15):**

| Section header | TC ID range | Row range | Notes |
|---|---|---|---|
| Happy Path Scenarios | CRA_Happypath_Regr_001–005 | 3–7 | SATSD Domestic, DoDEA, NY, USTR, INTN |
| Cancel Scenarios | CRA_Cancel_Regr_006–007 | 9–12 | + 2 archived SATSDF25 rows (Stay=No) |
| Update Scenarios | CRA_Update_Regr_008–015 | 14–24 | Std↔SSD, accomm, paper linear |
| Device Swap Scenarios | CRA_DeviceSwap_Regr_016–019 | 27–30 | Before/after pkg download, multi-day |
| Merge Scenarios | CRA_Merge_Regr_020–024 | 34–38 | + archived SATSDF25 rows |
| DI Score Send Scenarios | CRA_DIScoreSend_Regr_025–029 | 41–45 | |
| Misc Scenarios | CRA_ForceSubmit_Regr_030, CRA_AutoSubmit_Regr_031 | 48–49 | Force/auto submit |
| Temp creds | CRA_Tempcreds_Regr_032–041 | 51–60 | + Religious AI 042, Homeschool 043 |
| CHOO Scenarios | CRA_CNX-OptIn_Regr_044–054 | 64–74 | SATSD CNX opt-in flows |
| PSAT 8/9 CHOO Opt-Out Scenarios (DAPI-31678) | CRA_PSAT89_Regr_106–123 | 73–100 | Row 73 = section title, row 74 = column headers (bold, light-blue fill D9E1F2), rows 75–100 = TCs; 106/107 updated 2026-05-15; 119–121 added 2026-05-15; 122–123 added externally |
| Accommodated Scenarios | CRA_ExtdTime_Regr_055 … CRA_ReadingDble_Regr_105 | 101–146 | Extended time, TTS, breaks, multi-day, braille, paper linear |
| Temp Creds Multi-Region Auth Scenarios (DAP-1654) | CRA_TempcredsMR_Regr_124–137 | 147–163 | Row 147 = blank separator, row 148 = bold merged section title, row 149 = column headers (bold, light-blue fill D9E1F2), rows 150–163 = 14 TCs; added 2026-06-16 |

**Column header row format (added under each new section):** bold font, light-blue fill (`D9E1F2`), centered, wrap_text=True. Columns: TC Name | Scenario | Stay in Regression | Test Steps | Expected Result.

**Last TC number in file:** 137 (CRA_TempcredsMR_Regr_137, added 2026-06-16 for DAP-1654). Next new TC = 138.

**Common Validations coverage for PSAT 8/9 section (as of 2026-05-15):**
- SSOR_CommVal: ✓ TCs 106, 107, 121 reference `_Execute SSOR_Validations test case`
- msTOP_CommVal: ✓ TCs 106, 107, 120 reference `_Execute msTOP_Validations`; TC 120 validates educationLevelCd + studentsConnectionsOptInStatus
- DAP_CommVal: ✓ TCs 106, 107, 121 reference `_Execute DAP_Validations`
- CHOO-PIVOT_CommVal: ✓ TC 119 covers edu period year 27 setup + PIVOT API K12OptIn/StudentOptIn data
- TESTDAY_CommVal: ✓ TCs 106, 107, 121 reference `_Execute TESTDAY_Validations test case`
- ATLAS_CommVal: ✓ Covered via DAP_CommVal ref; explicitly verified in TCs 106, 107, 121 (ATLAS Answers Received)
- SCM_CommVal: N/A (PSAT 8/9 is digital delivery, not paper linear)
- PEARSON_CommVal: N/A (digital delivery)

**Integration chain for PSAT 8/9 CHOO work (DAPI-31678):**
`CTO (educationLevelCd)` → `Mission Control` → `CHOO` → `Bluebook (opt-outs screen)`

**Key flags from CHOO:** connectionsOptOut | parentOptOut | phonePromptOptOut (bigFutureSchoolOptOut) | ttiOptOut

**Integration chain for Temp Creds Multi-Region Auth (DAP-1654):**
`Bluebook client (feature flag: temp-creds-new-auth)` → `Akamai (rollback switch)` → `Route 53 (health-check failover)` → `API Gateway + WAF (multi-region)` → `temp-creds-auth Lambda (dap-mc-auth)` → `TempCredentials Global DynamoDB (us-east-1/us-west-2, gsiUsrnameIx)` → `RAOTT Global table` → `Catapult (RAOTT gen)` → `Secrets Manager (API keys)` → `legacy da-msagwtc (dual-write)` → `CloudWatch`

**Key DAP-1654 error codes:** ERROR_BAD_API_KEY | ERROR_BAD_CREDENTIALS (400/401) | SECURITY_LOCKOUT | EXPIRED_CREDENTIALS | INACTIVE_CREDENTIALS | ERROR_METHOD_NOT_ALLOWED | ERROR_UNKNOWN_ERROR

**DAP-1654 E2E TCs excluded from regression** (available in `C:\Users\pkatakam\.claude\skills\jira-e2e-test-writer\Fall26\TestCases_DAP-1654_Fall26.md` for targeted expansion): TC-002/003 (RAOTT cache internals), TC-014–016 (lockout threshold/progression/auto-unlock — confirm 5th-attempt threshold with dev team first), TC-019 (405 cosmetic P3), TC-022 (WAF injection), TC-023 (input fuzzing), TC-024 (cross-region race), TC-025 (TTL timing), TC-026 (Catapult 500), TC-028 (idempotency replay), TC-029 (load/soak)

**Jira cloudId for collegeboard.atlassian.net:** `92589c41-ec63-4cb0-b780-a9b9f279c818`

**Reading xlsx files:** Python `openpyxl` is available. Use `PowerShell` to run Python (Bash stdout does not capture in this environment). Write output to a temp `.txt` file then use Read tool to load it.

**Structure dumps (Steps 2 and 6):** use the bundled helper instead of writing ad-hoc code:
`python "C:\Users\pkatakam\.claude\skills\jira-test-enhancer\suite_info.py" "<xlsx path>" "<output.txt>"`
It reports sheets, max rows, header row, section-title rows, the last TC ID, and the next TC number. Tested against the BST suite 2026-06-25. Write ad-hoc openpyxl code only for the actual TC writes and for reads this script doesn't cover.

---

## Example invocations

**Jira ticket only:**
User: "enhance my test cases using DAPI-31678 and DAPI-31677"

Agent steps:
1. Ask for test case file path if not provided.
2. Read target file (or use cached structure if available).
3. Fetch DAPI-31678 and DAPI-31677 via Jira MCP tools.
4. Run gap analysis.
5. Generate new TC blocks and update notices.
6. Write to file.
7. Print change summary.

**Jira ticket + E2E reference file:**
User: "jira-test-enhancer, update BST CRA Regression Suite using DAP-1654 and the E2E tests at C:\Users\pkatakam\.claude\skills\jira-e2e-test-writer\Fall26\TestCases_DAP-1654_Fall26.md"

Agent steps:
1. Confirm target file path (BST CRA Regression Suite.xlsx) and E2E reference path.
2. Read target file (use cached structure, verify last TC number).
3a. Fetch DAP-1654 via Jira MCP tools.
3b. Read E2E reference markdown; build Include/Exclude list (select regression-appropriate TCs).
4. Gap analysis: check which included E2E TCs are missing from the regression suite (Jira Ref + Source idempotency check); also check ticket ACs directly.
5. Generate new TC rows for gaps only.
5.5. Create the run folder and snapshot the suite.
6. Write to file (append-only).
7. Write `change-summary.md` (ADDED/UPDATED lines, named exclusions with reasons, Jira `updated` timestamp) and print the summary.
8. Refresh the cache.
9. End with the REVIEW HANDOFF block (cycle 1).


---

## Changelog

- **2026-10-02 (v2.1):** Independent review integration. Added run modes (Normal / No review / Fix cycle) and fix-cycle mode; Step 3a records the Jira `updated` timestamp; new Step 5.5 saves a snapshot to the run folder (keeps 20); Step 6 append-only rule for xlsx (a mid-sheet insert or delete corrupts merged section titles, confirmed in testing); Step 7 writes `change-summary.md` in the reviewer-parsed format; new Step 9 emits the REVIEW HANDOFF block. Review covers `.xlsx` and `.md` targets (md writing rules added to Step 6; snapshot check uses SHA-256). Design: `skills\enhancer-review-plan.md`.

- **2026-06-25 (v2.0)** - Audit fixes: cache demoted to performance hint (actuals always authoritative), Step 8 cache refresh added, suite_info.py helper script bundled and tested, shared column contract pointer (QA-AGENTS.md), cache verified against actual file via suite_info.py.
- **2026-06-25 (earlier, v1.9)** - E2E reference file input mode (either/or with Jira tickets), JQL scope restriction, pre-write validation.
- **2026-06-16** - DAP-1654 Temp Creds Multi-Region section added to cache (rows 147-163, TCs 124-137).
