# Review — replay_jira — cycle 1

**Verdict: FAIL — fix recommended**
**Recommended action:** Send F-01, F-02, F-03, F-04 (Major) and F-05, F-06 (Minor) to the enhancer via FIX HANDOFF; no rollback needed (no Critical).

- **Reviewer:** enhancer-review-reconcile v1.1, model claude-fable-5-1, 2026-10-02T16:20:00-04:00
- **Blind pass:** verified (expected-coverage.md written 2026-10-02 16:14:07, before this review started 16:15:08; header carries "Not used (by design): live suite, change-summary.md")
- **Jira timestamps:** differ — blind pass and this re-fetch both read `DAP-1654 updated=2026-09-24T16:33:55.350-0400`; change-summary.md records `updated=2026-06-16T11:04:00.000-0400` (self-declared stand-in: "the 2026-06-16 enhancement predates timestamp recording; the ticket was edited 2026-09-24")

## Needs your decision
- D-01 — Ticket changed after enhancement — The enhancer worked from the 2026-06-16 state of DAP-1654; the ticket was edited 2026-09-24 (current `updated`). The re-fetched description, `customfield_11048` and the single comment match every quote in expected-coverage.md, so the content the review relied on is current, but the enhancer's TCs predate the edit — evidence: change-summary.md line 4; getJiraIssue `updated` = 2026-09-24T16:33:55.350-0400.
- D-02 — X-04 (Ambiguous) Legacy sunset — Reading A: regression should include a post-sunset check that legacy Temp Creds / legacy Auth and Gateway endpoints and the Nimbus dashboard are no longer reachable ("Legacy Temporary Credentials, legacy Auth and Gateway, and the Nimbus dashboard are decommissioned, including infrastructure, access paths", customfield_11048 bullet 5). Reading B: decommissioning is a one-time milestone, out of scope while the parallel run is in effect ("legacy path must remain fully functional during migration", E2E TC-DAP-1654-005 line 157); CRA_TempcredsMR_Regr_126/135/136 all require legacy to be live. No TC and no exclusion was written for either reading.
- D-03 — X-34 (Ambiguous) Failover-time target — CRA_TempcredsMR_Regr_129 expected result states "Failover time near real-time (target < 1 minute)" (diff.txt line 83, from E2E TC-DAP-1654-008 line 235); the ticket's Success Metric says "target: near real-time / seconds" (description). The TC is traceable to the E2E file, so not an R1 fail, but the regression target should be confirmed as 1 minute or seconds.
- D-04 — X-09 (Implied) disagreement — Blind pass expects CRA_Tempcreds_Regr_040 (Scenario: "temp Creds created in the new Dynamo DB table uat-agwtc-temp-creds") to be updated to point at the consolidated table. Reconcile reading: during the parallel run the legacy table remains populated by dual-write ("Record present in BOTH tables with identical field values", E2E TC-DAP-1654-006 line 180; carried into CRA_TempcredsMR_Regr_127), so the existing TC is still correct until sunset. Not counted as a finding; decide whether to update 040 now or at sunset.
- D-05 — Exclusion of two P1 critical negatives — change-summary.md excludes E2E TC-DAP-1654-014 (lockout → `SECURITY_LOCKOUT`; "lockout timing; confirm 5th-attempt threshold with dev team first") and TC-DAP-1654-026 (Catapult/RAOTT down → 500 `ERROR_UNKNOWN_ERROR`, "no partial success"; "Catapult 500 failure injection (deep edge)"). Both are P1 Negative in the E2E file (lines 374–375, 674–675) and the blind pass expected both (X-24, X-29). The recorded reasons clear the miss under spec §7.5, but "deep edge" for TC-026 conflicts with the E2E's P1 critical-negative classification, and TC-014's threshold caveat is also noted in the E2E ("confirm with implementation", line 391) without the E2E treating it as a reason to drop the test. Decide whether either should be added.
- D-06 — Exclusion of TC-DAP-1654-002 / -003 (X-12, X-13, P2 Happy) — excluded as "RAOTT cache internals; not a regression-level handoff". Reasoned exclusion; the blind pass listed them as expected includes. Low impact; noted for completeness.

## Findings
| ID | Check | Severity | TC / row | Finding | Evidence |
|---|---|---|---|---|---|
| F-01 | R2 | Major | X-03 (no TC) | Explicit AC "Live Support dashboard workflows" has no covering TC and no recorded exclusion or information gap | DAP-1654 customfield_11048 bullet 4: "Nimbus dashboard capabilities required by Live Support are available in the Mission Control Live Support dashboard and signed off by Live Support before Nimbus is retired"; bullet 6: "Full end-to-end regression performed against the consolidated flow, including failover scenarios and Live Support dashboard workflows". None of the 14 added TCs (diff.txt lines 24–154) mentions Live Support, Nimbus or Mission Control dashboard; change-summary.md Exclusions (lines 24–36) list only E2E TC IDs; Information gaps = "none" (line 39) |
| F-02 | R3 | Major | X-05 (no TC) | Boundary B13 TDTK → updated endpoint has no covering TC and no recorded exclusion | DAP-1654 description, Dependent Teams: "will need to move to the updated endpoint as part of this work … **Test Day Toolkit (TDTK):** retrieves the list of student temporary credentials for display to proctors and test coordinators". No added TC references TDTK (diff.txt lines 24–154); existing CRA_Tempcreds_Regr_032–035 check Sign-in Ticket display only, against the legacy-era service (expected-coverage.md X-05). Not in change-summary.md Exclusions |
| F-03 | R3 | Major | X-06 (no TC) | Boundary B13 Atlas → updated endpoint has no covering TC and no recorded exclusion | DAP-1654 description, Dependent Teams: "**Atlas:** verified temporary credentials integration". No added TC references Atlas (diff.txt lines 24–154); not in change-summary.md Exclusions |
| F-04 | R3 | Major | X-08 (no TC) | Boundary B13 DataGen → updated endpoint has no covering TC and no recorded exclusion | DAP-1654 description, Dependent Teams: "**DataGen:** generates and consumes temporary credentials through this integration". No added TC references DataGen (diff.txt lines 24–154); CRA_TempcredsMR_Regr_127 tests legacy `processTmpCreds` dual-write, not DataGen consuming the updated endpoint; DAP_CommVal row 8 "_ Verify Data Gen Dynamo for TempCredentials creation" is the legacy-era check. Not in change-summary.md Exclusions |
| F-05 | R9 | Minor | CRA_TempcredsMR_Regr_137 (row 163) | Expected result "returns accordingly" cannot be checked as written; no pass/fail criterion for deep health | diff.txt line 153: "_Deep health validates downstream dependencies (table, RAOTT, Catapult) and returns accordingly" (carried verbatim from E2E TC-DAP-1654-020 line 537) |
| F-06 | R9 | Minor | CRA_TempcredsMR_Regr_124 (row 150) | Step "_Execute DAP_Validations test case to confirm temp cred and RAOTT flow" points at a common validation that has no RAOTT check, so the RAOTT part of the step cannot be carried out through it | diff.txt line 30; snapshot Common Validations row 8 (DAP_CommVal) lists "_ Verify Data Gen Dynamo for TempCredentials creation…", "_Verify that TempCreds are created based on Reg#…" and no RAOTT/Catapult step |

## Checklist
| Check | Result | Reason |
|---|---|---|
| R1 | PASS | Every endpoint, header, flag, error code, message, table/GSI name, region, metric and system in CRA_TempcredsMR_Regr_124–137 traces to TestCases_DAP-1654_Fall26.md (TC-001, -004 to -013, -017, -018, -020, -021, -027, -030) or to the snapshot convention "_Execute SSOR_Validations test case" (e.g. CRA_Happypath_Regr_001). `< 1 minute` in 129 traces to E2E line 235 (see D-03). No detail found in none of the sources |
| R2 | FAIL | X-03 (Explicit AC) missed with no exclusion → F-01. X-12, X-13, X-24, X-29 excluded with recorded reasons (D-05, D-06). X-09 is a Pass 1 / reconcile disagreement (D-04), not a finding |
| R3 | FAIL | B13 consumer boundaries X-05, X-06, X-08 missed with no exclusion → F-02, F-03, F-04. X-07 covered by 125; X-10 by 126 + 135; X-32 by 128/129; X-33 by 124 |
| R4 | PASS | suite_diff.py lists no candidates ≥ 0.90; new TCs checked against each other: 131 (010+011), 132 (012+013), 133 (017+018) merge distinct E2E TCs into single TCs with distinct scenarios; 125 vs 126 and 129 vs 130 test opposite directions |
| R5 | PASS | No excluded-category E2E TC was brought in (015/016 lockout timing, 022 injection, 023 fuzzing, 024 race, 025 TTL, 028 replay, 029 load all stay out, matching the blind pass's expected exclusions). P1/P2 TCs left out (002, 003, 014, 026) each have a recorded reason in change-summary.md; reason quality raised under D-05/D-06 |
| R6 | N/A | xlsx columns are `TC Name | Scenario | Stay in Regression | Test Steps | Expected Result`; no priority or category recorded anywhere in the sheet (0 rows mention P1/P2/P3/Priority) |
| R7 | N/A | diff.txt: changed=0; no existing TC was modified |
| R8 | PASS | suite_diff.py: "no integrity problems found" — 14 TCs added at rows 150–163 under new section "Temp Creds Multi-Region Auth Scenarios (DAP-1654)", IDs 124–137 continue from 123, no removals/reorders, other sheets unchanged |
| R9 | FAIL | F-05 (137 "returns accordingly"), F-06 (124 DAP_Validations step cannot confirm RAOTT). All other steps executable and expected results checkable (explicit HTTP codes, `code` values, messages, table fields) |
| R10 | PASS | suite_diff.py: 14 `- ADDED:` lines match the 14 added TCs; no `- UPDATED:` lines and no changed TCs |

## Coverage reconciliation
| Expected item | Tag | Covered by | Status |
|---|---|---|---|
| X-01 | Explicit | CRA_TempcredsMR_Regr_129 | covered |
| X-02 | Explicit | CRA_TempcredsMR_Regr_124, 125 (auth through consolidated `/auth/temp-creds`; 124 chains into DAP_Validations) | covered (Live Support part tracked as X-03) |
| X-03 | Explicit | — | missed (F-01) |
| X-04 | Ambiguous | — | ambiguous (D-02) |
| X-05 | Explicit | — | missed (F-02) |
| X-06 | Explicit | — | missed (F-03) |
| X-07 | Explicit | CRA_TempcredsMR_Regr_125 (Bluebook client → new GW, end-to-end SUCCESS) | covered |
| X-08 | Explicit | — | missed (F-04) |
| X-09 | Implied | CRA_Tempcreds_Regr_040 (unchanged) | ambiguous — Pass 1 / reconcile disagreement (D-04) |
| X-10 | Implied | CRA_TempcredsMR_Regr_126, 135 | covered |
| X-11 | Explicit | CRA_TempcredsMR_Regr_124 | covered |
| X-12 | Explicit | — | excluded ("RAOTT cache internals; not a regression-level handoff") |
| X-13 | Explicit | — | excluded ("RAOTT cache internals; not a regression-level handoff") |
| X-14 | Explicit | CRA_TempcredsMR_Regr_125 | covered |
| X-15 | Explicit | CRA_TempcredsMR_Regr_126 | covered |
| X-16 | Explicit | CRA_TempcredsMR_Regr_127 | covered |
| X-17 | Explicit | CRA_TempcredsMR_Regr_128 | covered |
| X-18 | Explicit | CRA_TempcredsMR_Regr_129 | covered |
| X-19 | Explicit | CRA_TempcredsMR_Regr_130 | covered |
| X-20 | Explicit | CRA_TempcredsMR_Regr_131 | covered |
| X-21 | Explicit | CRA_TempcredsMR_Regr_131 | covered |
| X-22 | Explicit | CRA_TempcredsMR_Regr_132 | covered |
| X-23 | Explicit | CRA_TempcredsMR_Regr_132 | covered |
| X-24 | Explicit | — | excluded ("lockout timing; confirm 5th-attempt threshold with dev team first") — see D-05 |
| X-25 | Explicit | CRA_TempcredsMR_Regr_133 | covered |
| X-26 | Explicit | CRA_TempcredsMR_Regr_133 | covered |
| X-27 | Explicit | CRA_TempcredsMR_Regr_137 | covered |
| X-28 | Explicit | CRA_TempcredsMR_Regr_134 | covered |
| X-29 | Explicit | — | excluded ("Catapult 500 failure injection (deep edge)") — see D-05 |
| X-30 | Explicit | CRA_TempcredsMR_Regr_135 | covered |
| X-31 | Explicit | CRA_TempcredsMR_Regr_136 | covered |
| X-32 | Implied | CRA_TempcredsMR_Regr_128 step 4 / 129 (us-west-2 endpoint accepts the key) | covered |
| X-33 | Implied | CRA_TempcredsMR_Regr_124 ("firstName/lastName/preferredName/personId populated") | covered |
| X-34 | Ambiguous | CRA_TempcredsMR_Regr_129 uses E2E reading (< 1 minute) | ambiguous (D-03) |

## Enhancer additions with no matching expected item
- none — all 14 added TCs (CRA_TempcredsMR_Regr_124–137) map to expected items X-11 to X-31.
