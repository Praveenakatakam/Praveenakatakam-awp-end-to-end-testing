# Jira Source — Implementation Task List

> **Status:** Draft · **Owner:** nashah  
> Derived from `docs/spec-jira-source.md` and `docs/design-jira-source.md` (design v0.2.0).  
> Tasks are ordered so every dependency is satisfied before its dependents. Each implementation task is immediately followed by its paired test task.

---

## Dependency graph

```
T-01 (repo refactor)
  └── T-02 (ParsedRequirement extensions)   ─┐
  └── T-06 (EARS cache)                      ├─── T-07 (crawlJiraSource) ── T-08 (SPA badge)
T-03 (SST Config)                            │
T-04 (JiraApiClient + extractAdfText)       ─┤
T-05 (convertToEars)                        ─┘
```

**Phase 1 — Foundation** (sequential): T-01  
**Phase 2 — Parallel** (no inter-dependencies, start after T-01): T-02, T-03, T-04, T-05, T-06  
**Phase 3 — Assembly** (depends on all of Phase 2): T-07  
**Phase 4 — UI** (depends on T-02): T-08  

---

## T-01 — Source-agnostic repository refactor

**Depends on:** nothing (first task)  
**Satisfies:** design §2.0 (source-agnostic principle)  
**Files:** `packages/functions/src/repository.ts`, `packages/functions/src/refresh.ts`

Rename GitHub-specific vocabulary in the shared storage layer so it makes no assumptions about where requirements come from:

1. In `RequirementRecord`: rename `specHash` → `contentHash`, `specVersion` → `sourceVersion`
2. In `putRequirements` opts: rename `specHash` → `contentHash`, `rawSpec` → `rawSnapshot`; add `snapshotKey?: string` (full S3 key, caller-supplied); if absent, skip S3 write
3. Delete `reqSpecKey` constant
4. Update the GitHub crawl call site in `refresh.ts` to pass `snapshotKey: \`requirements/${source.label}/snapshot.md\`` and `rawSnapshot: specContent`
5. Update `wipeRequirements` to derive the S3 delete key from the stored `snapshotKey` (or skip if none)

**Acceptance criteria:**
- All existing tests pass with no logic changes — this is a rename + interface change only
- `RequirementRecord` has no field named `specHash` or `specVersion`
- `putRequirements` opts has no field named `specHash` or `rawSpec`
- `reqSpecKey` does not exist anywhere in `repository.ts`
- GitHub crawl behaviour is unchanged: S3 snapshot still written at `requirements/{source}/snapshot.md`

---

## T-01a — Tests for T-01

**Depends on:** T-01  
**Files:** existing test files covering `putRequirements` and `wipeRequirements`

Update all existing unit/integration tests that reference `specHash`, `specVersion`, `rawSpec`, or `reqSpecKey` to use the renamed fields. Add one test asserting that when `snapshotKey` is omitted from `putRequirements` opts, no S3 `PutObject` call is made.

**Acceptance criteria:**
- Full test suite passes
- No test references `specHash`, `specVersion`, `rawSpec`, or `reqSpecKey`
- New test: `putRequirements` with no `snapshotKey` → no S3 write

---

## T-02 — `ParsedRequirement` and `RequirementRecord` extensions

**Depends on:** T-01  
**Satisfies:** JR-30 (rawText + jiraUrl fields), design §2.2, §2.3  
**Files:** `packages/core/src/requirements.ts`, `packages/functions/src/repository.ts`

1. Add `rawText?: string` and `jiraUrl?: string` as optional fields to `ParsedRequirement` in `packages/core/src/requirements.ts`
2. Add the same two optional fields to `RequirementRecord` in `repository.ts`
3. In `putRequirements`, conditionally spread both fields onto the DynamoDB item:
   ```typescript
   ...(r.rawText ? { rawText: r.rawText } : {}),
   ...(r.jiraUrl ? { jiraUrl: r.jiraUrl } : {}),
   ```
4. GitHub-sourced `ParsedRequirement` objects never set these fields — no change to `parseRequirements` in `packages/core/src/requirements.ts`

**Acceptance criteria:**
- `ParsedRequirement` and `RequirementRecord` both have `rawText?` and `jiraUrl?`
- A `ParsedRequirement` with `rawText` set produces a DynamoDB item with `rawText` present
- A `ParsedRequirement` without `rawText` produces a DynamoDB item with no `rawText` key (not `null`)
- All existing GitHub-source tests still pass

---

## T-02a — Tests for T-02

**Depends on:** T-02  
**Files:** unit tests for `putRequirements`

1. Test: `putRequirements` with a requirement carrying `rawText` + `jiraUrl` → DynamoDB item contains both fields
2. Test: `putRequirements` with a requirement lacking both → DynamoDB item contains neither key
3. Test: `GET /requirements/jira-awp/BAWP-123` response includes `rawText` and `jiraUrl` when present (API passthrough)

---

## T-03 — SST Config additions

**Depends on:** nothing (parallel with T-01 group)  
**Satisfies:** JR-01, JR-02, design §2.5  
**Files:** `stacks/AuthStack.ts`, `stacks/ApiStack.ts`

1. Add new `Config.Secret`: `JIRA_API_TOKEN`
2. Add new `Config.Parameter` entries: `JIRA_BASE_URL`, `JIRA_JQL`, `JIRA_AC_FIELD_ID`, `JIRA_SERVICE_ACCOUNT_EMAIL`, `JIRA_SOURCE_LABEL`
3. Bind all five to the `POST /refresh` Lambda function in `ApiStack.ts` alongside existing bindings
4. Add fast-fail guard at the top of the `handler` export in `refresh.ts`:
   ```typescript
   const JIRA_TOKEN = (Config as Record<string, string>).JIRA_API_TOKEN;
   if (!JIRA_TOKEN) throw new Error('JIRA_API_TOKEN secret is absent or blank');
   ```

**Acceptance criteria:**
- `sst deploy` succeeds with the new Parameters and Secret declared
- Lambda environment correctly exposes all five new Config keys (verified via `sst bind` or local test stub)
- Fast-fail: if `JIRA_API_TOKEN` is empty string, Lambda `handler` throws before processing any request

---

## T-03a — Tests for T-03

**Depends on:** T-03  
**Files:** existing Lambda handler tests / vitest.setup.ts stubs

1. Add `JIRA_API_TOKEN`, `JIRA_BASE_URL`, `JIRA_JQL`, `JIRA_AC_FIELD_ID`, `JIRA_SERVICE_ACCOUNT_EMAIL`, `JIRA_SOURCE_LABEL` to the test environment stubs in `vitest.setup.ts`
2. Test: handler called with `JIRA_API_TOKEN = ''` → throws (does not reach crawl logic)
3. Test: handler called with all Jira config present → does not throw at init (crawl errors are separate)

---

## T-04 — `JiraApiClient` and `extractAdfText`

**Depends on:** nothing (parallel with T-01 group)  
**Satisfies:** JR-03 (pagination), JR-11 (field fetch), JR-15 (HTTP errors), NFR-J1 (timeout), design §3.1, §3.2  
**Files:** `packages/functions/src/jira.ts` (new file)

Implement the new `jira.ts` module:

1. `extractAdfText(doc: AdfDocument | null | undefined): string` — depth-first walk of ADF tree, concatenates `node.text` values, newline between block nodes, returns `''` for null/undefined
2. `JiraApiClient` class:
   - Constructor: `(baseUrl: string, authHeader: string)`
   - `search(jql, acFieldId, { timeoutMs }): AsyncGenerator<JiraStory>` — calls `GET /rest/api/3/search/jql`, paginates via the response's `nextPageToken` cursor + `maxResults=100` (D-J12; stops when `isLast` is `true`), uses `AbortController` per fetch with cumulative timer, throws `JiraTimeoutError` when cumulative time exceeds `timeoutMs`
   - HTTP 429: retry with exponential backoff (1 s, 2 s, 4 s), then throw `JiraApiError`
   - Any other non-2xx: throw `JiraApiError` with status + redacted body
3. Export error classes: `JiraApiError`, `JiraTimeoutError`
4. Auth header helper (not exported): `basicAuthHeader(email, token) => 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64')`

**Acceptance criteria:**
- `extractAdfText` correctly flattens a multi-paragraph ADF document to plain text
- `extractAdfText(null)` returns `''`
- `JiraApiClient.search` yields all stories across multiple pages (verified with mock server)
- Cumulative timeout throws `JiraTimeoutError` before `putRequirements` is called
- HTTP 429 retries 3× then throws
- HTTP 401 throws `JiraApiError` immediately

---

## T-04a — Tests for T-04

**Depends on:** T-04  
**Files:** `packages/functions/src/jira.test.ts` (new file)

1. `extractAdfText`: empty doc, single paragraph, multi-paragraph, nested inline marks, null/undefined input
2. `JiraApiClient.search`: single page (isLast=true), two pages, empty result, cumulative timeout, 429 with retries, 429 exhausted, 401, network error

---

## T-05 — `convertToEars` in `llm.ts`

**Depends on:** nothing (parallel with T-01 group)  
**Satisfies:** JR-20, JR-22, NFR-J3, design §3.3  
**Files:** `packages/functions/src/llm.ts`

1. Add `'jira-ears-v1'` entry to the `PROMPTS` map:
   ```
   You are a requirements engineer. Convert the following acceptance criteria text into a single strict EARS-format requirement sentence.
   Use WHEN/THE for event-driven, IF/THE for failure/error cases, WHILE/THE for ongoing conditions, WHERE/THE for conditional features.
   Include one of SHALL, SHOULD, or MAY as the modality.
   Return only the single converted requirement sentence. No explanation, no preamble.
   ```
2. Export new function `convertToEars(rawText: string, opts: { timeoutMs: number; model?: string }): Promise<string>`:
   - Calls `BedrockRuntimeClient` with `InvokeModelCommand`, no forced tool-use, `max_tokens: 512`
   - Wraps the call with an `AbortSignal.timeout(opts.timeoutMs)`
   - On timeout: throws `ConversionTimeoutError`
   - On any other error: throws `ConversionError`
   - Returns the text content of the first content block in the model response
3. Export error classes: `ConversionTimeoutError`, `ConversionError`

**Acceptance criteria:**
- `convertToEars` with a mocked Bedrock response returns the model's text output
- Timeout (mock delay > timeoutMs) throws `ConversionTimeoutError`
- Bedrock error throws `ConversionError`
- `jira-ears-v1` prompt exists in `PROMPTS` and is used by `convertToEars`
- Existing `createBedrockClient` / `synthesizePlan` behaviour is unchanged

---

## T-05a — Tests for T-05

**Depends on:** T-05  
**Files:** `packages/functions/src/llm.test.ts` (existing or new)

1. Test: successful conversion returns model text
2. Test: timeout throws `ConversionTimeoutError`
3. Test: Bedrock error throws `ConversionError`
4. Test: `synthesizePlan` still works (regression)

---

## T-06 — EARS conversion cache in `repository.ts`

**Depends on:** T-01  
**Satisfies:** JR-23, design §3.4  
**Files:** `packages/functions/src/repository.ts`

Add two methods to the `Repository` class:

```typescript
async getEarsCache(rawTextHash: string): Promise<string | null>
// S3 GET requirements/ears-cache/{rawTextHash}.json
// Returns null on NoSuchKey. Re-throws all other S3 errors.

async putEarsCache(rawTextHash: string, earsText: string): Promise<void>
// S3 PUT requirements/ears-cache/{rawTextHash}.json, ContentType: application/json
// On S3 error: log.warn + swallow (non-fatal).
```

S3 key prefix `requirements/ears-cache/` does not collide with `requirements/{source}/snapshot.*` or `functional-tests/plan-cache/`.

**Acceptance criteria:**
- `getEarsCache` returns `null` for a key that doesn't exist
- `getEarsCache` returns the stored string for a key that does exist
- `putEarsCache` S3 error is swallowed and logged, not thrown
- `putEarsCache` write is verifiable in integration tests via subsequent `getEarsCache` call

---

## T-06a — Tests for T-06

**Depends on:** T-06  
**Files:** existing repository tests

1. Test: `getEarsCache` — cache miss returns null
2. Test: `getEarsCache` — cache hit returns string
3. Test: `putEarsCache` followed by `getEarsCache` returns same value
4. Test: `putEarsCache` S3 error swallowed (mock S3 to throw, verify no exception propagates)

---

## T-07 — `crawlJiraSource` and `performCrawl` integration

**Depends on:** T-02, T-03, T-04, T-05, T-06  
**Satisfies:** JR-10–JR-17, JR-20–JR-23, JR-30–JR-32, NFR-J1–NFR-J4, design §3.6, §3.7  
**Files:** `packages/functions/src/refresh.ts`

1. Implement `crawlJiraSource(client, source, repo, runId): Promise<SourceOutcome>` following the algorithm in design §3.6:
   - Streams stories via `client.search`, skips empty AC (JR-11)
   - Sets `section` from epic name (JR-31)
   - EARS check → cache lookup → `convertToEars` with fallback (JR-12, JR-22, JR-23)
   - Per-story `try/catch` → `invalid++` + warn log (JR-16)
   - Calls `putRequirements` with `contentHash`, `rawSnapshot`, `snapshotKey` (JR-14, JR-32)
2. Build `JiraSourceConfig` from `Config` at Lambda startup (reads all five SST Parameters + Secret)
3. Add Jira source loop after the GitHub source loop in `performCrawl`, using the same `try/catch` fault-isolation shell (JR-15)
4. `isEarsConforming(text)`: `/\b(WHEN|IF|WHILE|WHERE)\b/.test(text) && /\b(SHALL|SHOULD|MAY)\b/.test(text)`

**Acceptance criteria:**
- `POST /refresh` with Jira config present → Jira stories appear under `source: 'jira-awp'` in `GET /requirements`
- Story with empty AC is skipped (not stored)
- Story with non-EARS AC is converted and stored with `rawText` populated
- Story with EARS AC is stored as-is with no `rawText`
- LLM failure → story stored with `earsConforming: false`, `rawText` = original
- Jira source failure does not prevent GitHub sources from completing
- GitHub source failure does not prevent Jira sources from completing
- `crawlJiraSource` timeout (>20 s) → source marked `failed`, prior snapshot preserved
- 0 stories → outcome `success`, zeroed counts

---

## T-07a — Integration tests for T-07

**Depends on:** T-07  
**Files:** `packages/functions/src/refresh.test.ts` (existing integration test file)

Use existing mock patterns for GitHub sources as a model. Mock `JiraApiClient` and `convertToEars`.

1. Test: full happy path — 3 stories, 2 EARS, 1 non-EARS → correct DynamoDB items
2. Test: empty AC story skipped
3. Test: non-EARS story, cache miss → `convertToEars` called, result stored with `rawText`
4. Test: non-EARS story, cache hit → `convertToEars` NOT called
5. Test: `convertToEars` throws → story stored with `earsConforming: false`
6. Test: Jira source `JiraApiError` → source `failed`, other sources continue
7. Test: Jira source timeout → source `failed`, prior snapshot preserved
8. Test: 0 stories → `outcome: 'success'`, all counts zero
9. Test: `JIRA_API_TOKEN` absent → handler throws before crawl

---

## T-08 — SPA auto-converted badge

**Depends on:** T-02 (rawText field in API response)  
**Satisfies:** JR-42 (SPA shows auto-converted indicator), design §4  
**Files:** SPA requirements view component (locate via `find packages/web/src -name "*.tsx" | xargs grep -l "RequirementRecord\|requirements"`)

Add a small badge or indicator to the requirement detail/list view: when `record.rawText` is present and differs from `record.text`, show a label such as "Auto-converted" alongside the requirement. No new API work — `rawText` is already returned by the existing endpoint.

**Acceptance criteria:**
- A Jira-sourced requirement with `rawText !== text` displays the "Auto-converted" indicator
- A Jira-sourced requirement with no `rawText` (already EARS) shows no indicator
- A GitHub-sourced requirement shows no indicator
- No regressions in the existing requirements view for GitHub-sourced data

---

## T-08a — Tests for T-08

**Depends on:** T-08  
**Files:** SPA component tests

1. Test: record with `rawText` present → badge rendered
2. Test: record without `rawText` → badge not rendered
3. Test: record with `rawText === text` → badge not rendered (should not occur in practice but defensive)

---

## Scope check

| Task | Spec requirements | Design section |
|------|------------------|----------------|
| T-01 | design §2.0 (source-agnostic refactor) | §2.0, §3.5 |
| T-02 | JR-30 | §2.2, §2.3 |
| T-03 | JR-01, JR-02 | §2.5 |
| T-04 | JR-03, JR-11, JR-15, NFR-J1 | §3.1, §3.2 |
| T-05 | JR-20, JR-22, NFR-J3 | §3.3 |
| T-06 | JR-23 | §3.4 |
| T-07 | JR-10–17, JR-20–23, JR-30–32, NFR-J1–J4 | §3.6, §3.7 |
| T-08 | JR-42 | §4 |

**No task without a spec requirement:** all tasks trace to at least one JR-xx or a design §2.0 refactor decision.  
**OQ-J7 resolved:** S3 snapshot writes (JR-17) stay in T-07's scope — `crawlJiraSource` always passes `snapshotKey` + `rawSnapshot` to `putRequirements`.
