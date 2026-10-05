# Expected coverage — replay_jira (EARS)

- **Source:** `expected-coverage.md` (enhancer-review-blind v1.1, model claude-fable-5-1, written 2026-10-02T16:09:00-04:00). Converted to EARS on 2026-10-05. The source file is unchanged.
- **Inputs used by the blind pass:** snapshot=snapshot_BST CRA Regression Suite.xlsx | tickets=DAP-1654 | e2e_files=C:\Users\pkatakam\.claude\skills\jira-e2e-test-writer\Fall26\TestCases_DAP-1654_Fall26.md
- **Jira fetched:** DAP-1654 updated=2026-09-24T16:33:55.350-0400
- **Not used (by design):** live suite, change-summary.md
- **Traceability:** every requirement keeps its source ID (X-NN). Items that held two behaviours are split into X-NN.1 / X-NN.2. Evidence quotes are in `expected-coverage.md`; this file gives only the location.

## EARS patterns used

| Pattern | Template |
|---|---|
| Ubiquitous | The `<system>` shall `<response>`. |
| Event-driven | **When** `<trigger>`, the `<system>` shall `<response>`. |
| State-driven | **While** `<state>`, the `<system>` shall `<response>`. |
| Unwanted behaviour | **If** `<unwanted condition>`, **then** the `<system>` shall `<response>`. |
| Optional feature | **Where** `<feature is included>`, the `<system>` shall `<response>`. |
| Complex (extension) | Combines the keywords in the order **Where → While → When / If … then**, e.g. **While** `<state>`, **when** `<trigger>`, the `<system>` shall `<response>`. |

## System names

| Name in requirements | Meaning |
|---|---|
| temp-creds auth service | API Gateway (`dap-mc-auth`, multi-region, WAF) + `temp-creds-auth` Lambda serving `POST /auth/temp-creds` |
| legacy path | Legacy API Gateway / `authTmpCreds` / `processTmpCreds` (`da-msagwtc`) |
| Global Table | TempCredentials Global DynamoDB table, replicas us-east-1 / us-west-2 |
| Akamai | Akamai controlled endpoint (legacy vs new routing, rollback switch) |
| parallel run | Migration period in which the legacy and modern systems run at the same time |

## Boundaries

Unchanged from the source: B1 Bluebook → Akamai; B2 Akamai → API Gateway (new vs legacy); B3 Route 53 → regional API Gateway (failover/failback); B4 API Gateway → Lambda (api-key / request validation); B5 Lambda → TempCredentials Global Table; B6 Lambda → RAOTT Global Table; B7 Lambda → Catapult; B8 Lambda → Secrets Manager; B9 Lambda → SIM; B10 Legacy processTmpCreds → Global Table (dual-write); B11 Global Table us-east-1 → us-west-2 replication; B12 Lambda → CloudWatch; B13 TDTK/Atlas/Exam Player/DataGen → updated endpoint.

## Requirements

| ID | Tag | Kind | EARS pattern | Requirement | Boundaries | Evidence location | Already covered by |
|---|---|---|---|---|---|---|---|
| X-01 | Explicit | AC | Complex (While + When) | **While** us-east-1 is unavailable, **when** a student submits valid temporary credentials, the temp-creds auth service shall authenticate the student through us-west-2 with no noticeable interruption or degradation in login. | B3, B11 | DAP-1654 customfield_11048 bullet 3; description, Outcomes bullet 1 | — |
| X-02 | Explicit | AC | Event-driven | **When** a student authenticates with temporary credentials through the consolidated temp-creds auth service, the CRA test-day flow shall let the student proceed through the existing test-day steps. | B1–B7 | DAP-1654 customfield_11048 bullet 6 | Partial (UI level only, legacy-era): CRA_Tempcreds_Regr_032 (row 51); DAP_CommVal (Common Validations row 8). Neither exercises the consolidated `/auth/temp-creds` service. |
| X-03 | Explicit | AC | Ubiquitous | The Mission Control Live Support dashboard shall provide the Nimbus dashboard capabilities that Live Support relies on, signed off by Live Support before Nimbus is retired. | — | DAP-1654 customfield_11048 bullet 4; description, Scope bullet 3. The ticket names no specific capabilities. | — |
| X-04 (A) | Ambiguous | Negative | Unwanted behaviour | **If** a client requests a legacy Temp Creds endpoint, a legacy Auth/Gateway endpoint or the Nimbus dashboard after legacy sunset, **then** the platform shall refuse the request because the access path has been removed. | B2 | DAP-1654 customfield_11048 bullet 5; description, Dependent Teams | — |
| X-04 (B) | Ambiguous | Negative | State-driven | **While** the parallel run is in effect, the legacy path shall remain fully functional; decommissioning is a one-time milestone and is recorded as an exclusion from the regression suite. | B2 | description, Dependent Teams; E2E TC-DAP-1654-005 Notes | — |
| X-05 | Explicit | Boundary | Event-driven | **When** a proctor or test coordinator opens the student temporary-credentials list in TDTK, TDTK shall retrieve the credentials from the updated temp-creds endpoint and show a Sign-in Ticket / tempCreds PDF that matches the credentials that authenticate. | B13 | DAP-1654 description, Dependent Teams | Partial: CRA_Tempcreds_Regr_032–035 (rows 51–54); DAP_CommVal (row 8). These verify display, not cut-over to the updated endpoint. |
| X-06 | Explicit | Boundary | Ubiquitous | Atlas shall use the updated temp-creds endpoint for its temporary-credentials integration. | B13 | DAP-1654 description, Dependent Teams | — |
| X-07.1 | Explicit | Boundary | Event-driven | **When** a student signs in to Exam Player (Bluebook) with temporary credentials, Exam Player shall authenticate against the updated temp-creds endpoint. | B13 | DAP-1654 description, Dependent Teams | Partial (UI level): CRA_Tempcreds_Regr_038 (row 57); TESTDAY_CommVal (row 12) |
| X-07.2 | Explicit | Boundary | State-driven | **While** an exam is in progress, Exam Player shall maintain its connection back to the system after authenticating with temporary credentials. | B13 | DAP-1654 description, Dependent Teams | — |
| X-08 | Explicit | Boundary | Event-driven | **When** DataGen generates temporary credentials, DataGen shall generate and consume them through the updated temp-creds integration. | B13 | DAP-1654 description, Dependent Teams | Partial: DAP_CommVal (row 8), which checks creation in the legacy-era table only |
| X-09 | Implied | AC | Ubiquitous | The regression suite shall reference the consolidated TempCredentials Global Table, not the legacy `uat-agwtc-temp-creds` table, in CRA_Tempcreds_Regr_040. | B5 | Snapshot row 59; E2E hop 5; DAP-1654 customfield_11048 bullet 5 | CRA_Tempcreds_Regr_040 (needs update, not a new TC) |
| X-10 | Implied | Boundary | State-driven | **While** the parallel run is in effect, the platform shall authenticate a valid temporary-credentials request on either the legacy path or the temp-creds auth service. | B2 | Comment by Elvin Miranda, 2026-05-04 | — |
| X-11 | Explicit | E2E-include | Event-driven | **When** a client sends `POST /auth/temp-creds` with a valid `x-api-key` and valid temporary credentials, the temp-creds auth service shall return HTTP 200 with `code:"SUCCESS"`, `status:"authenticated"`, populated `firstName`/`lastName`/`preferredName`/`personId` and a non-empty `rmt`. | B4, B5, B6, B7 | E2E TC-DAP-1654-001, lines 49–52 | — |
| X-12 | Explicit | E2E-include | Complex (While + When) | **While** a student has a cached, unexpired RAOTT, **when** the student authenticates again with valid credentials, the temp-creds auth service shall return HTTP 200 `code:"SUCCESS"` with the cached RAOTT as `rmt` and shall not call Catapult. | B6 | E2E TC-DAP-1654-002, line 77 | — |
| X-13 | Explicit | E2E-include | Complex (While + When) | **While** a student's cached RAOTT is expired, **when** the student authenticates with valid credentials, the temp-creds auth service shall generate a new RAOTT through Catapult and return HTTP 200 `code:"SUCCESS"` with the new `rmt`. | B6, B7 | E2E TC-DAP-1654-003, line 102 | — |
| X-14 | Explicit | E2E-include | Complex (Where + When) | **Where** the `temp-creds-new-auth` feature flag is ON for a user, **when** that user's Bluebook client sends a temp-creds login, Akamai shall route the request to `/auth/temp-creds` on the new `dap-mc-auth` API Gateway, not the legacy endpoint. | B1, B2 | E2E TC-DAP-1654-004, lines 120, 127 | — |
| X-15 | Explicit | E2E-include | Complex (Where + When) | **Where** the `temp-creds-new-auth` feature flag is OFF for a user, **when** that user's Bluebook client sends a temp-creds login, Akamai shall route the request to the legacy `authTmpCreds` path, which shall authenticate with an equivalent response shape and no invocation of the new Lambda. | B1, B2 | E2E TC-DAP-1654-005, lines 153–154 | — |
| X-16 | Explicit | E2E-include | Complex (While + When) | **While** dual-write is enabled, **when** legacy `processTmpCreds` creates a credential, the platform shall write it to both the legacy table and the Global Table with identical field values, `hk`/`sk` formatted `asmtEventRegNo#<regNo>`, all GSI attributes populated and `ttl` set to `expDt` + grace, and the temp-creds auth service shall authenticate it. | B10 | E2E TC-DAP-1654-006, line 180 | — |
| X-17 | Explicit | E2E-include | Event-driven | **When** a credential is written in us-east-1, the Global Table shall replicate it to us-west-2 (target lag < 1 second), and the us-west-2 temp-creds auth service shall authenticate it with `SUCCESS`. | B8, B11 | E2E TC-DAP-1654-007, lines 207–208 | — |
| X-18 | Explicit | E2E-include | Unwanted behaviour | **If** us-east-1 becomes unavailable, **then** Route 53 shall route temp-creds traffic to us-west-2 and the temp-creds auth service shall continue to authenticate logins (target success rate ~99.9%+). Satisfies X-01. | B3 | E2E TC-DAP-1654-008, line 234; description, Success Metrics | — |
| X-19 | Explicit | E2E-include | Event-driven | **When** us-east-1 recovers after a failover, Route 53 shall route traffic back to us-east-1, and the temp-creds auth service shall authenticate credentials written in us-west-2 during the outage with no data loss. | B3, B11 | E2E TC-DAP-1654-009, lines 261–262 | — |
| X-20 | Explicit | E2E-include | Unwanted behaviour | **If** a request omits the `x-api-key` header, **then** the temp-creds auth service shall return HTTP 403 `code:"ERROR_BAD_API_KEY"` with message "Your app is not authorized to make this call" and shall not look up credentials. | B4 | E2E TC-DAP-1654-010, lines 286–287 | — |
| X-21 | Explicit | E2E-include | Unwanted behaviour | **If** a request carries an `x-api-key` that Secrets Manager does not recognise, **then** the temp-creds auth service shall return HTTP 403 `code:"ERROR_BAD_API_KEY"` and shall not proceed with authentication. | B4, B8 | E2E TC-DAP-1654-011, lines 311–312 | — |
| X-22 | Explicit | E2E-include | Unwanted behaviour | **If** the request body is missing the username, missing the password or empty, **then** the temp-creds auth service shall return HTTP 400 `code:"ERROR_BAD_CREDENTIALS"` with message "Missing credentials". | B4 | E2E TC-DAP-1654-012, line 336 | — |
| X-23 | Explicit | E2E-include | Unwanted behaviour | **If** a request has an existing username with a wrong password, **then** the temp-creds auth service shall return HTTP 401 `code:"ERROR_BAD_CREDENTIALS"` with message "Bad credentials" and increment the failed-attempt counter for that username. | B5 | E2E TC-DAP-1654-013, lines 361–362 | — |
| X-24 | Explicit | E2E-include | Unwanted behaviour | **If** failed attempts for a username reach the lockout threshold (5 per design doc; confirm with implementation), **then** the temp-creds auth service shall return HTTP 403 `code:"SECURITY_LOCKOUT"` (with a `:<minutesRemaining>` suffix when applicable) and message "Your account has been locked due to security concerns", set `isLocked=true` and increment `lockFactor`. | B5 | E2E TC-DAP-1654-014, lines 387–388, 391 | — |
| X-25 | Explicit | E2E-include | Unwanted behaviour | **If** a credential's `expDt` is at or before the current time, **then** the temp-creds auth service shall return HTTP 403 `code:"EXPIRED_CREDENTIALS"` with message "Your temporary credentials have expired". | B5 | E2E TC-DAP-1654-017, line 462 | — |
| X-26 | Explicit | E2E-include | Unwanted behaviour | **If** a credential has `actionCode` CANCELED/CANCEL or `active=false`, **then** the temp-creds auth service shall return HTTP 403 `code:"INACTIVE_CREDENTIALS"` with message "Your temporary credentials are not active". | B5 | E2E TC-DAP-1654-018, line 487 | — |
| X-27.1 | Explicit | E2E-include | Event-driven | **When** a client calls `GET /auth/temp-creds/health`, the temp-creds auth service in each region shall return HTTP 200 healthy. | B3 | E2E TC-DAP-1654-020, lines 26, 536 | — |
| X-27.2 | Explicit | E2E-include | Event-driven | **When** a client calls `GET /auth/temp-creds/health/deep`, the temp-creds auth service shall check its downstream dependencies (Global Table, RAOTT, Catapult) and report the result, and Route 53 shall use that result for failover decisions. | B3 | E2E TC-DAP-1654-020, lines 26, 536–537 | — |
| X-28.1 | Explicit | E2E-include | Ubiquitous | The temp-creds auth service shall keep plaintext passwords, hashed `pw` values and `x-api-key` values out of CloudWatch logs and responses. | B12 | E2E TC-DAP-1654-021, lines 562–563; description, Outcomes bullet 4 | — |
| X-28.2 | Explicit | E2E-include | Ubiquitous | The temp-creds auth service shall include `personId`, `catapultId` and `regNo` in its structured logs. | B12 | E2E TC-DAP-1654-021, line 563 | — |
| X-29 | Explicit | E2E-include | Unwanted behaviour | **If** Catapult or RAOTT generation is unavailable during authentication, **then** the temp-creds auth service shall return HTTP 500 `code:"ERROR_UNKNOWN_ERROR"` with no `rmt`, log the failure and shall not return `SUCCESS`. | B6, B7 | E2E TC-DAP-1654-026, line 687 | — |
| X-30 | Explicit | E2E-include | Complex (While + When) | **While** the parallel run is in effect, **when** identical requests are sent to the legacy path and the temp-creds auth service, both shall return equivalent HTTP status and `code` values for success, bad API key, bad credentials, lockout, expired and inactive cases, with a response schema that matches the API spec. Satisfies X-10. | B2 | E2E TC-DAP-1654-027, line 712 | — |
| X-31 | Explicit | E2E-include | Event-driven | **When** traffic to the new system is rolled back to 0% through Akamai or the feature flag, the platform shall continue authenticating through the legacy path without interruption, and the legacy path shall resolve credentials created during the new-system window without a data rollback. | B2, B10 | E2E TC-DAP-1654-030, line 788; E2E hop 1, line 12 | — |
| X-32 | Implied | Boundary | Complex (While + When) | **While** us-west-2 is serving temp-creds traffic, **when** a request carries a valid `x-api-key`, the us-west-2 API Gateway shall accept the key from the cross-region replica in Secrets Manager. | B8 | E2E chain table, line 20 | — |
| X-33 | Implied | Boundary | Complex (Where + When) | **Where** SIM name resolution is enabled, **when** authentication succeeds, the temp-creds auth service shall populate `firstName`, `lastName` and `preferredName` in the response. | B9 | E2E chain table, line 19; TC-DAP-1654-001 | — |
| X-34 (A) | Ambiguous | AC | Unwanted behaviour | **If** us-east-1 becomes unavailable, **then** Route 53 shall shift authentication traffic to us-west-2 in near real time (seconds). | B3 | DAP-1654 description, Success Metrics | — |
| X-34 (B) | Ambiguous | AC | Unwanted behaviour | **If** us-east-1 becomes unavailable, **then** Route 53 shall shift authentication traffic to us-west-2 within 1 minute. | B3 | E2E TC-DAP-1654-008, line 235 | — |

Ambiguous items X-04 and X-34 give one requirement per reading. Only one reading should be kept for each, and the choice needs confirmation.

## Expected exclusions (E2E TCs that should stay out of regression)

These requirements describe the behaviour each excluded TC exercises. Where marked *inferred*, the source cites only test steps, so the response is taken from the TC title rather than a stated expected result.

| E2E TC | EARS pattern | Requirement | Reason for exclusion (per regression rules) |
|---|---|---|---|
| TC-DAP-1654-015 | Unwanted behaviour | **If** a username is locked again after an auto-unlock, **then** the temp-creds auth service shall increase the lockout duration with each `lockFactor` step (1 → 2 → 3). | Lockout timing (line 409); P2 Edge |
| TC-DAP-1654-016 | Event-driven | **When** the lockout window expires, the temp-creds auth service shall unlock the account automatically. | Lockout timing (line 434); P2 Edge |
| TC-DAP-1654-019 | Unwanted behaviour | **If** a client sends a non-POST request to `/auth/temp-creds`, **then** the temp-creds auth service shall return HTTP 405. | P3 rare negative; not a P1/P2 happy path, critical negative or boundary smoke test. Optional: including it is not an R5 fail (405 is not in the excluded categories), and omitting it needs no reason. |
| TC-DAP-1654-022 | Unwanted behaviour | **If** a request contains SQL or XSS injection payloads, **then** the temp-creds auth service shall reject the request without processing the injected content. *(inferred)* | Fuzzing / one-off security scan (line 584) |
| TC-DAP-1654-023 | Unwanted behaviour | **If** the request body has empty, whitespace or null fields, a username over 10 KB or malformed JSON, **then** the temp-creds auth service shall reject the request. *(inferred)* | Deep edge case / fuzzing (lines 608–609); the empty-field 400 path is already covered by TC-012 (X-22) |
| TC-DAP-1654-024 | Complex (While + When) | **While** failed logins for one username arrive at the same time in us-east-1 and us-west-2, **when** the attempts are processed, the temp-creds auth service shall count each attempt toward the lockout threshold. *(inferred)* | Race condition (line 634) |
| TC-DAP-1654-025 | Event-driven | **When** a credential's `ttl` passes, the Global Table shall delete the record (best-effort; deletion can lag up to ~48h). | Deep edge case not repeatable in a regression window (line 666); the auth-time expiry check is covered by TC-017 (X-25) |
| TC-DAP-1654-028 | Event-driven | **When** the same successful request is replayed rapidly, the temp-creds auth service shall return consistent results for each replay. *(inferred)* | Deep edge case / race-like (line 733) |
| TC-DAP-1654-029 | State-driven | **While** under sustained (100 req/s for 1 h), peak (500 req/s for 10 min), spike (0 → 1000 req/s in 30 s) or soak (50 req/s for 24 h) load, the temp-creds auth service shall continue to authenticate requests. *(inferred)* | Load/soak/perf (line 758) |

## Information gaps seen by the blind pass

Unchanged from the source:

- The Confluence design doc the E2E file cites ("Temp Creds Multi-Region Migration Plan", Confluence page 3039363146) was not fetched; E2E "Source" references such as "Testing Strategy → Failure Path #1", "Handler step 3", "API Spec error table" cannot be checked against the primary source. Error codes, field names and GSI names are therefore traceable only to the E2E file, not to the ticket.
- DAP-1654 has no field labelled "Acceptance Criteria"; the AC-style bullets quoted in the source live in `customfield_11048`. The description has no AC heading.
- Fix version mismatch: Jira `fixVersions` = "DAP: Jan 7 2027" (due date 2026-05-28); the E2E file header says "**Fix Versions:** DAP-Jun_25_2026, DAP-Aug_13_2026". The ticket was updated 2026-09-24, after the E2E file was likely written.
- The ticket names no specific Nimbus / Live Support dashboard capabilities, so X-03 can only be covered at the level the ticket states.
- The ticket gives no error codes, thresholds, endpoint names, or table names; all such detail comes from the E2E file.
- No attachments, remote links or issue links on DAP-1654 (all empty), so nothing was skipped for lack of access.
- No instruction-like content was found in the ticket, comment or E2E file; nothing was discarded under the untrusted-content rule.
