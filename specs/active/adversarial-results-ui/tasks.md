# adversarial-results-ui — Implementation Tasks

> **Phase 4 — Tasks.** Derived from `specs/active/adversarial-results-ui/requirements.md` v0.1.0 + `design.md` (the oracles). Ordered so dependencies are always satisfied. **Every implementation task `T-AR-nn` has a paired test task `T-AR-nna` immediately after it** (the paired-test rule). One task ≈ one Claude session.
>
> **Golden rule:** write the failing tests first, get approval, then implement until green. If a test passes but contradicts the spec, the test is wrong.
>
> **This feature extends `odcs-contract-registry`.** The existing scaffold, storage, auth, and API stack are already deployed. Tasks here add to them — no greenfield setup needed.

---

## Task list

Legend: **Deps** = must be complete first · **Satisfies** = requirement IDs · **AC** = acceptance criteria that prove done.
Test tiers: `[unit]` = Vitest with mocked AWS SDK · `[infra]` = offline CFN-synth · `[web]` = jsdom (Vitest).

---

### Layer 0 — Branch sanitisation (pre-condition)

| ID | Description | Deps | Satisfies | Done when (AC) |
|---|---|---|---|---|
| **T-AR-00** | In `.claude/agents/adversarial-code-blind.md` and `.claude/skills/adversarial-code-review/SKILL.md`: add the R-0 branch sanitisation rule — replace every `/` in the branch/range name with `-` when constructing `run_dir`. (`adversarial-test-review` already does this; this change aligns code-review.) | — | R-0 | Both files state the rule; a run on branch `feature/my-branch` produces `run_dir` ending in `feature-my-branch` |
| **T-AR-00a** | _Test_ [unit]: `buildRunDir('20261021-1430', 'code', 'feature/my-branch')` → `'20261021-1430_code_feature-my-branch'`; `buildRunDir` applied to a branch with no slashes is unchanged; result matches `^\d{8}-\d{4}_(test\|code)_[A-Za-z0-9._-]+$` | T-AR-00 | (verifies R-0) | All three cases pass |

---

### Layer 1 — Finalize script: upload step

| ID | Description | Deps | Satisfies | Done when (AC) |
|---|---|---|---|---|
| **T-AR-01** | Add `uploadRun(runDir: string)` to `scripts/adversarial-review-finalize.ts`. Config resolution: env vars `ADVERSARIAL_BUCKET`/`ADVERSARIAL_TABLE` first, then `.sst/outputs.json` keys **`ContractsBucketName`** and **`RegistryTableName`**; if neither → stderr + exit 3; `--no-upload` flag → exit 0. Write order: `review.json` PUT → `verification.json` PUT (if present) → DynamoDB `PutItemCommand` (the commit marker). DynamoDB item uses `PK=ADV#{kind}`, `SK={run_dir}`, attributes per R-2 including `reviewKind`, `kind=ADVERSARIAL_*`, `startedAt` from `review.json.pass1WrittenAt`/`finalizedAt`, `reviewSha256`. Exits non-zero on any step failure without suppressing the review report. Also expose `upload <run_dir>` subcommand (R-5) that is idempotent. Credentials via standard SDK provider chain. | T-AR-00 | R-1, R-1a, R-2, R-3, R-3a, R-4, R-5, R-6 | Upload writes correct S3 keys and DynamoDB item; write order enforced; failure at each step exits non-zero; re-upload overwrites; missing config exits 3; `--no-upload` exits 0 |
| **T-AR-01a** | _Test_ [unit] (mock `@aws-sdk/client-s3`, `@aws-sdk/client-dynamodb`): (a) happy path — both files present → two S3 puts in order then one DynamoDB put, item has `reviewKind`, `kind=ADVERSARIAL_TEST`, `reviewSha256`, `verificationStatus`; (b) no `verification.json` → one S3 put, `verificationStatus` from `review.json`; (c) S3 put fails → DynamoDB not called, exit non-zero; (d) DynamoDB fails after S3 success → exit non-zero; (e) no config → no AWS calls, exit 3; (f) `--no-upload` → no AWS calls, exit 0; (g) re-upload same run_dir → unconditional overwrite, no error | T-AR-01 | (verifies R-1…R-6) | All seven scenarios pass |

---

### Layer 2 — API handler

| ID | Description | Deps | Satisfies | Done when (AC) |
|---|---|---|---|---|
| **T-AR-02** | New file `packages/functions/src/adversarialRuns.ts` exporting two handlers. `listAdversarialRuns`: validates `kind` query param (400 if absent or invalid); queries `byKind` GSI (`kind = "ADVERSARIAL_TEST"` or `"ADVERSARIAL_CODE"`), `Limit:100`, `ScanIndexForward:false`; maps items to `AdversarialRunSummary` (explicit field projection — no pass-through); 502 on query failure. `getAdversarialFindings`: validates `kind` path param and `run_dir` pattern (400); `GetItemCommand` → 404; `GetObjectCommand` for `review.json` → 404/502/422; SHA-256 integrity check vs `reviewSha256` → 409; returns `{ findings, verificationStatus }` from `review.json` directly — **no read of `verification.json`**. Export both from `index.ts`. | — | R-8, R-8a, R-8b, R-9, R-10, R-11 | List returns correct `AdversarialRunSummary` shape with only specified fields; `kind` missing/invalid → 400; findings returned with embedded `verification` from `review.json`; SHA mismatch → 409; 404 when run absent; 401/403 enforced by authorizer |
| **T-AR-02a** | _Test_ [unit] (mock DDB + S3): (a) `kind=test` → queries `ADVERSARIAL_TEST`, newest first, returns `AdversarialRunSummary` shape; (b) `kind` absent → 400; (c) `kind=CODE` (wrong case) → 400; (d) findings — SHA matches → findings with embedded `verification` returned; (e) SHA mismatch → 409; (f) `review.json` not parseable → 422; (g) DynamoDB `GetItem` miss → 404; (h) `review.json` S3 NoSuchKey → 404; (i) S3 non-NoSuchKey error → 502; (j) GSI query fails → 502 | T-AR-02 | (verifies R-8…R-11) | All ten scenarios pass |

---

### Layer 3 — SST stack wiring

| ID | Description | Deps | Satisfies | Done when (AC) |
|---|---|---|---|---|
| **T-AR-03** | In `sst.config.ts` `ApiStack`: add `GET /adversarial-runs` and `GET /adversarial-runs/{kind}/{run_dir}/findings` (single segment — no greedy) routes bound to `adversarialRuns.listAdversarialRuns` and `adversarialRuns.getAdversarialFindings`. Opt the new Lambda **out** of `defaults.function.bind`. Add explicit IAM grants: `dynamodb:GetItem` on table, `dynamodb:Query` on `byKind` GSI, `s3:GetObject` on `ContractsBucket/adversarial-runs/*`, `s3:ListBucket` on `ContractsBucket` with prefix condition `adversarial-runs/`. In `StorageStack`: add CFN Outputs for `ContractsBucketName` and `RegistryTableName` (these are the actual output key names). | T-AR-02 | R-11, R-12, R-35 | CFN template has both routes (single-segment `{run_dir}`); Lambda IAM has four explicit grants; Lambda not in default bind; `StorageStack` Outputs section has `ContractsBucketName` and `RegistryTableName` |
| **T-AR-03a** | _Test_ [infra] (CFN synth): (a) both routes present with `{run_dir}` (not `{run_dir+}`); (b) Lambda policy has `dynamodb:GetItem` on table; (c) `dynamodb:Query` on `byKind` GSI ARN; (d) `s3:GetObject` on `arn:...:adversarial-runs/*`; (e) `s3:ListBucket` with prefix condition; (f) Lambda not included in the default bind policy; (g) `StorageStack` Outputs has `ContractsBucketName` and `RegistryTableName` | T-AR-03 | (verifies R-12, D-AR-9) | All seven assertions pass |

---

### Layer 4 — SPA utilities

| ID | Description | Deps | Satisfies | Done when (AC) |
|---|---|---|---|---|
| **T-AR-04** | In `packages/web/src/lib.ts` add: `sortFindings(findings, col, asc)` — severity order Critical=0 > Major=1 > Minor=2; ties break by id natural sort; `filterFindings(findings, severitySet, verdictSet, verificationStatus)` — empty set means "all"; `effectiveVerdict(finding, verificationStatus)` — returns `finding.verification.verdict` when `verificationStatus === 'ok'`, else `'unverified'`; `'unverified'` chip matches any finding with `effectiveVerdict === 'unverified'`; filter uses the AND-across-groups rule from R-25; `formatRunLabel(run: AdversarialRunSummary)` — formats `run.startedAt` in viewer's local time (`toLocaleString` with `hour12:false`) + " — " + `run.scope`. | — | R-19, R-22, R-23, R-25, R-26, R-27 | Sort and filter behave per spec; `effectiveVerdict` returns correct value for ok/stale/not_run status |
| **T-AR-04a** | _Test_ [unit]: (a) sort severity desc → Critical, Major, Minor order; (b) sort id asc → F-9 before F-10 (natural); (c) severity filter=Critical → only Critical rows; (d) verdict filter=unverified with `verificationStatus='stale'` → all findings (all unverified when stale); (e) Critical chip + CONFIRMED chip → only Critical CONFIRMED rows (AND logic); (f) empty filter sets → all rows; (g) `effectiveVerdict` with `verificationStatus='ok'` → uses `finding.verification.verdict`; with `verificationStatus='stale'` → `'unverified'` | T-AR-04 | (verifies R-25…R-27) | All seven cases pass |
| **T-AR-05** | In `packages/web/src/api.ts` add two methods to the `Api` type and `createApi` factory: `listAdversarialRuns(kind?: 'test' \| 'code'): Promise<AdversarialRunSummary[]>` and `getAdversarialFindings(kind: 'test' \| 'code', runDir: string): Promise<AdversarialFindingsResponse>`. Define the interfaces `AdversarialRunSummary`, `AdversarialFindingsResponse`, and `AdversarialFinding` in `api.ts`. | — | R-5, R-7 | Both methods call correct routes with Authorization header; `runDir` path-encodes slashes correctly (no double-encoding) |
| **T-AR-05a** | _Test_ [web] (jsdom, `fetch` mocked): `listAdversarialRuns('test')` → `GET /adversarial-runs?kind=test` with correct auth header; `listAdversarialRuns()` → `GET /adversarial-runs`; `getAdversarialFindings('code', 'run_dir')` → `GET /adversarial-runs/code/run_dir/findings`; non-2xx response → rejects with an error | T-AR-05 | (verifies R-5, R-7) | All four fetch cases pass |

---

### Layer 5 — SPA components

| ID | Description | Deps | Satisfies | Done when (AC) |
|---|---|---|---|---|
| **T-AR-06** | Create `packages/web/src/adversarial.tsx`. Implement `Drawer` component: fixed `<aside>` on right edge (`position:fixed; right:0; top:0; height:100%; width:min(480px,100%)`), semi-transparent backdrop `<div>` behind it. Closes on backdrop click and on `document` `keydown` Escape. Props: `open: boolean`, `onClose: () => void`, `children: ReactNode`. | T-AR-04, T-AR-05 | R-29, R-30 | Drawer renders open/closed; Escape key closes it; backdrop click closes it; does not close on click inside the aside |
| **T-AR-06a** | _Test_ [web] (jsdom): (a) `open=true` → aside visible; (b) Escape keydown → `onClose` called; (c) backdrop click → `onClose` called; (d) click inside aside → `onClose` not called | T-AR-06 | (verifies R-29, R-30) | All four cases pass |
| **T-AR-07** | In `adversarial.tsx` implement `FindingDetail`: renders full `defect`, `failureScenario`, `evidence` (if present), `in_product_ref` (if present), Pass 3 `verdict`/`verificationReason`/`verificationEvidence` (if present and not stale), "Verification stale" label when stale, and raw JSON in a `<pre>`. | T-AR-06 | R-27, R-28 | All fields render when present; stale label shown when `verificationStale`; raw JSON always present |
| **T-AR-07a** | _Test_ [web] (jsdom): (a) finding with all fields → all sections visible; (b) no evidence → evidence section absent; (c) verification present and fresh → verdict/reason/evidence visible; (d) `verificationStale:true` → "Verification stale" shown, verdict fields absent; (e) no verification → verdict section absent | T-AR-07 | (verifies R-27, R-28) | All five cases pass |
| **T-AR-08** | In `adversarial.tsx` implement `FindingsTable` + `FindingRow`. Internal state: severity chips (Set), verdict chips (Set), sort col/dir, `selectedFindingId`. Renders chip buttons for Critical/Major/Minor and CONFIRMED/REFUTED/UNCLEAR/unverified; renders sortable column headers; filters and sorts findings via `filterFindings`/`sortFindings` (T-AR-04); renders each row as a `<tr>` button; renders `<Drawer>` with `<FindingDetail>` for the selected row. Stale banner renders when `verificationStale`. | T-AR-06, T-AR-07, T-AR-04 | R-18, R-19, R-20, R-21, R-22, R-23, R-24, R-25 | Table renders all findings; chips filter correctly; column sort works; row click opens drawer; banner shown when stale |
| **T-AR-08a** | _Test_ [web] (jsdom): (a) renders 3 findings → 3 rows; (b) activate Critical chip → only Critical rows; (c) activate REFUTED chip → only REFUTED rows; (d) click Severity header twice → first desc then asc; (e) click row → drawer opens with correct finding; (f) close drawer → no row selected; (g) stale=true → banner visible; (h) stale=false → no banner | T-AR-08 | (verifies R-18…R-25) | All eight cases pass |
| **T-AR-09** | In `adversarial.tsx` implement `RunSelector` (`<select>` with `<option value={run.run_dir}>`, label via `formatRunLabel`) and `AdversarialView`. State: separate `runsState`/`findingsState` (`idle|loading|loaded|error`) — never a single shared `loading` bool. Stale-response guard: tag each request with a `requestId`; apply response only when `requestId` matches the latest for that region. `selectedRun` defaults to `runs[0].run_dir` or `null` when empty — no `.run_dir` access on an empty array. Sub-tabs "Test Review" / "Code Review"; defaults to `kind='test'`. On kind change: reset `selectedRun`, clear findings state, fetch new run list. On run change: clear findings state, fetch findings. Each error region shows a Retry button. `R-33`: kind/run change closes the drawer. | T-AR-08, T-AR-05 | R-14, R-15, R-16, R-17, R-18, R-19, R-20, R-24, R-28, R-29, R-33, R-34 | Sub-tabs switch kind; run selector defaults to newest or shows empty-state; stale response discarded; separate error regions; empty array doesn't crash; Retry re-issues request |
| **T-AR-09a** | _Test_ [web] (jsdom, fetch mocked): (a) mount → "Test Review" active, run list fetched, newest run selected; (b) switch to Code Review → run list re-fetched, kind-specific; (c) no runs → empty-state, no findings request; (d) run list fetch fails → error in run selector region, Retry available; (e) change run → findings re-fetched for new run; (f) findings fetch fails → error in table area, Retry available; (g) response arrives after kind switch → discarded, not rendered; (h) empty run list → `selectedRun = null`, no crash | T-AR-09 | (verifies R-16…R-20, R-28, R-29, R-33, R-34) | All eight cases pass |

---

### Layer 6 — App integration

| ID | Description | Deps | Satisfies | Done when (AC) |
|---|---|---|---|---|
| **T-AR-10** | In `packages/web/src/App.tsx`: add `'adversarial'` to the view state union; add "Adversarial" `<button>` to the `<nav aria-label="view toggle">` alongside existing buttons; render `<AdversarialView api={api!} />` when `view === 'adversarial'`. | T-AR-09 | R-11 | Nav shows "Adversarial" button; clicking it renders `AdversarialView`; existing views unaffected |
| **T-AR-10a** | _Test_ [web] (jsdom): (a) authenticated user sees "Adversarial" nav button; (b) click "Adversarial" → `AdversarialView` renders; (c) switch back to "By entity" → entity list renders, `AdversarialView` unmounted; (d) existing "Requirements", "By source" views still render correctly | T-AR-10 | (verifies R-11) | All four cases pass |

---

## Summary

| Layer | Tasks | Paired tests |
|---|---|---|
| Branch sanitisation | T-AR-00 | T-AR-00a |
| Finalize upload | T-AR-01 | T-AR-01a |
| API handler | T-AR-02 | T-AR-02a |
| SST wiring | T-AR-03 | T-AR-03a |
| SPA lib utilities | T-AR-04, T-AR-05 | T-AR-04a, T-AR-05a |
| SPA components | T-AR-06, T-AR-07, T-AR-08, T-AR-09 | T-AR-06a…T-AR-09a |
| App integration | T-AR-10 | T-AR-10a |
| **Total** | **11** | **11** |

**Dependency order for a single-session run:**
T-AR-00 → T-AR-01 (finalize upload)
T-AR-00 → T-AR-02 → T-AR-03 (API + stack)
T-AR-04 → T-AR-05 → T-AR-06 → T-AR-07 → T-AR-08 → T-AR-09 → T-AR-10 (SPA chain, longest path)
