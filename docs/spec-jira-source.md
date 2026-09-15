# Jira Source for the ODCS Contract Registry — Specification

> **Status:** Draft (Phase 1 — Specify) · **Spec version:** 0.1.0 · **Owner:** nashah
> This spec is the **oracle** for the Jira source feature. Code, tests, and design derive from it. If code and spec disagree, the spec wins until explicitly changed here.

---

## 1. Purpose and Context

The registry currently ingests EARS requirements from one source: `awp-app-plane`'s `docs/spec.md`, crawled via the GitHub API on each `POST /refresh`. That document captures system-level requirements written by engineers.

Jira stories capture a complementary, product-level perspective: acceptance criteria authored by product owners and BAs, linked to sprints, epics, and business context. This feature adds Jira as a **second requirement source**, crawled on the same `POST /refresh` trigger. Each matching Jira story's acceptance criteria field is fetched, converted to strict EARS format (via the existing LLM pipeline where needed), and stored in the registry under a new source label (e.g. `jira-awp`) using exactly the same `RequirementRecord` schema and DynamoDB key pattern already used for GitHub-sourced requirements.

The demonstrated principle: requirements from any authoritative source — not just a `spec.md` file — can be normalised to EARS and made queryable alongside the contracts they govern.

---

## 2. Out of Scope (this system will NOT do)

- **Writing back to Jira.** The registry only reads Jira. It will not create, update, transition, or comment on issues.
- **Real-time / webhook-triggered Jira sync.** Jira requirements are fetched only on `POST /refresh`, the same trigger as GitHub crawls. An automatic webhook or event-driven refresh is out of scope.
- **Crawling arbitrary Jira projects at request time.** The JQL filter and Jira source label are fixed configuration (mirrors the GitHub source model — D-5). Adding a Jira source is a config/redeploy action, not a runtime API.
- **Jira contract files (ODCS).** This feature adds Jira as a **requirements** source only. Jira is not a source of ODCS contracts. Contracts still come exclusively from GitHub.
- **Cross-source requirement deduplication or merging.** A Jira story about `CRE-R-24` and a `spec.md` bullet `CRE-R-24` are stored as two independent records in two independent sources. Reconciling them is out of scope (mirrors D-47).
- **Jira story history.** Only the latest crawl snapshot is stored. Requirements are not append-only versioned (mirrors D-45 for the GitHub source).
- **Non-acceptance-criteria Jira fields.** Summary, description (outside the AC field), comments, assignee, priority, and all other Jira fields are ignored. Only the configured acceptance criteria field and the issue key are used.
- **Jira issues without an acceptance criteria field value.** Stories with an empty or absent acceptance criteria field are skipped without error.
- **LLM synthesis of test plans from Jira requirements.** The existing functional test generator (§3.11) may be extended separately; that is out of scope for this feature.
- **acli dependency at runtime.** The crawl runs inside a Lambda (no shell). Jira access uses the Atlassian REST API over HTTPS, not `acli`.

---

## 3. Functional Requirements (EARS)

> EARS keywords: **WHEN** (event) · **IF** (unwanted/error) · **WHILE** (state) · **WHERE** (optional/conditional feature) · **SHALL** (mandatory) / **SHOULD** (preferred) / **MAY** (optional). Every requirement is numbered `JR-nn`.

### 3.1 Jira Source Configuration

- **JR-01** — THE registry SHALL support one or more **Jira source configurations**, each carrying: a stable **source label** (e.g. `jira-awp`), the Jira instance base URL, a **JQL filter string**, and the name of the acceptance criteria field to read (e.g. `Acceptance Criteria`). The JQL filter, base URL, and field name SHALL be supplied as **SST Parameters** (not hardcoded), following the same runtime-override model as `SOURCE_BRANCH` and `CONTRACT_PATH_PREFIX` (D-65).

- **JR-02** — THE registry SHALL authenticate to the Jira REST API using a **Jira API token** supplied as an **SST Secret** (never committed to source, never returned by any endpoint), paired with the service-account email address supplied as an SST Parameter.

- **JR-03** — WHERE a Jira source is configured, THE registry SHALL execute the JQL search (`GET /rest/api/3/search/jql?jql=…&fields=key,{acField}&maxResults=100`) against the configured Jira instance and page through all results, using the response's `nextPageToken` for each subsequent request, until `isLast` is `true`. **Verified against the live BAWP project (2026-09-08):** the classic `/rest/api/3/search` endpoint's `startAt`/`total` pagination is deprecated on this instance; the current endpoint returns `{ issues, nextPageToken, isLast }` with no `startAt` or `total` field.

### 3.2 Jira Crawl (write path, integrated into POST /refresh)

- **JR-10** — WHEN an authorised writer invokes `POST /refresh`, THE registry SHALL crawl **every** configured Jira source in the same pass as the GitHub sources, fault-isolated in the same per-source try/catch pattern (R-13).

- **JR-11** — FOR each Jira story returned by the JQL search, THE registry SHALL read the configured acceptance criteria field. IF the field is absent or empty for a story, THE registry SHALL skip that story without recording an error.

- **JR-12** — WHEN a story's acceptance criteria text is present, THE registry SHALL assess whether it is already in strict EARS format (contains at least one of `WHEN`, `IF`, `WHILE`, `WHERE`, `SHALL`, `SHOULD`, or `MAY`). WHERE the text is already EARS-conforming, THE registry SHALL store it as-is. WHERE the text is NOT EARS-conforming, THE registry SHALL pass it through the **EARS conversion pipeline** (JR-20) before storing.

- **JR-13** — THE registry SHALL assign each Jira story a **requirement id** equal to its Jira issue key (e.g. `AWP-123`). The `{source, id}` composite key (R-106) SHALL be `{jira-awp, AWP-123}`, making Jira ids disjoint from GitHub `R-nn` ids.

- **JR-14** — WHEN a Jira crawl completes for a source, THE registry SHALL store the results using the **same `putRequirements` / `wipeRequirements` interface** as the GitHub requirements crawl, producing a `RequirementCounts` record folded into the crawl-run summary (R-108). The DynamoDB key pattern SHALL be `PK=REQ#{source}`, `SK=R#{id}` (e.g. `REQ#jira-awp`, `R#AWP-123`).

- **JR-15** — IF the Jira REST API is unreachable or returns an HTTP error for the entire search, THE registry SHALL record that Jira source's outcome as **failed** in the crawl-run record, SHALL continue crawling the remaining sources (GitHub and any other Jira sources), and SHALL leave the previously-cataloged Jira requirements for the failed source unchanged (mirrors R-13).

- **JR-16** — IF the Jira API returns an HTTP error for a **single story's field fetch** (as opposed to the whole search), THE registry SHALL skip that story, increment an `invalid` counter, log a structured warning, and continue (mirrors the per-file fault isolation in R-21).

- **JR-17** — WHEN a Jira crawl completes, THE registry SHALL store the raw JQL result (as a JSON string) in S3 under a key analogous to `requirements/{source}/spec.md` (e.g. `requirements/jira-awp/jql-snapshot.json`) for provenance. This is the Jira analogue of R-114.

### 3.3 EARS Conversion Pipeline

- **JR-20** — WHEN a story's acceptance criteria text is not EARS-conforming (JR-12), THE registry SHALL invoke the **existing Bedrock LLM client** (from `packages/functions/src/llm.ts`) with a **Jira-to-EARS conversion prompt** to rewrite the text into a single strict EARS sentence. The converted text SHALL be stored as the requirement's `text` field; the original raw text SHALL be stored in an additional `rawText` field on the `RequirementRecord`.

- **JR-21** — THE registry SHALL derive `earsType` and `modality` from the **converted** EARS text (not the raw text), using the existing `deriveEarsType` / `deriveModality` logic in `packages/core/src/requirements.ts`.

- **JR-22** — IF the LLM conversion fails or returns a response that is not EARS-conforming after conversion (e.g. no modality keyword), THE registry SHALL store the **original raw text** with `earsConforming: false` and `modality: null`, rather than discarding the requirement (mirrors R-21's fault-tolerant approach to invalid contracts).

- **JR-23** — THE registry SHALL cache EARS conversions by a hash of the raw acceptance criteria text (mirrors R-119's plan-cache model). IF the same raw text is seen again in a subsequent crawl, THE registry SHALL reuse the cached conversion rather than calling the LLM again.

### 3.4 Requirement Records

- **JR-30** — Each Jira-sourced `RequirementRecord` stored in DynamoDB SHALL carry all existing fields (`source`, `id`, `text`, `section`, `earsType`, `modality`, `earsConforming`, `changedInLastCrawl`, `specHash`, `lastCrawledAt`) plus two Jira-specific additions: `jiraUrl` (the browser URL of the story, e.g. `https://collegeboard.atlassian.net/browse/AWP-123`, always present) and `rawText` (the original AC field value, present **only** when the story was passed through EARS conversion — JR-12, JR-20 — and omitted when the story was already EARS-conforming, so its absence itself signals "not converted").

- **JR-31** — THE `section` field for Jira-sourced requirements SHALL be set to the Jira **epic name** (or epic key if no name) when the story is linked to an epic, and to the string `"Uncategorised"` when it is not. This mirrors the `### 3.x` sub-heading section used for GitHub-sourced requirements.

- **JR-32** — THE `specHash` field for Jira-sourced requirements SHALL be set to the SHA-256 hash of the full serialised JQL response (the same value written to S3 by JR-17), giving the crawl-run record a stable change signal analogous to the `docs/spec.md` blob SHA used for GitHub sources.

### 3.5 API Surface

- **JR-40** — The existing `GET /requirements` endpoint SHALL return Jira-sourced requirements alongside GitHub-sourced requirements with no schema change; the `source` field distinguishes them (e.g. `source: "jira-awp"`).

- **JR-41** — The existing `GET /requirements/{source}` and `GET /requirements/{source}/{id}` endpoints SHALL serve Jira-sourced requirements using the Jira source label and Jira issue key as path segments (e.g. `GET /requirements/jira-awp/AWP-123`).

- **JR-42** — THE registry's SPA requirements view SHALL display Jira-sourced requirements with the same UI treatment as GitHub-sourced requirements. WHERE `rawText` differs from `text` (i.e. LLM-converted), the SPA SHOULD indicate that the requirement was auto-converted.

---

## 4. Non-Functional Requirements

- **NFR-J1** — The Jira crawl SHALL complete within the existing `POST /refresh` Lambda timeout budget (NFR-1: 30 s total). WHERE a JQL result set is large, the Jira crawl SHALL page using the `nextPageToken` cursor + `maxResults=100` (JR-03) and SHALL abort with a `failed` outcome (not hang) if cumulative fetch time for a source exceeds 20 s **or the 28 s overall crawl budget (30 s minus a 2 s safety margin), whichever is less** — the Jira phase's timeout SHALL be reduced by however much of the overall budget the GitHub phase already consumed, not a fresh 20 s regardless of elapsed time (D-J14).

- **NFR-J2** — The Jira API token and service-account email SHALL never appear in logs, responses, or error messages. Redaction SHALL use the existing `redact()` utility (mirrors NFR-2), extended to accept the literal secret values as an exact-match scrub list (D-J15) — a GitHub-token-shaped regex alone does not recognize Jira's tokens/emails, which have no fixed prefix.

- **NFR-J3** — The LLM conversion call for a single story SHALL time out after 10 s. A timeout SHALL be treated identically to a failed conversion (JR-22): store raw text with `earsConforming: false`.

- **NFR-J4** — The Jira source SHALL be independently fault-isolated: a complete Jira source failure SHALL NOT prevent GitHub sources from completing, and vice versa (mirrors NFR-4 / R-13).

---

## 5. Edge Cases

| Condition | Expected behaviour |
|-----------|-------------------|
| Jira returns 0 stories for the JQL filter | Record zero discovered, zero removed, zero changed — `success`. Do not wipe prior snapshot (treat as unchanged, not absent). |
| Story AC field is present but contains only whitespace | Treat as absent (JR-11): skip the story. |
| Same Jira issue key appears twice in paginated results | Keep first, record id-collision warning (mirrors R-30a / D-49). |
| LLM converts AC text to EARS but result contains no modality | Store converted text with `earsConforming: false` (JR-22). |
| Jira API returns 429 (rate limit) | Retry with exponential backoff up to 3 attempts; if still failing, record source as failed (JR-15). |
| Story is linked to an epic whose name cannot be fetched | Set `section` to the epic key (e.g. `"AWP-EP-4"`), not `"Uncategorised"`. |
| LLM conversion cache key collision (hash collision) | Astronomically unlikely; no special handling — the cached text is stored and used as-is. |
| `JIRA_API_TOKEN` SST Secret is absent or blank at Lambda startup | Lambda init fails fast with a structured error; the `POST /refresh` handler returns 500 before any crawl starts. |
| Jira story AC text is already EARS-conforming | Skip the LLM call entirely; store as-is (JR-12). `rawText` is omitted entirely (not written equal to `text`) — its absence is the no-conversion signal (JR-30). |

---

## 6. Open Questions

- **OQ-J1 (RESOLVED 2026-08-20)** — JQL filter confirmed:
  ```
  project = BAWP AND issuetype = Story AND status != Done
  ```
  Project key is `BAWP` ("Bluebook Authentic Work Platform"). Status filter excludes Done stories (656 as of resolution date), keeping 770 active stories. `customfield_11048 is not EMPTY` is intentionally omitted here since JR-11 already skips empty-AC stories at the crawl layer — the JQL filter stays broad. If crawl volume becomes a concern, add `AND customfield_11048 is not EMPTY` to pre-filter at the API level.

- **OQ-J2 (RESOLVED 2026-08-20)** — Acceptance Criteria field ID: **`customfield_11048`**. Confirmed from live issue BAWP-1551 (the ADF document at `customfield_11048` contains the Given/When/Then acceptance scenarios). Use this field ID in all `GET /rest/api/3/search/jql?fields=key,customfield_11048` calls (JR-03).

- **OQ-J3 (RESOLVED 2026-09-08)** — Jira instance base URL: **`https://collegeboard.atlassian.net`** (confirmed). Cloud ID: `92589c41-ec63-4cb0-b780-a9b9f279c818`. Service-account email: **`nashah@collegeboard.org`** (personal account) for now. **Reason:** a dedicated `svc-*@collegeboard.org` account has not been provisioned yet; using the personal account unblocks implementation and non-production testing. **Caveat:** this is a temporary substitution, not a long-term answer — a personal API token in an SST Secret works mechanically the same as a service-account token (JR-02 is unaffected either way), but the personal account should be swapped for a dedicated service account before this crawl runs against production data or on a schedule anyone other than the account owner relies on. Track that swap as a follow-up before a production deploy (org policy also prohibits deploying this feature directly to production without that swap).

- **OQ-J4 (RESOLVED 2026-09-08)** — Jira source label: **`jira-awp`**. **Reason:** mirrors the existing GitHub source label style; the API path (`/requirements/jira-awp/BAWP-123`) already implies these are Jira stories, so no `-stories` suffix is needed.

- **OQ-J7 (RESOLVED 2026-09-08)** — Store the raw JQL search results to S3. **Decision:** keep JR-17 and JR-32 as written — the Jira crawler writes its raw JQL response to `requirements/jira-awp/snapshot.json` for provenance, exactly mirroring what the GitHub crawler does for `spec.md`. **Reason:** the original concern (adapting `putRequirements`'s S3 integration for a JSON payload) was already resolved by the source-agnostic redesign in the design doc (§2.0) — `putRequirements` takes a caller-supplied `snapshotKey` + `rawSnapshot` and writes whatever bytes/key it's given, so there is no remaining key-naming awkwardness to weigh against the value of provenance.

- **OQ-J5 (RESOLVED 2026-09-08)** — LLM conversion model: reuse the existing `BedrockRuntimeClient` + Claude model from `llm.ts`, with a new `jira-ears-v1` prompt. **Reason:** zero new infrastructure or IAM grants, and a single-sentence rewrite isn't expensive enough on any model to justify maintaining a second `LlmClient` dependency.

- **OQ-J6 (RESOLVED 2026-09-08)** — SPA indicator for auto-converted requirements: just a badge (e.g. "Auto-converted"), not a full `rawText` vs `text` diff view. **Reason:** the badge is a one-line UI change using data the API already returns; a full diff view can be added later if there's real demand to compare wording closely.

---

## 7. Decisions Log

> Decisions made during spec authoring.

- **D-J1** — Jira requirements use the Jira issue key (e.g. `AWP-123`) as the requirement id, not a synthesised `R-nn`. **Reason:** issue keys are the canonical Jira identity; engineers and PMs reference them by key. **How:** `id = issue.key`; the `{source, id}` composite key is `{jira-awp, AWP-123}`.

- **D-J2** — Jira is a requirements source only, not a contract source. **Reason:** ODCS contracts are a distinct artifact type; Jira has no ODCS YAML. Mixing the two types would require contract-path changes with no benefit.

- **D-J3** — EARS conversion uses the existing Bedrock LLM client, not a separate service. **Reason:** the registry already has an IAM grant for `bedrock:InvokeModel` on the refresh Lambda (D-55 vicinity); adding a new prompt version is a zero-infrastructure change.

- **D-J4** — LLM-converted requirements store `rawText` alongside `text`; already-EARS requirements omit `rawText` entirely rather than writing it equal to `text`. **Reason:** traceability — a reader can always see what the original AC said, and detect LLM drift on re-crawl (mirrors R-114's raw-spec storage principle). Omitting `rawText` when no conversion happened, rather than duplicating `text` into it, makes its mere presence a direct "this was auto-converted" signal — matching what JR-42's SPA badge (and D-J13's audit finding) actually check (`rawText && rawText !== text`, which still holds either way, but omission is the simpler and now-canonical contract). This corrects the original spec/design wording ("always present"), which the implementation never actually matched.

- **D-J5** — Jira crawl runs inside the existing `POST /refresh` handler, not a separate Lambda or job. **Reason:** keeps the "one refresh → full catalog sync" contract simple. If Jira crawls grow slow enough to threaten the Lambda timeout, this decision should be revisited and a fan-out pattern introduced (see NFR-J1).

- **D-J6** — Stories with empty AC are silently skipped (not flagged as invalid). **Reason:** an empty AC field is routine Jira hygiene debt, not a registry error. Surfacing every such skip as an `invalid` would produce noisy crawl summaries.

- **D-J7** — The Jira service account for now is the personal account `nashah@collegeboard.org`, not a dedicated `svc-*@collegeboard.org` account (OQ-J3). **Reason:** unblocks implementation and testing while a dedicated account is provisioned. **How:** `JIRA_SERVICE_ACCOUNT_EMAIL` SST Parameter is set to the personal email for now; swap to a dedicated service account before any production deploy or unattended scheduled run.

- **D-J8** — The raw JQL search result is written to S3 for provenance (OQ-J7): JR-17 and JR-32 stay in scope. **Reason:** the design's source-agnostic `putRequirements` (caller-supplied `snapshotKey` + `rawSnapshot`) already removes the key-naming complexity that originally made this an open question.

- **D-J9** — Jira source label is `jira-awp` (OQ-J4). **Reason:** consistent with existing GitHub source label naming; the API path already conveys these are Jira stories.

- **D-J10** — EARS conversion reuses the existing Bedrock client/model rather than a cheaper alternative (OQ-J5). **Reason:** no new infrastructure, and the task is too cheap on any model to justify a second LLM dependency.

- **D-J11** — The SPA shows only an "auto-converted" badge, not a full text diff (OQ-J6). **Reason:** minimal UI change using data already returned by the API; a diff view is deferred until there's demonstrated need.

- **D-J12** — The Jira search call targets `GET /rest/api/3/search/jql` and paginates via the response's `nextPageToken` + `isLast`, not `GET /rest/api/3/search` with `startAt`/`total` as JR-03 and NFR-J1 originally said. **Reason:** verified live against the BAWP project on 2026-09-08 — the classic `startAt`-paginated endpoint is deprecated on this instance and returns the cursor-shaped response instead. The design doc's `JiraSearchPage` type (`nextPageToken`/`isLast`) already anticipated this; only the spec's endpoint/pagination wording and one design code comment were out of date.

- **D-J13** — JR-16's per-story failure counter is surfaced as `invalid` on the Jira source's crawl-run outcome record, the same field GitHub sources already use for invalid-contract-file counts (not a new field on `RequirementCounts`). **Reason:** the design's `crawlJiraSource` pseudocode incremented a local `invalid` counter but then discarded it by reassigning the whole variable to `putRequirements`'s return value — a bug in the pseudocode, since `RequirementCounts` (JR-14) has no `invalid` field to hold it. Reusing the existing crawl-outcome `invalid` field (already present for GitHub sources, now optional so a Jira outcome can also set it) preserves the count without widening the requirements-catalog schema. Also made the GitHub-only outcome fields (`discovered`, `valid`, `newVersion`, `unchanged`, `branch`) optional on the shared outcome type, since a Jira source has no contract files or branch (D-J2).

- **D-J14** — The Jira crawl's per-source timeout is `min(20s, remaining-time-until-a-28s-overall-deadline)`, computed once at the start of `performCrawl` from `startedAt`, not a fresh 20 s regardless of how long the GitHub phase took (NFR-J1). If no time remains by the time the Jira loop starts, the source is recorded `failed` immediately without ever calling the Jira API. **Reason:** a spec-compliance audit found that the original fixed-20s design could let the combined GitHub+Jira runtime exceed the Lambda's actual 30s timeout, causing AWS to kill the function mid-crawl — losing the run record entirely, which is worse than every other failure mode in this spec, all of which fail gracefully with a recorded reason.

- **D-J15** — `redact()` (shared with the GitHub source, NFR-2) now accepts an optional list of literal secret values to scrub by exact match, in addition to its existing GitHub-token-shaped regex. The Jira crawl passes `[JIRA_API_TOKEN, JIRA_SERVICE_ACCOUNT_EMAIL]` at every point it logs or records an uncontrolled error message. **Reason:** a spec-compliance audit found that NFR-J2's "mirrors NFR-2" framing didn't hold in practice — GitHub PATs have a recognizable prefix a regex can catch without knowing the value, but Jira tokens and emails have no such shape, so the only reliable scrub is an exact match against the actual secret value, which the crawl already has in scope at every relevant catch site.
