# Requirements — adversarial-results-ui

**Status:** Active — requirements (v0.2.0 — revised after adversarial review 2026-10-21)
**Version:** 0.2.0
**Date:** 2026-10-21
**Depends on:** odcs-contract-registry (spec v0.6.2)

**Changes from v0.1.0:** Fixed BLK-1 (state exit conditions), BLK-2 (verdict source), BLK-3 (route + branch sanitisation), BLK-4 (write ordering + atomicity), BLK-5 (IAM boundary). Fixed HR-8 (scope field), HR-9 (kind attribute naming), HR-12 (run_dir sanitisation), HR-18 (outputs.json keys), HR-20 (auth status codes), HR-22 (IAM grant conflicts), HR-26 (empty-run guard). Minor: CN-4 (PK prefix), HR-7 (inProductRef spelling), HR-10 (explicit response type).

---

## 1. Context

The adversarial review agents (`adversarial-test-review` and `adversarial-code-review`) produce structured JSON findings locally in `.adversarial-review/{YYYYMMDD-HHMM}_{test|code}_{branch}/`. There is no deployed surface for these results. This spec extends the existing SPA and API stack to store and display adversarial findings.

**Key fact (confirmed by reading the finalize script):** `scripts/adversarial-review-finalize.ts` already merges Pass 3 verification verdicts into each finding inside `review.json` (`findings[i].verification = { verdict, reason, evidence }`) and writes a top-level `verification.status: "ok" | "stale" | "invalid" | "not_run"`. The API reads `review.json` only; `verification.json` is uploaded as an archive artifact.

User decision (2026-10-21): test-review and code-review use **separate sub-tabs**.
User decision (2026-10-21): `kind` query parameter is **required** for the list route (CN-20).

---

## 2. Actors

| Actor | Definition |
|---|---|
| Reader | Authenticated Cognito user in the `reader` group |
| Writer | Authenticated Cognito user in the `writer` group (superset of reader) |
| Finalize script | `scripts/adversarial-review-finalize.ts` — runs locally on a developer workstation after a review pass |

---

## 3. Requirements

### 3.1 Run-folder sanitisation (pre-condition for upload and API routing)

**R-0** Both `adversarial-test-review` and `adversarial-code-review` skills SHALL replace every `/` in the branch or range name with `-` when constructing `run_dir`, so that `run_dir` matches the pattern `^\d{8}-\d{4}_(test|code)_[A-Za-z0-9._-]+$` and contains no path separators.

> Rationale: `adversarial-test-review` already does this. Requiring it of both skills means `run_dir` is a single path segment suitable for use in URL paths and DynamoDB sort keys. It also prevents duplicate run_dirs (`feature/x` and `feature-x` colliding) — that edge case is accepted as a known limitation.

### 3.2 Storage — finalize script upload

**R-1** WHEN `adversarial-review-finalize` completes successfully for a run, the finalize script SHALL upload `review.json` and (if present) `verification.json` to S3 `ContractsBucket` under key prefix `adversarial-runs/{kind}/{run_dir}/`. `kind` ∈ `{test, code}`; `run_dir` satisfies the R-0 pattern.

**R-1a** The finalize script SHALL write files in this order: `review.json` first, then `verification.json` (if present), then the DynamoDB run-summary item. The DynamoDB item is the commit marker for the run.

**R-2** WHEN the finalize script uploads a run to S3, it SHALL write a run-summary item to the DynamoDB `Registry` table with:
- `PK = ADV#{kind}` (e.g. `ADV#test`)
- `SK = {run_dir}`
- `reviewKind` = `test` or `code` (API-facing kind value, separate from the GSI kind below)
- `kind` = `ADVERSARIAL_TEST` or `ADVERSARIAL_CODE` (used as `byKind` GSI PK — disjoint from `CRAWL`, `GENERATION`, `FUNCTIONAL_GEN`)
- `startedAt` = the `pass1WrittenAt` or `finalizedAt` ISO-8601 timestamp from `review.json` (not parsed from the folder name)
- `run_dir`, `scope` (= `review.json.scope` verbatim), `verdict` (= `review.json.verdict`), `countCritical`, `countMajor`, `countMinor`, `model`
- `verificationStatus` = `review.json.verification.status` (`"ok"` | `"stale"` | `"invalid"` | `"not_run"`)
- `reviewSha256` = hex SHA-256 of the uploaded `review.json` bytes
- `verificationSha256` = hex SHA-256 of the uploaded `verification.json` bytes (omitted when not uploaded)

**R-3** IF any upload step fails (S3 or DynamoDB), THEN the finalize script SHALL NOT write later steps, SHALL print to stderr which steps succeeded and what failed (including the `run_dir`), and SHALL exit with a non-zero code. The review report already printed to stdout SHALL NOT be suppressed.

**R-3a** A re-upload of the same `run_dir` SHALL be idempotent: the script SHALL overwrite S3 objects unconditionally and use an unconditional `PutItemCommand` to overwrite the DynamoDB item.

**R-4** WHEN no local `verification.json` exists for the run, the finalize script SHALL NOT attempt to delete a previously uploaded `verification.json` from S3 and SHALL set `verificationStatus = review.json.verification.status` (which will be `"stale"` or `"not_run"` in this case, per the existing finalize logic).

**R-5** The finalize script SHALL provide an `upload <run_dir>` subcommand that uploads an existing completed run's artifacts without re-running finalize (for recovery from upload failures). It SHALL be idempotent.

**R-6** The finalize script SHALL resolve the target S3 bucket name and DynamoDB table name from environment variables `ADVERSARIAL_BUCKET` and `ADVERSARIAL_TABLE` (primary), falling back to the `ContractsBucketName` and `RegistryTableName` keys in `.sst/outputs.json` for the configured stage. IF neither source resolves THEN the script SHALL print a warning to stderr with guidance and exit with code 3. A deliberate skip is expressed with `--no-upload`, which exits with code 0.

### 3.3 Storage — IAM boundary

**R-7** The IAM principal used by the finalize script upload SHALL be granted only:
- `s3:PutObject` on `ContractsBucket` with key prefix condition `adversarial-runs/*`
- `dynamodb:PutItem` on the `Registry` table with `dynamodb:LeadingKeys` condition restricting to `ADV#test` and `ADV#code`

All other S3 and DynamoDB write actions on those resources SHALL be denied to that principal.

### 3.4 API — adversarial runs

**R-8** WHEN the API receives `GET /adversarial-runs?kind={test|code}` with a valid reader or writer Cognito token, it SHALL return a JSON array of `AdversarialRunSummary` objects for runs of that kind, ordered by `startedAt` descending. Each object SHALL contain exactly: `reviewKind`, `run_dir`, `startedAt`, `scope`, `verdict`, `countCritical`, `countMajor`, `countMinor`, `verificationStatus`. The handler SHALL NOT pass through other DynamoDB attributes.

**R-8a** IF the `kind` query parameter is absent or is not exactly `"test"` or `"code"` (case-sensitive), THEN the API SHALL return HTTP 400 `{"error":"invalid_kind"}`.

**R-8b** IF the `byKind` GSI query for one kind fails, THEN the API SHALL return HTTP 502 `{"error":"list_unavailable"}` and SHALL NOT return a partial list.

**R-9** WHEN the API receives `GET /adversarial-runs/{kind}/{run_dir}/findings` with a valid reader or writer token, it SHALL:
1. Validate that `kind` ∈ `{"test","code"}` and `run_dir` matches the R-0 pattern; if not → 400.
2. `GetItemCommand` on the DynamoDB run-summary item (`ADV#{kind}`, `{run_dir}`); if not found → 404 `{"error":"run_not_found"}`.
3. `GetObjectCommand` for `review.json` from S3; if not found → 404 `{"error":"artifact_not_found"}`; if S3 error other than NoSuchKey → 502; if the body is not valid JSON or lacks a `findings` array → 422 `{"error":"artifact_corrupt","run_dir":"..."}`.
4. Compute SHA-256 of the received `review.json` bytes; compare to `reviewSha256` in the DynamoDB item. If they differ → return 409 `{"error":"run_inconsistent"}`.
5. Return `{ findings: AdversarialFinding[], verificationStatus: string }` where each finding is `review.json.findings[i]` with its embedded `verification` sub-object (present when the finalize step merged it; absent otherwise), and `verificationStatus = review.json.verification.status`.

**R-10** IF the Authorization header is absent THEN the API SHALL return HTTP 401. IF the token is present but invalid, expired, or the caller is in neither reader nor writer group THEN the API SHALL return HTTP 403.

**R-11** The new `GET /adversarial-runs*` routes SHALL be enforced by the existing `RegistryAuthorizer` without code changes to the authorizer.

### 3.5 API — IAM grants for the Lambda

**R-12** The `adversarialRuns` Lambda SHALL be granted exactly:
- `dynamodb:GetItem` on the `Registry` table
- `dynamodb:Query` on the `byKind` GSI
- `s3:GetObject` on `ContractsBucket` with key prefix `adversarial-runs/*`
- `s3:ListBucket` on `ContractsBucket` with `s3:prefix` condition `adversarial-runs/` (needed for distinguishing NoSuchKey from AccessDenied)

The Lambda SHALL be opted out of the `ApiStack` `defaults.function.bind` to avoid inheriting broader grants.

### 3.6 SPA — navigation

**R-13** WHEN a reader or writer is authenticated, the SPA SHALL display an "Adversarial" navigation button in the view-toggle nav alongside "By entity", "By source", and "Requirements".

**R-13a** IF the signed-in user is in neither reader nor writer group AND the API returns 403 THEN the SPA SHALL display "You do not have access to adversarial results." in place of the view content and SHALL NOT display the Adversarial nav button.

**R-14** WHEN the user selects the Adversarial view, the SPA SHALL display two sub-tabs: "Test Review" and "Code Review".

**R-15** The SPA SHALL default to the "Test Review" sub-tab when the Adversarial view is first entered (each entry resets state, since `AdversarialView` unmounts).

### 3.7 SPA — run selector

**R-16** WHILE a run-list request for the current kind is outstanding, the SPA SHALL display a loading indicator in the run selector and SHALL NOT display run options or the R-17 empty-state message.

**R-17** WHEN no runs exist for the selected kind (the list returns an empty array), the SPA SHALL display the message "No {kind} review runs yet." and SHALL NOT issue a findings request.

**R-18** The SPA SHALL default to the most recent run (`runs[0]`) when a sub-tab is opened. IF the run list is empty, `selectedRun` SHALL be `null` and no findings request SHALL be issued.

**R-19** A run selector `<option>` SHALL be labelled: `{startedAt formatted in the viewer's local time as YYYY-MM-DD HH:MM zzz} — {scope}`.

### 3.8 SPA — findings table

**R-20** WHILE a findings request for the selected run is outstanding, the SPA SHALL display a loading indicator in the table area and SHALL NOT display findings, the stale banner, or any drawer or findings from a previously selected run.

**R-21** WHEN a run is selected and its findings have loaded, the SPA SHALL display a findings table with columns: ID (`F-nn`), Severity, Verdict, Target, and Defect.

**R-22** Severity values in the table and chips SHALL be displayed as exactly: `Critical`, `Major`, `Minor`.

**R-23** Verdict values SHALL be displayed as: `CONFIRMED`, `REFUTED`, `UNCLEAR`, or `—` (when the finding's embedded `verification` object is absent or `verificationStatus` is `"stale"` or `"invalid"`).

**R-24** WHILE the displayed findings response has `verificationStatus` ≠ `"ok"` and ≠ `"not_run"`, the SPA SHALL display the banner: "Verification data is {stale | invalid} — re-run Pass 3 for current verdicts." using the actual status word. WHEN the displayed response changes, the banner SHALL reflect the new response only.

**R-25** The SPA SHALL provide severity filter chips — Critical, Major, Minor — and verdict filter chips — CONFIRMED, REFUTED, UNCLEAR, unverified. A finding is shown when **(no severity chip is active OR its severity's chip is active) AND (no verdict chip is active OR its verdict's chip is active)**. "Unverified" matches any finding displayed with "—".

**R-26** WHEN no filter chips are active, the SPA SHALL display all findings.

**R-27** The SPA SHALL support ascending/descending sort on any column by clicking the column header. Default sort: Severity descending (Critical first, then Major, then Minor). Ties break by ID ascending (natural sort: F-9 before F-10).

**R-28** WHEN a run-list or findings request fails (network error or non-2xx response), the SPA SHALL display an inline error message in the affected region and a Retry control. The error SHALL be cleared when a new request for that region starts.

**R-29** The SPA SHALL discard any response that arrives after the user has changed the selected kind or run (stale response from a superseded selection). Only the response to the most recent request for the current (kind, run) selection SHALL be rendered.

### 3.9 SPA — row detail drawer

**R-30** WHEN the user clicks a finding row, the SPA SHALL open a detail drawer (`role="dialog"`, `aria-modal="true"`, focus moved into the drawer) displaying:
- `defect` text
- `failureScenario`
- `evidence` (if present)
- `inProductRef` labelled "In-product reference" (if present)
- Pass 3 `verdict`, `reason`, and `evidence` from `finding.verification` (when present and `verificationStatus = "ok"`)
- "Verification {stale | invalid | not run}" when `verificationStatus` ≠ `"ok"`
- The raw finding as formatted JSON, rendered as plain text in a `<pre>` (no `dangerouslySetInnerHTML`, no Markdown, no auto-linking)

**R-31** WHEN the user clicks outside the open drawer, the SPA SHALL close it and return focus to the row that opened it.

**R-32** WHEN the user presses Escape while the drawer is open, the SPA SHALL close it and return focus to the row that opened it.

**R-33** WHEN the selected (kind, run) changes, the SPA SHALL close the open drawer and clear displayed findings and the banner until the new response arrives.

### 3.10 Non-functional

**R-34** IF a run-list or findings API call returns 403 THEN the SPA SHALL display "You do not have access to adversarial results." IF it returns any other non-2xx THEN the SPA SHALL display an inline error with a Retry control. In neither case SHALL the SPA render a blank or crashed view.

**R-35** The list route SHALL return at most 100 runs newest-first, plus a `nextToken` cursor when more exist. The run selector SHALL load additional pages on scroll or via a "Load more" control.

---

## 4. Out of scope (v1)

- Triggering a new adversarial review run from the SPA.
- Run-comparison (diff between two runs on the same target).
- Deletion of uploaded runs from the UI.
- Run retention / TTL policy (recorded as a known gap).
- Polling or auto-refresh of the run list while the view is open (a manual Refresh button is in scope; polling is not).
- Deep-link URL to a specific run or finding (no router in the SPA).
