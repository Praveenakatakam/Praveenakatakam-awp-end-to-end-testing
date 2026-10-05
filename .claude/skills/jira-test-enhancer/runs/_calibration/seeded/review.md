# Review — seeded — cycle 1

**Verdict: FAIL — roll back recommended**
**Recommended action:** Restore `C:\Users\pkatakam\.claude\skills\jira-test-enhancer\runs\_calibration\seeded\snapshot_BST CRA Regression Suite.xlsx` over `C:\Users\pkatakam\.claude\skills\jira-test-enhancer\runs\_calibration\live\seeded.xlsx` — only after you confirm.

- **Reviewer:** enhancer-review-reconcile v1.1, model claude-fable-5-1, 2026-10-02T18:30:00Z
- **Blind pass:** verified (expected-coverage.md written 2026-10-02T18:23:13Z / file time 2026-10-02 14:25:06 local, before this review started 14:27:14 local; header contains `Not used (by design): live suite, change-summary.md`)
- **Jira timestamps:** N/A — hand-off `tickets: none`; neither pass fetched Jira. All R1 evidence is from the E2E file `C:\Users\pkatakam\.claude\skills\jira-e2e-test-writer\Fall26\TestCases_DAP-1654_Fall26.md` and the snapshot.

## Needs your decision
- D-01 — X-08 (Ambiguous) temp-creds-auth Lambda → SIM boundary — Reading A: SIM is a named hop with an owning team, so a boundary check is expected. Reading B: hop is "Optional name resolution" and no E2E TC exercises SIM, so no dedicated regression TC is needed. The enhancer added nothing SIM-related and recorded no SIM exclusion. — evidence: E2E Integration Chain table hop 8 "SIM (Student Info Manager) | SIM team | Optional name resolution"; change-summary.md Exclusions list contains no SIM entry.
- D-02 — X-29 (Ambiguous) TC-DAP-1654-019 non-POST → 405 — Reading A: include (named error code, cheap assertion). Reading B: exclude (P3 rare edge). The enhancer chose Reading B: "E2E TC-DAP-1654-019 — 405 method check is cosmetic (P3)". — evidence: E2E TC-019 "**Priority** | P3"; change-summary.md Exclusions line 31.
- D-03 — Recorded exclusions the blind pass expected to be included. These are cleared as misses because each is named with a reason (spec §7.5), but the blind pass tagged all of them Explicit E2E-include and three are P1 critical negatives / P2 happy paths, so you may want them back in: (a) X-26 TC-DAP-1654-014 lockout → 403 SECURITY_LOCKOUT (P1) excluded as "lockout timing; confirm 5th-attempt threshold with dev team first" — the blind pass also flagged "Exact threshold (5) per design doc; confirm with implementation." (TC-014 Notes); (b) X-32 TC-DAP-1654-026 Catapult down → 500 ERROR_UNKNOWN_ERROR, no partial SUCCESS (P1) excluded as "Catapult 500 failure injection (deep edge)"; (c) X-14 / X-15 TC-DAP-1654-002 / -003 cached and expired RAOTT (P2 happy) excluded as "RAOTT cache internals; not a regression-level handoff" — note these are the only E2E TCs that exercise the Lambda → RAOTT table and Lambda → Catapult boundaries (X-06, X-07), so with TC-001 also missing (F-05) those two boundaries currently have no covering TC at all.

## Findings
| ID | Check | Severity | TC / row | Finding | Evidence |
|---|---|---|---|---|---|
| F-01 | R8 | Critical | Header row 149 (new section "Temp Creds Multi-Region Auth Scenarios (DAP-1654)") | Header row under the new section is not bold with the D9E1F2 fill | diff.txt line 13: "HEADER ROW not styled (bold + D9E1F2 fill) at row 149"; live row 149 = `TC Name | Scenario | Stay in Regression | Test Steps | Expected Result` |
| F-02 | R1 | Critical | CRA_TempcredsMR_Regr_131 (row 157) | Expected Result adds an error code, HTTP status and scenario that appear in no source | diff.txt line 100: "_Region-mismatched credential login returns HTTP 409, code=ERROR_REGION_MISMATCH"; not in E2E TC-017/-018 (only EXPIRED_CREDENTIALS / INACTIVE_CREDENTIALS, both 403); read-only search of all three snapshot sheets for "REGION_MISMATCH" and "409" returned no hits; no ticket; change-summary "User-stated inputs: none" |
| F-03 | R10 | Major | CRA_TempcredsMR_Regr_138 | change-summary claims an ADDED TC that is not in the suite | diff.txt line 16: "claimed ADDED but not added: CRA_TempcredsMR_Regr_138"; change-summary.md line 22 "ADDED: CRA_TempcredsMR_Regr_138 — [source: E2E TC-DAP-1654-008]"; diff "added=14" vs 15 ADDED lines |
| F-04 | R4 | Major | CRA_TempcredsMR_Regr_136 (row 162) duplicates CRA_TempcredsMR_Regr_129 (row 155) | New TC is an exact duplicate of another new TC: identical Test Steps and Expected Result; Scenario differs only by the suffix "- repeat check" | diff.txt line 19 "similarity 0.99"; lines 76-80 vs 137-141 are character-identical; line 135 Scenario "...(Secrets Manager rejects key) - repeat check" |
| F-05 | R2 | Major | X-13 — E2E TC-DAP-1654-001 (Happy, P1) | Core happy path on the new endpoint (valid key + valid creds → 200 SUCCESS with RAOTT) has no covering TC and no recorded exclusion. The only reference to TC-001 is the Expected Result appended to CRA_Tempcreds_Regr_032, whose steps are the legacy Bluebook flow, not `POST /auth/temp-creds` | E2E TC-001 Expected Result "HTTP 200; body `code:"SUCCESS"`, `status:"authenticated"`… non-empty `rmt`"; no added TC in diff.txt asserts SUCCESS/200/rmt on `/auth/temp-creds` directly; change-summary Exclusions do not name TC-001; snapshot row 51 steps "1. Create a new Reg (PN) 2. Login and complete setup…" |
| F-06 | R2 | Major | X-20 — E2E TC-DAP-1654-008 (Happy, P1) | Regional failover us-east-1 → us-west-2 has no covering TC and no recorded exclusion; the summary claims it as _138 but that TC does not exist | E2E TC-008 Expected Result "Traffic automatically routes to us-west-2; logins continue to succeed."; diff.txt line 16; no added TC in diff.txt simulates a us-east-1 outage |
| F-07 | R3 | Major | X-03 — Route 53 → regional API Gateway failover boundary | The failover half of the boundary has no covering TC; _128 covers only failback ("Restore us-east-1 health") and _135 only health responses | E2E hop 2 "Route 53 | Mission Control / Infra | Health-check-based regional failover (us-east-1 → us-west-2)"; diff.txt lines 67-72 (_128) and 128-133 (_135); no exclusion recorded for failover |
| F-08 | R5 | Minor | CRA_TempcredsMR_Regr_137 (row 163) | Brings in E2E TC-023, which the regression rules exclude as deep edge / fuzzing and which the blind pass listed under expected exclusions | diff.txt line 146 "_POST with username "", then "   " (whitespace), then null, then a >10KB username string" and line 147 "_POST with a malformed JSON body"; expected-coverage.md Expected exclusions row TC-DAP-1654-023 |
| F-09 | R6 | Minor | CRA_TempcredsMR_Regr_124 (row 150) | Priority recorded as P3 for a P1 core happy-path handoff | diff.txt line 26 "Scenario: Priority: P3 — DAP-1654 Integration handoff - Akamai routes to NEW API Gateway…"; E2E TC-004 "**Priority** | P1", "**Category** | Happy" |
| F-10 | R7 | Minor | CRA_Tempcreds_Regr_032 (row 51) | Existing TC changed with no `[UPDATED by DAP-1654 on {date}]` notice | diff.txt line 152 "[UPDATED by …] notice present: NO"; live row 51 col E = "\n_Username lookup served via gsiUsrnameIx" |
| F-11 | R7 | Minor | CRA_Tempcreds_Regr_032 (row 51) | The appended expectation does not belong to the TC's original scenario: the TC exercises the legacy Bluebook/TDTK login, which never queries the new table's `gsiUsrnameIx` | snapshot row 51 steps "1. Create a new Reg (PN) 2. Login and complete setup (exam setup complete) 3. Send an update for the reg 4. Login and ensure the same temp creds still work"; expected "Verify if the TDTK Sign-in Ticket matches the temp creds."; appended "_Username lookup served via gsiUsrnameIx" is from E2E TC-001 on `POST /auth/temp-creds` |
| F-12 | R9 | Minor | CRA_TempcredsMR_Regr_132 (row 158) | Expected Result cannot be checked; the concrete assertions from the E2E source were dropped | diff.txt line 107 "Expected Result: _System works correctly and logs look fine"; E2E TC-021 Expected Result "No plaintext password, hashed `pw`, or `x-api-key` value appears in logs or responses." / "Structured logs include `personId`, `catapultId`, `regNo` for traceability." |
| F-13 | R9 | Minor | CRA_TempcredsMR_Regr_135 (row 161) | Cross-reference points at the wrong TC: _129 is the x-api-key negative test, not a failover test; the E2E source links to TC-008, which was not added | diff.txt line 133 "_Deep health failure drives failover (links to TC 129)"; diff.txt line 74 (_129 Scenario "Missing or invalid x-api-key…"); E2E TC-020 Notes "Deep health failure should drive failover (link to TC-008)." |

## Checklist
| Check | Result | Reason |
|---|---|---|
| R1 | FAIL | _131 adds `HTTP 409` / `ERROR_REGION_MISMATCH` found in no source (F-02). All other details in _124–_137 and the _032 update trace to the E2E file or the snapshot (`DAP_Validations` in _126 matches existing step wording, e.g. snapshot row 10 "_All steps are validated from DAP_Validations test case"; `gsiUsrnameIx` is in E2E TC-001). |
| R2 | FAIL | X-13 (TC-001 P1 happy path) and X-20 (TC-008 failover) have no covering TC and no recorded exclusion (F-05, F-06). |
| R3 | FAIL | Route 53 failover boundary X-03 uncovered (F-07). Other boundaries covered or excluded with reason (see reconciliation). |
| R4 | FAIL | _136 confirmed as an exact duplicate of _129 (F-04). No other new TC duplicates an existing or new TC. |
| R5 | FAIL | _137 brings in excluded-class E2E TC-023 (F-08). The omitted P1 happy path TC-001 is already graded under R2 (F-05) and not double-counted here. Other exclusions (TC-015, -016, -022, -024, -025, -028, -029) match the regression rules and the blind pass's expected exclusions. |
| R6 | FAIL | _124 carries "Priority: P3" against E2E P1 (F-09). No other added TC records a priority in the xlsx, so the rest is N/A by format. |
| R7 | FAIL | _032 changed without `[UPDATED by …]` notice (F-10) and the change does not fit the original legacy-flow scenario (F-11). |
| R8 | FAIL | From suite_diff.py: header row 149 under the new section not styled bold + D9E1F2 (F-01). No TC removed/reordered, no duplicate ID, numbering 124–137 continues from max 123, no archived family used, other sheets unchanged. |
| R9 | FAIL | _132 Expected Result uncheckable (F-12); _135 wrong cross-reference (F-13). Remaining steps/expected results are concrete and checkable. |
| R10 | FAIL | From suite_diff.py: claimed ADDED CRA_TempcredsMR_Regr_138 is not in the suite (F-03). The 14 other ADDED lines and the one UPDATED line match the diff. |

## Coverage reconciliation
| Expected item | Tag | Covered by | Status |
|---|---|---|---|
| X-01 | Explicit | CRA_TempcredsMR_Regr_124, _125 | covered |
| X-02 | Explicit | CRA_TempcredsMR_Regr_124, _125 | covered |
| X-03 | Explicit | — (_128 failback only; _135 health only) | missed (F-07) |
| X-04 | Explicit | CRA_TempcredsMR_Regr_129 | covered |
| X-05 | Explicit | CRA_TempcredsMR_Regr_130, _131 | covered (state checks `expDt`, `actionCode`, `active`, failed-attempt counter; `gsiUsrnameIx` only via the misplaced _032 update) |
| X-06 | Explicit | — | excluded (TC-002/-003 "RAOTT cache internals; not a regression-level handoff") — see D-03 |
| X-07 | Explicit | — | excluded (TC-026 "Catapult 500 failure injection (deep edge)") — see D-03 |
| X-08 | Ambiguous | — | ambiguous (D-01) |
| X-09 | Explicit | CRA_TempcredsMR_Regr_129 | covered |
| X-10 | Explicit | CRA_TempcredsMR_Regr_126 | covered |
| X-11 | Explicit | CRA_TempcredsMR_Regr_132 | covered — weakly; steps match but expected result uncheckable (F-12) |
| X-12 | Explicit | CRA_TempcredsMR_Regr_127 | covered |
| X-13 | Explicit | — | missed (F-05) |
| X-14 | Explicit | — | excluded (TC-002 "RAOTT cache internals") — see D-03 |
| X-15 | Explicit | — | excluded (TC-003 "RAOTT cache internals") — see D-03 |
| X-16 | Explicit | CRA_TempcredsMR_Regr_124 | covered |
| X-17 | Explicit | CRA_TempcredsMR_Regr_125 | covered |
| X-18 | Explicit | CRA_TempcredsMR_Regr_126 | covered |
| X-19 | Explicit | CRA_TempcredsMR_Regr_127 | covered |
| X-20 | Explicit | — (_138 claimed, not present) | missed (F-06) |
| X-21 | Explicit | CRA_TempcredsMR_Regr_128 | covered |
| X-22 | Explicit | CRA_TempcredsMR_Regr_129 | covered |
| X-23 | Explicit | CRA_TempcredsMR_Regr_129 | covered |
| X-24 | Explicit | CRA_TempcredsMR_Regr_130 | covered |
| X-25 | Explicit | CRA_TempcredsMR_Regr_130 | covered |
| X-26 | Explicit | — | excluded (TC-014 "lockout timing; confirm 5th-attempt threshold with dev team first") — see D-03 |
| X-27 | Explicit | CRA_TempcredsMR_Regr_131 | covered (plus unsourced 409 line, F-02) |
| X-28 | Explicit | CRA_TempcredsMR_Regr_131 | covered (plus unsourced 409 line, F-02) |
| X-29 | Ambiguous | — | ambiguous (D-02); enhancer excluded TC-019 "cosmetic (P3)" |
| X-30 | Explicit | CRA_TempcredsMR_Regr_135 | covered |
| X-31 | Explicit | CRA_TempcredsMR_Regr_132 | covered — weakly (F-12) |
| X-32 | Explicit | — | excluded (TC-026 "deep edge") — see D-03 |
| X-33 | Explicit | CRA_TempcredsMR_Regr_133 | covered |
| X-34 | Explicit | CRA_TempcredsMR_Regr_134 | covered |

## Enhancer additions with no matching expected item
- CRA_TempcredsMR_Regr_136 — checked under R1 (traceable to E2E TC-010/-011); exact duplicate of _129 (F-04).
- CRA_TempcredsMR_Regr_137 — checked under R1 (traceable to E2E TC-023: "", whitespace, null, >10KB, malformed JSON, "400, not 500", "no stack trace leaked"); regression rules exclude this class (F-08).
