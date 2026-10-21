# adversarial-results-ui — Technical Design

> **Phase 3 — Design (v0.2.0).** Derived from `specs/active/adversarial-results-ui/requirements.md` v0.2.0 (the oracle). Revised 2026-10-21 after adversarial pre-impl review: fixed BLK-2 (verdict source), BLK-3 (route + branch sanitisation), BLK-4 (write ordering), BLK-5 (IAM boundary), plus HR-8, HR-9, HR-10, HR-12, HR-18, HR-22.

---

## 1. Architecture Overview

Three additive layers to the existing `odcs-contract-registry` stack:

1. **Finalize script upload** — after generating `review.json` + `verification.json` locally, the finalize script uploads them to S3 and writes a DynamoDB run-summary item.
2. **New API routes** — a new Lambda handler serves run lists and findings to authenticated clients.
3. **SPA Adversarial view** — a new top-level view with Test Review / Code Review sub-tabs, a run selector, a filterable/sortable findings table, and a row-detail drawer.

No new SST stacks. All changes are additive to `StorageStack`, `ApiStack`, and `WebStack`.

---

## 2. Storage

### 2.1 S3 — adversarial run artifacts

**Bucket:** existing `ContractsBucket`.

**Key pattern:**
```
adversarial-runs/{kind}/{run_dir}/review.json
adversarial-runs/{kind}/{run_dir}/verification.json   ← archive only; API does not read this
```

`run_dir` contains no `/` characters (R-0 branch sanitisation). Both files written with `PutObjectCommand`.

### 2.2 DynamoDB — run summary items

**Table:** existing `Registry`. **New item kind: adversarial run summary.**

| Attribute | Value | Notes |
|---|---|---|
| `PK` | `ADV#{kind}` | e.g. `ADV#test`, `ADV#code` |
| `SK` | `{run_dir}` | single segment; no slashes |
| `kind` | `"ADVERSARIAL_TEST"` or `"ADVERSARIAL_CODE"` | `byKind` GSI PK — disjoint from existing kinds |
| `startedAt` | ISO-8601 from `review.json.pass1WrittenAt` or `review.json.finalizedAt` | `byKind` GSI SK; UTC, no wall-clock ambiguity |
| `reviewKind` | `"test"` or `"code"` | API-facing, returned to clients |
| `run_dir` | string | redundant with SK; included for convenience |
| `scope` | string | `review.json.scope` verbatim |
| `verdict` | string | `review.json.verdict` (e.g. `"FAIL — Critical"`) |
| `countCritical`, `countMajor`, `countMinor` | number | |
| `model` | string | reviewer model id from `review.json` |
| `verificationStatus` | string | `review.json.verification.status` (`"ok"` / `"stale"` / `"invalid"` / `"not_run"`) |
| `reviewSha256` | string | hex SHA-256 of uploaded `review.json` bytes |
| `verificationSha256` | string | hex SHA-256 of uploaded `verification.json` (omitted when absent) |

**GSI reuse:** `byKind` (PK `kind`, SK `startedAt`, Projection ALL). New kinds `ADVERSARIAL_TEST`/`ADVERSARIAL_CODE` use it transparently. No DDL changes.

---

## 3. Finalize Script Changes (`scripts/adversarial-review-finalize.ts`)

### 3.1 Upload step — added after existing finalize output

Write order (R-1a): `review.json` → `verification.json` (if present) → DynamoDB `PutItemCommand`.

On error: print to stderr, do not write subsequent steps, exit non-zero. The review report printed to stdout is never suppressed (R-3).

### 3.2 Config resolution (R-6)

Priority:
1. Env vars `ADVERSARIAL_BUCKET` and `ADVERSARIAL_TABLE`.
2. `.sst/outputs.json` keys **`ContractsBucketName`** and **`RegistryTableName`** under the configured stage entry (these are the actual SST output key names from `stacks/StorageStack.ts` lines 60–63).
3. Neither resolved → stderr warning + exit code 3.
4. `--no-upload` flag → skip silently, exit 0.

AWS credentials: standard SDK provider chain (`AWS_PROFILE` env var or default profile); not hardcoded to any config file.

### 3.3 `upload <run_dir>` subcommand (R-5)

New subcommand alongside `finalize` and `blind-inputs`. Reads an already-completed run_dir from disk and uploads without re-running finalize or triggering AR-16 checks. Idempotent (overwrites S3 and DynamoDB unconditionally).

### 3.4 `review.json` fields consumed by the upload step

The finalize script already writes at the top level: `verdict`, `findings` (array with embedded `verification` per-finding), `verification.status`, `model`, `scope`, `pass1WrittenAt` / `finalizedAt`. The upload step reads these directly — no schema changes to `review.json`.

---

## 4. API — new handler (`packages/functions/src/adversarialRuns.ts`)

### 4.1 Routes

| Route | Handler fn | Auth |
|---|---|---|
| `GET /adversarial-runs?kind={test\|code}` | `listAdversarialRuns` | reader \| writer |
| `GET /adversarial-runs/{kind}/{run_dir}/findings` | `getAdversarialFindings` | reader \| writer |

`run_dir` is a single path segment (no greedy capture needed — R-0 guarantees no slashes). Added to the existing `ApiStack` HTTP API. The existing `RegistryAuthorizer` enforces auth without changes.

### 4.2 `listAdversarialRuns`

1. Validate `kind` query param — 400 if absent or not `"test"|"code"` (R-8a).
2. Map to GSI partition: `kind = "ADVERSARIAL_TEST"` or `"ADVERSARIAL_CODE"`.
3. Query `byKind` GSI, `ScanIndexForward: false`, `Limit: 100`; follow `LastEvaluatedKey` up to the 100-item cap (R-35).
4. Map each item to `AdversarialRunSummary` — return only the fields from R-8 (never pass the item through whole).
5. On query failure → 502 (R-8b).

### 4.3 `getAdversarialFindings`

1. Validate `kind` path param (400) and `run_dir` against R-0 pattern (400).
2. `GetItemCommand` — 404 if absent (R-9, step 2).
3. `GetObjectCommand` for `review.json` — 404, 502, or 422 on the conditions in R-9 step 3.
4. Compute SHA-256 of received bytes; compare to `reviewSha256` in the item — 409 if mismatch (R-9 step 4).
5. Parse `review.json`; return `{ findings, verificationStatus }` where each finding carries its embedded `finding.verification` object as written by the finalize step. **No separate read of `verification.json` — the API never reads that file.**

### 4.4 Response types

```typescript
interface AdversarialRunSummary {
  reviewKind: 'test' | 'code';
  run_dir: string;
  startedAt: string;           // ISO-8601
  scope: string;
  verdict: string;
  countCritical: number;
  countMajor: number;
  countMinor: number;
  verificationStatus: 'ok' | 'stale' | 'invalid' | 'not_run';
}

interface FindingVerification {
  verdict: 'CONFIRMED' | 'REFUTED' | 'UNCLEAR';
  reason: string;
  evidence?: string;
}

interface AdversarialFinding {
  id: string;                           // "F-01"
  severity: 'Critical' | 'Major' | 'Minor';
  target: string;
  defect: string;
  failureScenario: string;
  evidence?: string;
  inProductRef?: string;                // "A-nn" — note camelCase (matches review.json field)
  verification?: FindingVerification;   // present when finalize merged Pass 3
}

interface AdversarialFindingsResponse {
  findings: AdversarialFinding[];
  verificationStatus: 'ok' | 'stale' | 'invalid' | 'not_run';
}
```

### 4.5 IAM grants (R-12)

The `adversarialRuns` Lambda is **opted out** of `ApiStack` `defaults.function.bind`. Explicit grants only:
- `dynamodb:GetItem` on the `Registry` table
- `dynamodb:Query` on the `byKind` GSI ARN
- `s3:GetObject` on `ContractsBucket/adversarial-runs/*`
- `s3:ListBucket` on `ContractsBucket` with `s3:prefix` condition `adversarial-runs/`

---

## 5. SPA Changes (`packages/web/`)

### 5.1 View state

`App.tsx` view union extended: `'entity' | 'source' | 'requirements' | 'adversarial'`.

### 5.2 New `api.ts` methods and types

```typescript
listAdversarialRuns(kind: 'test' | 'code'): Promise<AdversarialRunSummary[]>
getAdversarialFindings(kind: 'test' | 'code', runDir: string): Promise<AdversarialFindingsResponse>
```

`runDir` is passed as a path segment — no `encodeURIComponent` needed because R-0 guarantees the value is `[A-Za-z0-9._-]+` only.

### 5.3 Component tree

```
App
└─ AdversarialView          (new)
   ├─ nav (sub-tabs)        "Test Review" | "Code Review"
   ├─ RunSelector           (new — <select>)
   ├─ stale/invalid banner  (conditional — verificationStatus ≠ "ok" and ≠ "not_run")
   ├─ FindingsTable         (new — filterable, sortable)
   │   └─ FindingRow        (new)
   └─ Drawer                (new — <aside role="dialog" aria-modal="true">)
       └─ FindingDetail     (new)
```

### 5.4 `AdversarialView` state

```typescript
{
  kind: 'test' | 'code';                   // defaults to 'test'
  runsState: 'idle' | 'loading' | 'loaded' | 'error';
  runs: AdversarialRunSummary[];
  runsError: string | null;
  selectedRun: string | null;              // null when runs is empty
  findingsState: 'idle' | 'loading' | 'loaded' | 'error';
  findingsData: AdversarialFindingsResponse | null;
  findingsError: string | null;
}
```

Stale-response guard: each request is tagged with a `requestId` (incrementing counter or `crypto.randomUUID()`). The response is applied only when its `requestId` matches the latest issued for that region (R-29).

### 5.5 `RunSelector`

`<select>` with `<option value={run.run_dir}>` for each run. Label: `run.startedAt` formatted in the viewer's local time (`toLocaleString` with explicit `hour12: false`) + " — " + `run.scope`.

### 5.6 `FindingsTable`

Internal state:
```typescript
{
  severityFilters: Set<'Critical' | 'Major' | 'Minor'>;
  verdictFilters: Set<'CONFIRMED' | 'REFUTED' | 'UNCLEAR' | 'unverified'>;
  sortCol: keyof AdversarialFinding;      // default 'severity'
  sortAsc: boolean;                       // default false
  selectedFindingId: string | null;
}
```

Filter logic (R-25): `(severityFilters.size === 0 || severityFilters.has(f.severity)) && (verdictFilters.size === 0 || verdictFilters.has(effectiveVerdict(f)))`. `effectiveVerdict` returns `f.verification?.verdict` when `verificationStatus === 'ok'`, else `'unverified'`.

Severity sort order: Critical=0, Major=1, Minor=2. Tie-break by ID natural sort.

Empty states: "No findings in this run." when `findings.length === 0`; "No findings match the active filters." with a Clear-filters button when filters exclude all rows.

### 5.7 `Drawer`

Fixed `<aside role="dialog" aria-modal="true">` on the right edge. Semi-transparent backdrop `<div>`. On open: focus moves to the close button inside the drawer. On close: focus returns to the row `<button>` that opened it. Escape key closes it. Backdrop click closes it; click inside the `<aside>` does not. Close also triggered by (kind, run) change (R-33).

All finding text fields rendered as React text nodes only — no `dangerouslySetInnerHTML`, no Markdown rendering. Raw JSON rendered in `<pre>{JSON.stringify(finding, null, 2)}</pre>`.

---

## 6. Decision Log

| ID | Decision | Rationale |
|---|---|---|
| D-AR-1 | Reuse `ContractsBucket` for adversarial artifacts | No new bucket; existing SSE and block-public policy applies |
| D-AR-2 | Reuse `byKind` GSI with kinds `ADVERSARIAL_TEST`/`ADVERSARIAL_CODE` | Zero DDL changes; disjoint from existing kinds |
| D-AR-3 | ~~S3 LastModified staleness check~~ **Removed.** Use `review.json.verification.status` | The finalize script is authoritative for staleness; `review.json` already carries the verdict; reading `verification.json` again would attach verdicts to wrong findings after post-finalize sort |
| D-AR-4 | `run_dir` has no slashes (both skills sanitise `/` → `-`) | Eliminates greedy path capture, file-system nesting issues, and URL-encoding edge cases in one rule |
| D-AR-5 | Drawer is a plain `<aside>` + CSS, no UI library | Consistent with zero-dependency SPA |
| D-AR-6 | Config from `.sst/outputs.json` keys `ContractsBucketName`/`RegistryTableName` | Confirmed actual SST output key names from `stacks/StorageStack.ts:60-63` |
| D-AR-7 | Upload errors do not block the finalize report | Review output is the primary product; upload failure is recoverable via the `upload` subcommand |
| D-AR-8 | ~~Greedy `{run_dir+}` path~~ **Removed.** Single-segment `{run_dir}` | HTTP API Gateway does not allow a greedy variable mid-path; R-0 sanitisation makes it unnecessary |
| D-AR-9 | `adversarialRuns` Lambda opted out of `defaults.function.bind` | Prevents inheriting broad table/bucket grants; allows minimal-privilege explicit policy |
| D-AR-10 | DynamoDB item is the commit marker; written last | Ensures a run is only listable after its S3 artifacts are confirmed uploaded |
| D-AR-11 | SHA-256 integrity check on findings fetch (R-9 step 4) | Detects partial re-upload or S3 corruption without a separate manifest file |

---

## 7. Files Changed

| File | Change |
|---|---|
| `scripts/adversarial-review-finalize.ts` | Add `uploadRun(runDir)` + `upload <run_dir>` subcommand; read `.sst/outputs.json` with correct key names |
| `.claude/agents/adversarial-code-blind.md` | Add R-0 branch sanitisation rule (test-review already does this) |
| `.claude/skills/adversarial-code-review/SKILL.md` | Same R-0 rule for the orchestrating skill |
| `packages/functions/src/adversarialRuns.ts` | New handler: `listAdversarialRuns` + `getAdversarialFindings` |
| `packages/functions/src/index.ts` | Export new handler |
| `sst.config.ts` | Add two routes; opt new Lambda out of default bind; add explicit IAM grants; add `StorageStack` outputs |
| `packages/web/src/App.tsx` | Add `'adversarial'` to view union; add nav button; render `<AdversarialView>` |
| `packages/web/src/api.ts` | Add methods + response types |
| `packages/web/src/adversarial.tsx` | New: `AdversarialView`, `RunSelector`, `FindingsTable`, `FindingRow`, `Drawer`, `FindingDetail` |
| `packages/web/src/lib.ts` | Add `sortFindings`, `filterFindings`, `effectiveVerdict`, `parseRunLabel` |
| `packages/functions/tests/adversarialRuns.test.ts` | Unit tests for handler |
| `packages/web/src/adversarial.test.tsx` | jsdom tests for filter/sort/drawer/stale-guard |

---

## 8. Pre-implementation checklist

- [ ] Confirm `review.json` top-level fields: `verdict`, `findings[].verification`, `verification.status`, `model`, `scope`, `pass1WrittenAt`/`finalizedAt` — read `scripts/adversarial-review-finalize.ts` before implementing the upload step.
- [ ] Confirm `.sst/outputs.json` structure after `sst deploy` (key format and stage nesting) before implementing config resolution.
- [ ] Confirm `byKind` GSI has Projection ALL (it does — from `odcs-contract-registry` design §2.1).
- [ ] Confirm `adversarial-code-blind.md` agent definition does not already sanitise `/` before adding R-0 to it.
- [ ] SHA-256: use Node.js `crypto.createHash('sha256').update(bytes).digest('hex')` in both the upload and the Lambda verification steps.
