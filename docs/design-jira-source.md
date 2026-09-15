# Jira Source — Technical Design

> **Status:** Draft · **Design version:** 0.2.0 · **Owner:** nashah  
> Derived from `docs/spec-jira-source.md` (spec version 0.1.0). Spec is the oracle — where this document and the spec conflict, the spec wins.
>
> **v0.2 change:** DynamoDB and S3 structures are now source-agnostic. GitHub-specific field names (`specHash`, `specVersion`) replaced with generic equivalents. `putRequirements` no longer knows about file formats or S3 key conventions — that knowledge moves to the caller.

---

## 1. Architecture Overview

The Jira crawl slots into the **existing `performCrawl` loop** in `packages/functions/src/refresh.ts`. No new Lambda, no new trigger — the `POST /refresh` handler acquires the single-flight lock, then fans through all configured sources (GitHub + Jira) in sequence. Jira sources are fault-isolated at the same level as GitHub sources (the existing per-source `try/catch` on lines 98–181 of `refresh.ts`).

```
POST /refresh
  └── handleRefresh (refresh.ts)
        └── performCrawl
              ├── [existing] for each SourceConfig → crawlGitHubSource()
              └── [new]      for each JiraSourceConfig → crawlJiraSource()
                    ├── JiraApiClient.search(jql, acFieldId)  ← new jira.ts
                    │     └── GET /rest/api/3/search/jql  (nextPageToken-paginated, ≤20 s budget)
                    ├── for each story:
                    │     ├── extractAdfText(story.fields[acFieldId])
                    │     ├── IF not EARS → convertToEars(rawText)   ← new fn in llm.ts
                    │     │     └── BedrockRuntimeClient (jira-ears-v1 prompt)
                    │     │           ↕ cache: S3 requirements/ears-cache/{hash}.json
                    │     └── deriveEarsType / deriveModality  (requirements.ts, unchanged)
                    ├── repo.putRequirements(label, parsedRequirements, opts)   (unchanged)
                    ├── repo.putJiraSnapshot(label, rawJqlJson)   ← new thin wrapper
                    └── counts  →  folded into CrawlSummary (unchanged)
```

**New files:** `packages/functions/src/jira.ts`  
**Modified files:** `packages/functions/src/refresh.ts`, `packages/functions/src/repository.ts`, `packages/functions/src/llm.ts`, `packages/core/src/requirements.ts`, `stacks/AuthStack.ts`, `stacks/ApiStack.ts`

---

## 2. Data Models

### 2.0 Source-agnostic principle

DynamoDB items and S3 keys must carry no assumption about where a requirement came from. A GitHub `spec.md` blob SHA, a Jira JQL snapshot hash, and a future CSV checksum are all just an opaque `contentHash` string from the storage layer's perspective. Fields named after GitHub concepts (`specHash`, `specVersion`) are renamed to source-agnostic equivalents. The caller — `crawlGitHubSource` or `crawlJiraSource` — is responsible for computing and naming its own raw snapshot artifact; `putRequirements` accepts generic opts and does not know what format the content is in.

**Existing fields being renamed (breaking changes contained to `repository.ts` + callers):**

| Old name | New name | Reason |
|---|---|---|
| `RequirementRecord.specHash` | `RequirementRecord.contentHash` | Not always a spec file SHA |
| `RequirementRecord.specVersion` | `RequirementRecord.sourceVersion` | Optional; GitHub-only concept |
| `putRequirements` opts `.specHash` | opts `.contentHash` | Same |
| `putRequirements` opts `.rawSpec` | opts `.rawSnapshot` | Not always Markdown |
| S3 key `requirements/{source}/spec.md` | `requirements/{source}/snapshot` | Callers append own extension: `.md` for GitHub, `.json` for Jira |

The `reqSpecKey` constant in `repository.ts` is deleted. `putRequirements` accepts `opts.snapshotKey?: string` — the full S3 key. If omitted, no S3 write occurs. Each crawl function owns its own key convention:

```typescript
// GitHub crawler:
rawSnapshot: specContent,
snapshotKey: `requirements/${source.label}/snapshot.md`

// Jira crawler (pending OQ-J7 resolution — may be omitted entirely):
rawSnapshot: JSON.stringify(rawStories),
snapshotKey: `requirements/${source.label}/snapshot.json`
```

This resolves C-2 from design v0.1 entirely: there is no `.json`-under-`.md` problem because S3 keys are caller-owned.

### 2.1 `JiraSourceConfig` (new, `refresh.ts`)

```typescript
export interface JiraSourceConfig {
  label: string;               // 'jira-awp' — the source label used everywhere
  baseUrl: string;             // 'https://collegeboard.atlassian.net'
  jql: string;                 // 'project = BAWP AND issuetype = Story AND status != Done'
  acFieldId: string;           // 'customfield_11048'
  serviceAccountEmail: string; // from SST Parameter JIRA_SERVICE_ACCOUNT_EMAIL
}
```

Populated at Lambda startup from SST Parameters + Secret (§2.5). Structurally parallel to `SourceConfig` but not unified with it — the two have disjoint fields and different crawl paths.

### 2.2 `ParsedRequirement` extensions (backward-compatible, `packages/core/src/requirements.ts`)

Two optional fields are added to the existing interface:

```typescript
export interface ParsedRequirement {
  // --- existing fields (unchanged) ---
  id: string;
  text: string;
  section: string;
  earsType: EarsType;
  modality: Modality | null;
  earsConforming: boolean;
  // --- new optional fields (Jira-sourced only) ---
  rawText?: string;   // original AC field value before EARS conversion
  jiraUrl?: string;   // browser URL, e.g. https://collegeboard.atlassian.net/browse/BAWP-123
}
```

GitHub-sourced requirements never populate these fields. `putRequirements` in `repository.ts` passes them through to `RequirementRecord` items when present (see §2.3).

### 2.3 `RequirementRecord` — source-agnostic reshape (`packages/functions/src/repository.ts`)

```typescript
export interface RequirementRecord {
  // --- core fields (source-agnostic) ---
  source: string;
  id: string;
  text: string;
  section: string;
  earsType: string;
  modality: string | null;
  earsConforming: boolean;
  changedInLastCrawl: boolean;
  contentHash: string;        // renamed from specHash — opaque hash of the source snapshot
  sourceVersion?: string;     // renamed from specVersion — optional, GitHub-only today
  lastCrawledAt: string;
  // --- new optional fields (Jira-sourced only) ---
  rawText?: string;           // original AC text before EARS conversion (JR-30)
  jiraUrl?: string;           // browser URL, e.g. …/browse/BAWP-1551 (JR-30)
}
```

DynamoDB item build in `putRequirements` adds the new fields conditionally:

```typescript
...(r.rawText  ? { rawText:  r.rawText  } : {}),
...(r.jiraUrl  ? { jiraUrl:  r.jiraUrl  } : {}),
```

DynamoDB key pattern is unchanged: `PK = REQ#jira-awp`, `SK = R#BAWP-1551`.

### 2.4 Internal Jira types (new, `packages/functions/src/jira.ts`)

```typescript
interface JiraStory {
  key: string;                          // 'BAWP-1551'
  fields: {
    [acFieldId: string]: AdfDocument | null;
    parent?: { key: string; fields: { summary: string; issuetype: { name: string } } };
  };
}

interface AdfDocument {                 // Atlassian Document Format node
  type: string;
  version?: number;
  content?: AdfDocument[];
  text?: string;
}

interface JiraSearchPage {
  issues: JiraStory[];
  nextPageToken?: string;              // used for cursor-based pagination
  isLast: boolean;
}
```

### 2.5 SST Config additions (`stacks/AuthStack.ts`)

```typescript
// New Secret (set via `npx sst secrets set JIRA_API_TOKEN <value>`):
const jiraApiToken = new Config.Secret(stack, 'JIRA_API_TOKEN');

// New Parameters:
const jiraBaseUrl       = new Config.Parameter(stack, 'JIRA_BASE_URL',              { value: 'https://collegeboard.atlassian.net' });
const jiraJql           = new Config.Parameter(stack, 'JIRA_JQL',                   { value: 'project = BAWP AND issuetype = Story AND status != Done' });
const jiraAcFieldId     = new Config.Parameter(stack, 'JIRA_AC_FIELD_ID',           { value: 'customfield_11048' });
const jiraServiceEmail  = new Config.Parameter(stack, 'JIRA_SERVICE_ACCOUNT_EMAIL', { value: '' }); // set per-env
const jiraSourceLabel   = new Config.Parameter(stack, 'JIRA_SOURCE_LABEL',          { value: 'jira-awp' });
```

All five are bound to the `POST /refresh` Lambda function in `ApiStack.ts` alongside the existing `GITHUB_TOKEN` bindings.

`JIRA_API_TOKEN` is read in `refresh.ts` at startup:

```typescript
const JIRA_TOKEN = (Config as Record<string, string>).JIRA_API_TOKEN;
if (!JIRA_TOKEN) throw new Error('JIRA_API_TOKEN secret is absent or blank');
```

This produces the fast-fail behavior specified in the edge-case table (Lambda init fails before any crawl starts).

---

## 3. Component Responsibilities

### 3.1 `JiraApiClient` (`packages/functions/src/jira.ts`) — new

Single responsibility: execute the Jira REST API and return typed results.

```typescript
export class JiraApiClient {
  constructor(private baseUrl: string, private authHeader: string) {}

  async *search(
    jql: string,
    acFieldId: string,
    opts: { timeoutMs: number }
  ): AsyncGenerator<JiraStory>
  // Paginates via the response's nextPageToken cursor + maxResults=100 (D-J12 —
  // not startAt/total; those belong to the deprecated GET /rest/api/3/search).
  // Aborts (throws JiraTimeoutError) if cumulative fetch time exceeds opts.timeoutMs.
  // On HTTP 429: retries with exponential backoff (3 attempts, 1s/2s/4s), then throws.
  // On any other HTTP error: throws JiraApiError with status + body.
}
```

Auth header: `'Basic ' + Buffer.from(`${email}:${apiToken}`).toString('base64')`.

No state beyond `baseUrl` and `authHeader` — stateless and unit-testable in isolation.

### 3.2 `extractAdfText` (`packages/functions/src/jira.ts`) — new

```typescript
export function extractAdfText(doc: AdfDocument | null | undefined): string
```

Walks the ADF content tree depth-first, concatenating `node.text` values with newlines between block nodes. Returns `''` for null/undefined input. No npm dependency — ADF is plain JSON.

### 3.3 `convertToEars` (`packages/functions/src/llm.ts`) — new export

The existing `createBedrockClient` is purpose-built for `synthesizePlan(context: GroundedContext)` (test plan generation). The EARS conversion use case has a different input/output shape. Rather than distorting `synthesizePlan`, a new exported function is added to `llm.ts`:

```typescript
export async function convertToEars(
  rawText: string,
  opts: { timeoutMs: number; model?: string }
): Promise<string>
// Calls BedrockRuntimeClient with the 'jira-ears-v1' prompt.
// Returns the converted EARS text string.
// Throws ConversionTimeoutError on timeout, ConversionError on other failures.
// The caller (crawlJiraSource) catches and applies JR-22 fallback.
```

A new prompt version is registered in the `PROMPTS` map:

```typescript
const PROMPTS: Record<string, string> = {
  v1: '...existing test-plan prompt...',
  'jira-ears-v1': `You are a requirements engineer. Convert the following acceptance criteria text into a single strict EARS-format requirement sentence.
Use WHEN/THE for event-driven, IF/THE for failure/error cases, WHILE/THE for ongoing conditions, WHERE/THE for conditional features.
Include one of SHALL, SHOULD, or MAY as the modality.
Return only the single converted requirement sentence. No explanation, no preamble.`,
};
```

Forced tool-use is **not** used here — the output is free-form text (a single sentence). `tool_choice` is omitted; `max_tokens: 512`.

### 3.4 EARS conversion cache (`packages/functions/src/repository.ts`) — new methods

```typescript
// In Repository class:
async getEarsCache(rawTextHash: string): Promise<string | null>
// S3 GET  requirements/ears-cache/{rawTextHash}.json → returns cached text or null

async putEarsCache(rawTextHash: string, earsText: string): Promise<void>
// S3 PUT  requirements/ears-cache/{rawTextHash}.json
```

`rawTextHash = sha256(rawText)` — computed inline in `crawlJiraSource`. The same Contracts S3 bucket, new key prefix (does not collide with `requirements/{source}/spec.md` or `functional-tests/plan-cache/`).

### 3.5 S3 snapshot write — moved to callers

`putJiraSnapshot` is removed as a separate method. `putRequirements` accepts `opts.snapshotKey?: string` and `opts.rawSnapshot?: string`. When both are present it performs the S3 write itself — same code path as the GitHub source now uses for `snapshot.md`. The Jira caller passes:

```typescript
snapshotKey: `requirements/${source.label}/snapshot.json`,
rawSnapshot: JSON.stringify(rawStories),
```

The GitHub caller is updated from `reqSpecKey(source)` / `rawSpec` to:

```typescript
snapshotKey: `requirements/${source.label}/snapshot.md`,
rawSnapshot: specContent,
```

`reqSpecKey` is deleted from `repository.ts`. This is the only change required in the GitHub crawl path; all other GitHub logic is untouched.

OQ-J7 is resolved (spec §6): keep the S3 write. The Jira caller always supplies `snapshotKey` and `rawSnapshot` as shown above.

### 3.6 `crawlJiraSource` (`packages/functions/src/refresh.ts`) — new function

```typescript
async function crawlJiraSource(
  client: JiraApiClient,
  source: JiraSourceConfig,
  repo: Repository,
  runId: string
): Promise<SourceOutcome>
```

Full algorithm:

```
counts = { discovered: 0, conforming: 0, nonConforming: 0, changed: 0, removed: 0 }
rawStories = []
startTimer()

for await (story of client.search(source.jql, source.acFieldId, { timeoutMs: 20_000 })):
  try:
    rawAc = extractAdfText(story.fields[source.acFieldId])
    if rawAc.trim() === '':
      continue  // JR-11 — skip empty AC

    epicName = story.fields.parent?.fields.summary ?? story.fields.parent?.key ?? 'Uncategorised'
    jiraUrl  = `${source.baseUrl}/browse/${story.key}`

    let text = rawAc
    let rawText: string | undefined = undefined

    if (!isEarsConforming(rawAc)):          // JR-12 — check for EARS keywords
      rawText = rawAc
      cached = await repo.getEarsCache(sha256(rawAc))  // JR-23 — cache hit
      if cached:
        text = cached
      else:
        try:
          text = await convertToEars(rawAc, { timeoutMs: 10_000 })  // NFR-J3
          await repo.putEarsCache(sha256(rawAc), text)
        catch:
          text = rawAc; rawText = rawAc  // JR-22 fallback — store raw, earsConforming: false

    parsed: ParsedRequirement = {
      id:            story.key,                     // JR-13
      text,
      section:       epicName,                      // JR-31
      earsType:      deriveEarsType(text),           // JR-21
      modality:      deriveModality(text),           // JR-21
      earsConforming: deriveModality(text) !== null, // JR-12 / JR-22
      rawText,                                       // JR-30 — omitted when text === rawAc
      jiraUrl,                                       // JR-30
    }
    rawStories.push(story)
    parsedRequirements.push(parsed)
  catch (storyErr):
    counts.invalid++
    log.warn('crawl.jira.story.failed', { runId, key: story.key, reason: redact(storyErr) })  // JR-16

rawSnapshot = JSON.stringify(rawStories)
counts = await repo.putRequirements(source.label, parsedRequirements, {
  contentHash:  sha256(rawSnapshot),                             // JR-32 — renamed from specHash
  rawSnapshot,                                                   // JR-17 — pending OQ-J7
  snapshotKey: `requirements/${source.label}/snapshot.json`,    // JR-17 — pending OQ-J7
})
return { label: source.label, outcome: 'success', requirements: counts }
```

`isEarsConforming(text)` = `/\b(WHEN|IF|WHILE|WHERE)\b/.test(text) && /\b(SHALL|SHOULD|MAY)\b/.test(text)`.

### 3.7 Integration into `performCrawl` (`packages/functions/src/refresh.ts`)

The Jira sources array is built alongside GitHub sources at Lambda startup. In `performCrawl`, after the existing GitHub source loop:

```typescript
for (const jiraSource of jiraSources) {
  const outcome: SourceOutcome = { label: jiraSource.label, outcome: 'success' };
  try {
    const result = await crawlJiraSource(jiraClient, jiraSource, repo, runId);
    outcomes.push(result);
  } catch (err) {
    outcome.outcome = 'failed';
    outcome.reason = redact((err as Error).message);
    log.error('crawl.jira.source.failed', { runId, source: jiraSource.label, reason: outcome.reason });
    outcomes.push(outcome);
  }
}
```

Identical fault-isolation level as GitHub sources (R-13 / JR-15).

---

## 4. API Surface

No new endpoints. All three JR-40/41 requirements are already satisfied by the existing route handlers — they query by `source` label, which is now `'jira-awp'`. The `RequirementRecord` shape is extended (§2.3) but the DynamoDB→API serialisation is a passthrough, so `rawText` and `jiraUrl` appear automatically in `GET /requirements`, `GET /requirements/jira-awp`, and `GET /requirements/jira-awp/BAWP-1551` responses.

**SPA (JR-42):** the existing requirements view renders all `RequirementRecord` fields. An "auto-converted" badge can be added with a single conditional in the React component: `if (record.rawText && record.rawText !== record.text) → show badge`. This is a frontend-only change, no API work.

---

## 5. Integration Boundaries and Error Handling

| Boundary | Normal path | Failure handling |
|----------|-------------|-----------------|
| `crawlJiraSource` → Jira REST API | `GET /rest/api/3/search/jql` paginated via `nextPageToken`, `Authorization: Basic …` | HTTP 4xx/5xx → `JiraApiError` → outer source `catch` → `outcome: 'failed'`, other sources continue (JR-15). HTTP 429 → exponential backoff 3×, then throw. |
| `crawlJiraSource` → `JiraApiClient.search` timeout | `AbortController` on each `fetch`, cumulative timer | Cumulative >20 s → `JiraTimeoutError` → outer `catch` → `outcome: 'failed'` (NFR-J1). |
| per-story `extractAdfText` | Walk ADF JSON tree | Any throw (malformed ADF) → per-story `catch` → skip + `invalid++` (JR-16). |
| per-story `convertToEars` | Bedrock `InvokeModelCommand`, 10 s timeout | Timeout or model error → `ConversionTimeoutError` / `ConversionError` → `text = rawAc`, `earsConforming: false` (JR-22, NFR-J3). |
| `repo.getEarsCache` / `putEarsCache` | S3 GetObject / PutObject | `NoSuchKey` on get = cache miss (normal). Any other S3 error on put = log + skip cache write (non-fatal). |
| `repo.putRequirements` | DynamoDB BatchWrite | Failure → inner requirements `catch` in `performCrawl` → `counts.requirements.failed = true` (existing pattern). |
| `repo.putJiraSnapshot` | S3 PutObject | Failure → `log.warn` + swallow (provenance-only, non-blocking per JR-17 intent). |
| Bedrock IAM | Lambda execution role `bedrock:InvokeModel` | Already granted (D-55). No new IAM changes needed. |
| `JIRA_API_TOKEN` absent | Config.JIRA_API_TOKEN present at init | Absent/blank → throw at Lambda init → 500 before any crawl (edge case table). |

**Secrets in logs:** `redact()` is applied to all error messages that could contain the API token. `authHeader` is never logged. (NFR-J2)

---

## 6. Failure Modes — Full Enumeration

1. **Jira instance unreachable** (DNS/network) → `JiraApiError` → source `failed`, GitHub crawls unaffected.
2. **Jira returns HTTP 401** (bad/expired token) → `JiraApiError` → source `failed`. Operator action: rotate Secret.
3. **Jira returns HTTP 429** (rate limit) → 3 retries with 1s/2s/4s backoff → if still 429, source `failed`.
4. **Single story fetch error** (malformed response body) → per-story `catch` → skip + `invalid++`.
5. **ADF extraction throws** (malformed ADF structure) → per-story `catch` → skip + `invalid++`.
6. **Bedrock LLM timeout (>10 s)** → `ConversionTimeoutError` → store rawText, `earsConforming: false`.
7. **Bedrock returns non-EARS text** → `deriveModality` returns `null` → `earsConforming: false` (JR-22).
8. **Crawl budget exceeded (>20 s cumulative)** → `JiraTimeoutError` → source `failed` with partial results discarded (the `putRequirements` call is skipped; prior snapshot preserved).
9. **S3 snapshot write fails** → logged, swallowed — does not affect DynamoDB writes.
10. **DynamoDB `putRequirements` fails** → inner requirements `catch` → `counts.requirements.failed = true`, source `outcome` = `'success'` with failed sub-record (existing pattern, matches GitHub source behavior).
11. **`JIRA_API_TOKEN` absent at init** → Lambda cold-start throws → 500 returned to caller before any crawl begins.
12. **0 stories returned by JQL** → `parsedRequirements = []` → `putRequirements` wipes nothing, returns zeroed counts → `outcome: 'success'` (edge case table).

---

## 7. Spec Conflicts and Design Notes

**Conflict C-1: `llm.ts` interface mismatch**  
Spec JR-20 says "invoke the existing Bedrock LLM client." The existing `LlmClient.synthesizePlan(context: GroundedContext)` is purpose-built for test plan generation and cannot accept a plain string. **Resolution:** add a new exported function `convertToEars()` to `llm.ts` (§3.3). This shares the same `BedrockRuntimeClient` dependency and `PROMPTS` registry without distorting the existing interface. The spec intent is satisfied: same Lambda, same IAM grant, same Bedrock client infrastructure.

**C-2 (resolved in v0.2):** The `putRequirements` / S3 key coupling is fully resolved by the source-agnostic redesign in §2.0. `reqSpecKey` is deleted; callers own their S3 key convention; `putRequirements` is format-blind.

**Design note D-1: ADF extraction without npm**  
`customfield_11048` is an ADF document (Atlassian Document Format). The field contains a JSON tree. Extracting plain text requires walking `node.content` recursively and concatenating `node.text` values. This is ~20 lines of TypeScript with no npm dependency. The existing codebase avoids heavy dependencies for simple transforms; this follows that pattern.

**Design note D-2: Jira source is currently a single configured source**  
The spec supports multiple `JiraSourceConfig` entries (JR-01: "one or more"). The implementation will support an array (iterated in `performCrawl`), but the SST Parameters currently define one set. Adding a second Jira source would require additional SST Parameters or a JSON-encoded multi-source config string. This is deferred — the architecture supports it, but only one source is wired at deploy time.

**Design note D-3: `sourceVersion` is source-specific and optional**  
The field is renamed from `specVersion` to `sourceVersion` and remains optional. The GitHub crawler populates it from the `**Spec version:** X.Y.Z` marker. The Jira crawler omits it — Jira stories carry no equivalent concept. Future sources may populate it with whatever versioning signal is meaningful for them (e.g. a CSV schema version). The storage and API layers treat it as an opaque optional string.

---

## 8. Design Review Checklist

| Check | Status |
|-------|--------|
| Every JR-xx requirement addressed by at least one component | ✅ See §3 |
| Every integration boundary has an error handling strategy | ✅ See §5 and §6 |
| Tech stack matches constraints (Lambda, no new infra, existing Bedrock grant) | ✅ |
| Data model handles all edge cases in the spec (§5) | ✅ See §2 |
| NFR-J1 (30 s Lambda budget, 20 s Jira abort) addressed | ✅ See §3.1, §6 item 8 |
| NFR-J2 (no token in logs) addressed | ✅ `redact()` + no `authHeader` logging |
| NFR-J3 (10 s LLM timeout) addressed | ✅ `convertToEars` opts.timeoutMs |
| NFR-J4 (Jira fault-isolated from GitHub) addressed | ✅ Separate loop, same try/catch shell |
| Nothing contradicts out-of-scope section | ✅ No write-back to Jira, no contracts from Jira, no dedup |
| Spec conflicts surfaced | ✅ C-1 (llm interface), C-2 (S3 key) — both resolved |
