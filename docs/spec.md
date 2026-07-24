# ODCS Contract Registry — Specification

> **Status:** Draft (Phase 1 — Specify, LLM Functional Test Generator component) · **Spec version:** 0.6.1 · **Owner:** naimish
> This spec is the **oracle**. Code, tests, and design derive from it. If code and spec disagree, the spec wins until explicitly changed here.
>
> **v0.6.1 (2026-07-17) — periodic health check (recipe Step 11, five-vector HC-1…HC-5, fresh-eyes auditors); no requirement behaviour weakened.** Closed drift the audit surfaced: **R-124** provenance (catalog context + per-skip reasons) is now persisted on the DynamoDB **job record**, not only the S3 manifest; the emitted **conformance** assertion now **names the offending record** (R-83); **R-60** wording corrected to describe the native Cognito SRP sign-in gate (the shipped, intentional behaviour — not a Hosted-UI redirect). Six implementation decisions made in code during the Bedrock/functest work were promoted to the log (**D-57**…**D-62**: worker sizing, IAM scope, `max_tokens`, publisher canonical-variant, entity-match heuristic, Scan-vs-GSI listing). New tests: `bedrock:InvokeModel` IAM-grant / no-stored-key, functional route wiring, redaction-on-failure, E-47 untouched-on-failure. **212 tests green** (194 offline + 18 web), `tsc` clean.
>
> **v0.6.0 (2026-07-16) — adds the LLM-Powered Functional Test Generator component** (§3.11, R-115…R-126; NFR-9; E-39…E-47; D-50…D-56): an **asynchronous** job turns the cataloged **ODCS contracts** (§3.9) **and** **EARS requirements** (§3.10) into **end-to-end cross-service functional tests** (publisher → CDC → consumer). Because a functional scenario lives in natural-language EARS prose the registry doesn't control (D-3), an **LLM synthesises a structured test-plan** (structured outputs, grounded in contracts + requirements + api-map — D-50/D-51); the plan is **cached by input-hash** and committed (D-52), then **rendered deterministically** to Vitest (R-119a). It runs **async** (`POST /generate-functional-tests` → job; `GET /functional-test-jobs/*`; CLI delivers for human review — D-53) and is **generate-and-store only** (D-56). R-88's byte-identical guarantee is **scoped out** of LLM synthesis. Claude runs on **Amazon Bedrock** (`InvokeModel`, forced tool use, IAM-role auth, no stored key — D-55). **✅ Implemented + deployed + live-verified 2026-07-16** (tasks T-33…T-39, tests-first; 207 tests green, synth clean; 34 grounded plans synthesised live by Sonnet 4.6). No contract/requirements-path behaviour changed.
>
> **v0.5.4 (2026-07-16) — fourth health-check pass (fresh-eyes, independent auditors); no requirement behaviour weakened.** Additive parity + polish: a repeated `R-nn` within one source is now recorded as a **`crawl.requirements.collision`** (keep-first was already so — **D-49**, **E-38**), giving requirements full parity with the contract R-30a rule; `GET /requirements` returns rows in **natural (numeric) id order** (**R-109**); `batchWriteAll` gained exponential backoff. Doc/comment corrections: design §9.1 named a non-existent `buildManifest` (it's `serializeManifest` + inline assembly); design §10.3 now lists the dedup step; the `StorageStack` item-kind comment adds `GEN#`/`REQ#`; the stale `compliance.md` CLI instruction (set `REGISTRY_API_URL`) was fixed to match D-35/D-36; spec-version stamps across the audit/AC docs re-synced.
>
> **v0.5.3 (2026-07-16) — third health-check pass (fresh-eyes, independent auditors); no requirement behaviour changed.** Code hardening: `putRequirements` now **de-duplicates a repeated `R-nn`** within one source's `docs/spec.md` (keep-first, enforcing the R-106 `{source, id}` key — mirrors the contract R-30a collision rule) so a duplicate id can't fail the batch. Test coverage: added the **present-but-no-requirements-section → wipe** path (`putRequirements([])`). Text correction: "unreadable" removed from R-105/E-29's wipe branch — a spec-doc that can't be fetched/parsed is R-105a (keep prior), not a wipe. Design header + §8 traceability updated for §10 (Requirements Catalog). No spec requirement changed.
>
> **v0.5.2 (2026-07-16) — second health-check pass (fresh-eyes, independent auditors); hardening + accuracy, no requirement behaviour weakened.** Code fixes: the requirements fault isolation (R-105a) now covers the **`docs/spec.md` fetch** — its bytes are read inside the isolated block (not eagerly in `crawlSourceFull`), so a transient spec-doc read error no longer discards the source's already-cataloged contracts; the snapshot BatchWrite now **retries `UnprocessedItems`** (R-107/NFR-4); the parser **keeps the section-heading number** (R-102). Text corrections (code was already right): R-114's S3 object is addressed by **{source}** (not "{source, content hash}"); D-43's redaction is **"the places"** (two sites — source- and requirements-failure `reason`); R-105 clarifies whole-source-crawl failure vs an isolated spec-doc read/parse error. Design §1/§3 aligned to reality.
>
> **v0.5.1 (2026-07-16) — Requirements Catalog health-check remediation (recipe Step 11):** ratifies the **absent-`docs/spec.md` = wipe-to-zero** semantics — a reachable source with no requirements document has its requirement snapshot **removed** (latest-snapshot, D-45), while a _fetch failure_ still keeps the prior snapshot (unobserved state). Also adds **fault isolation for the requirements crawl**: a requirements parse/store failure no longer fails the source's contract crawl — it is recorded as a failed requirements outcome and logged. Changes: R-105 rewritten; **R-105a** (requirements-failure isolation) and edge cases **E-36/E-37** added; E-29 tightened; both `crawl.requirements.done` and `crawl.requirements.failed` added to the D-43 log taxonomy; design §10.2/§10.3 corrected (`putRequirements` signature, `wipeRequirements`, the two events). No contract-path behaviour changed.
>
> **v0.5.0 (2026-07-15) — adds the Requirements Catalog component** (§3.10, R-100…R-114; E-29…E-35; D-44…D-48): the registry now also crawls each source repo's **`docs/spec.md`**, extracts its **EARS requirements**, and catalogs/serves them (API + SPA) alongside the ODCS contracts it already tracks. Requirements are cataloged **per source, latest-snapshot with a change flag** (no append-only history, deliberately unlike contracts — D-45), **independently** (no cross-repo requirement diff — D-47), in the **same `POST /refresh`** pass (D-44). Existing requirements R-01/R-03/R-10/R-12 and NFR-5 gain cross-references; no contract-path behaviour changed.
>
> **v0.4.2 (2026-07-15) — health-check remediation (D-37…D-42):** promotes five decisions that were live in code/design but absent from this log (Octokit crawler client, blob-SHA-as-content-hash, DynamoDB single-table + GSIs, presence+type conformance schema, CLI `--pull` mode); records the removal of an out-of-scope conformance test runner (D-42, re-affirming D-29/§2). No requirement text changed — NFR-5 (structured logging), R-12 (crawl end time), R-62 (detail metadata), R-82/R-86 (compat declared version), and R-89 (catalog commit context) were already mandated; the code was brought into compliance.
>
> **v0.4.1 (2026-07-15) — `generate-tests` CLI UX (D-35, R-91a):** the CLI now requires only a credential; non-secret endpoint coordinates auto-resolve (env > `generate-tests.config.json` > `.sst/outputs.json`), and the credential comes from env, a gitignored `.env`, or an interactive prompt.
>
> **v0.4.0 adds the Test Generator component** (§3.9, R-80…R-93; NFR-8; E-19…E-26; OQ-10…OQ-14; D-23…D-29): a contract-driven end-to-end **test generator** that reads the discovered catalog and emits live-API-conformance and cross-app-compatibility tests into this repo. **Generation + storage only**; _running_ the generated tests on demand is future work (§2).

---

## 1. Purpose and Context

This is a reference AWS application that implements an **ODCS contract registry**: a service that **discovers, validates, catalogs, and serves Open Data Contract Standard (ODCS v3.1.0) data contracts** by crawling the two sibling reference repositories — [`awp-odcs-publishing`](https://github.com/collegeboard-personal/awp-odcs-publishing) (the _publisher_) and [`awp-odcs-consuming`](https://github.com/collegeboard-personal/awp-odcs-consuming) (the _consumer_) — **on demand** via the GitHub API.

Each repository carries its own copy of four OneRoster v1.2 ODCS contracts — `org`, `user`, `class`, `enrollment`. Today these copies are **vendored independently and have already diverged** (`org` is identical across both; `user`/`class`/`enrollment` differ). The registry's job is to make that divergence **visible and queryable**: it catalogs **both apps' variants as they are, without reconciling them**, so a human or downstream tool can see exactly which contract each app publishes/consumes and where they disagree.

The demonstrated principle mirrors the two apps: a data contract is **validated, never assumed**. Here the registry validates every crawled document against the official ODCS v3.1.0 JSON schema before it is cataloged, and records the result rather than silently trusting the source.

---

## 2. Out of Scope (this system will NOT do)

- **Reconciling or merging divergent contracts.** The registry catalogs the publisher's and consumer's variants side by side; producing a single canonical contract per entity is explicitly out of scope (see §1, D-2).
- **Modifying the two source repositories.** The registry only _reads_ them via the GitHub API. Wiring either app to consume contracts _from_ the registry is future work (D-3).
- **Accepting contracts pushed in by clients** (`POST /contracts` upload). Contracts enter the registry **only** by crawling the configured source repos; there is no client-side publish/upload API (D-4).
- **Crawling arbitrary or user-supplied repositories at request time.** The set of source repos is fixed configuration (the two example apps). Adding a repo is a config/redeploy action, not a runtime API (D-5).
- **Compiling ODCS YAML to runtime JSON Schema.** Each app already compiles its own `*.schema.json`; the registry stores and serves the ODCS **source** documents (and, WHERE present, the app-compiled schema as an opaque attached blob — D-11), but does not run the compiler itself.
- **Editing, versioning-by-hand, or authoring contracts inside the registry.** It is read-and-catalog only; the git repos remain the authoring surface.
- **Enforcing OneRoster or cross-entity referential integrity** between cataloged contracts (e.g. that `enrollment.user` points at a real `user`). Out of scope.
- **Multi-region, multi-tenant, or multi-account deployment.** Single region, single account.
- **Scheduled / automatic crawling.** Crawls are triggered manually via the authenticated refresh endpoint; a cron schedule is out of scope for v1 (see OQ-6).
- **Public/anonymous access.** All endpoints (read and write) require Cognito authentication (D-6).
- **Running the generated tests.** The Test Generator (§3.9) and the functional generator (§3.11) _generate and store_ end-to-end tests only. Executing them — on demand, on a schedule, or in CI — is a **separate future feature** and is out of scope here (D-29, D-56). The generated Vitest files are therefore intentionally excluded from the registry's own unit test suites (R-93).
- **Byte-identical determinism of LLM-synthesised functional tests.** The §3.11 functional generator uses an LLM, which is non-deterministic; its determinism guarantee is limited to **re-rendering a cached plan** (R-119/R-119a), not to the LLM synthesis step. R-88's byte-identical guarantee is scoped to the §3.9 deterministic generator; it does **not** cover §3.11 plan synthesis (D-52).
- **Generating tests for arbitrary or uncataloged contracts.** The generator only reads contracts already in the catalog (populated by a prior crawl, R-10); it does not crawl GitHub itself, and it will not generate tests for repos/contracts outside the configured sources (R-81, D-5).
- **Authoring, hand-editing, or maintaining the generated tests.** The `generated-tests/` tree is a **generated artifact**: it is overwritten wholesale on each generation. Hand edits are not preserved (R-88, R-92).
- **Generating non-ODCS, load, security, or UI tests.** The generator emits contract-derived conformance and compatibility tests only; performance/security/end-user-UI test generation is out of scope.
- **Reconciling, merging, diffing, or authoring requirements.** The registry catalogs each source's EARS requirements (§3.10) **as they are, per source**; it does not compare requirements across sources, produce a canonical requirement set, or edit/author requirements (they are authored in each app's own `docs/spec.md`) — mirrors the contract stance (D-2), see D-47.

---

## 3. Functional Requirements (EARS)

> EARS keywords: **WHEN** (event) · **IF** (unwanted/error) · **WHILE** (state) · **WHERE** (optional/conditional feature) · **SHALL** (mandatory) / **SHOULD** (preferred) / **MAY** (optional). Every requirement is numbered `R-nn`.

### 3.1 Sources & Configuration

- **R-01** — The registry SHALL be configured with a fixed set of **source repositories**, each carrying a stable **source label** and its GitHub `owner/repo` and default branch. v1 SHALL define exactly two: `publisher` → `collegeboard-personal/awp-odcs-publishing` and `consumer` → `collegeboard-personal/awp-odcs-consuming`. (Each source additionally exposes an EARS requirements document at `docs/spec.md` — R-100.)
- **R-02** — The registry SHALL authenticate to the GitHub API using a credential supplied as an **SST Secret** (never committed to source, never returned by any endpoint).
- **R-03** — WHERE a source repository defines contract files, the registry SHALL look for them under the repo's `contract/` directory matching the glob `*.odcs.yaml`.

### 3.2 Crawl / Refresh (write path)

- **R-10** — WHEN an authorised writer invokes `POST /refresh`, THE registry SHALL crawl **every** configured source repository's default branch via the GitHub API, discover all matching `contract/*.odcs.yaml` files, and ingest each one. Discovery SHALL use the **Git Trees API** (`GET /repos/{o}/{r}/git/trees/{branch}?recursive=1`) to enumerate the tree and the **Git Blobs API** to fetch each matching file's bytes (D-14). In the **same** crawl pass, THE registry SHALL also fetch and catalog each source's `docs/spec.md` EARS requirements (§3.10, R-101).
- **R-11** — For each discovered file, THE registry SHALL record its **source label**, repo, file path, the resolved **commit SHA** of the crawled branch tip, and the file's **blob SHA / content hash**.
- **R-12** — WHEN a crawl completes, THE registry SHALL persist a **crawl-run record** summarising: run id, start/end timestamps, which sources were crawled, and per-source counts of files discovered / valid / invalid / new-version / unchanged, and SHALL return this summary in the `POST /refresh` response. (The same record additionally carries per-source **requirement** counts — R-108.)
- **R-13** — IF a configured source repository is unreachable, returns a GitHub error, or fails authentication, THE registry SHALL record that source's outcome as **failed** in the crawl-run record, SHALL continue crawling the remaining sources, and SHALL leave the previously-cataloged entries for the failed source unchanged (no partial deletion).
- **R-14** — IF a source repository is reachable but contains **no** matching contract files, THE registry SHALL record zero discoveries for that source as a **success** (not an error).
- **R-15** — WHILE a crawl is already in progress, IF a second `POST /refresh` is received, THE registry SHALL NOT start a concurrent overlapping crawl; it SHALL respond `409 Conflict` with the in-flight run's id rather than corrupt the catalog. Single-flight SHALL be enforced by a **DynamoDB conditional-write lock item** acquired at crawl start and released at end, with a TTL fallback so a crashed crawl cannot deadlock future runs (D-15).
- **R-16** — IF `POST /refresh` is called with **no** credential (missing `Authorization` header), THE registry SHALL respond `401 Unauthorized`; IF it is called with a token that is invalid/expired **or** that lacks the **writer** group, THE registry SHALL respond `403 Forbidden`; in no case SHALL a crawl run. (Status model per D-21: `401` = no credential, `403` = credential rejected.)

### 3.3 Validation

- **R-20** — WHEN the registry ingests a discovered file, THE registry SHALL parse it as YAML and validate the parsed document against the **vendored ODCS v3.1.0 JSON schema** (`odcs-v3.1.0.schema.json`).
- **R-21** — IF a discovered file fails YAML parsing or ODCS schema validation, THE registry SHALL catalog the entry with `validation: invalid` and a structured list of the failing paths / rules, and SHALL NOT abort the crawl or discard other files (a bad contract is _recorded_, not dropped).
- **R-22** — WHEN a discovered file validates successfully, THE registry SHALL extract catalog metadata from it: `id`, `name`, `version`, `apiVersion`, `kind`, `status`, `domain`, `dataProduct`, `tags`, and the **entity name**. The entity name SHALL be `schema[0].name`; IF `schema[]` is empty or has no usable name, THE registry SHALL fall back to the file's name stem (`user.odcs.yaml` → `user`) (D-12).
- **R-23** — THE registry SHALL treat the ODCS v3.1.0 schema document itself and any non-`*.odcs.yaml` file as **not a contract** and SHALL NOT catalog it as one.

### 3.4 Catalog Model & Versioning

- **R-30** — THE registry SHALL catalog each contract under the composite identity **{source label, contract id}**. The same `id` discovered from two different sources (e.g. the identical `org` contract) SHALL be stored as **two distinct entries** — one per source — never merged (this is what "catalog both variants as-is" means).
- **R-30a** — IF two discovered files **within a single source** declare the same contract `id`, THE registry SHALL catalog the first and record an **id-collision warning** in the crawl-run record naming both file paths, rather than silently overwriting one with the other (D-13).
- **R-31** — WHEN a crawl ingests a contract whose {source, id} is new, THE registry SHALL create a catalog entry at version 1 of its history.
- **R-32** — WHEN a crawl ingests a contract whose {source, id} already exists AND whose content hash **matches** the current stored version, THE registry SHALL record the entry as **unchanged** (bump last-seen timestamp / commit SHA only; no new history version).
- **R-33** — WHEN a crawl ingests a contract whose {source, id} already exists AND whose content hash **differs** from the current stored version, THE registry SHALL append a **new history version**, preserving all prior versions and their metadata (an immutable, append-only history).
- **R-33a** — THE registry SHALL record each version's **declared `version` field** alongside its content hash; IF a new content-differing version carries the **same** declared `version` as the version it supersedes, THE registry SHALL flag that version with a **`versionNotBumped` warning** (D-16, E-10).
- **R-34** — THE registry SHALL, for a given entity name, be able to identify the set of source variants that carry it, and SHALL expose whether those variants' current contents are **identical or divergent** (by content hash — see R-53).

### 3.5 Storage

- **R-40** — THE registry SHALL persist catalog metadata (entries, versions, crawl-run records) in **DynamoDB**.
- **R-41** — THE registry SHALL persist the **raw ODCS document** for every cataloged version in **S3**, addressed by {source, id, version, content hash}, so that any historical version's exact bytes can be retrieved.
- **R-42** — Data at rest SHALL be encrypted (DynamoDB and S3 default/KMS encryption); the S3 bucket SHALL block public access.

### 3.6 Read API (contract-served, authenticated)

- **R-50** — WHEN an authorised reader calls `GET /contracts`, THE registry SHALL respond `200 OK` with the catalog: one row per {source, id} entry, each carrying source label, entity, id, name, current version, `validation` status, last-crawled timestamp. It SHALL support optional filters `?source=`, `?entity=`, and `?validation=`.
- **R-51** — WHEN a reader calls `GET /contracts/{source}/{id}`, THE registry SHALL respond `200 OK` with the entry's full metadata and its version history (each version: version number, content hash, commit SHA, crawled-at, validation result).
- **R-52** — WHEN a reader calls `GET /contracts/{source}/{id}/raw` (optionally `?version=`), THE registry SHALL respond `200 OK` with the **raw ODCS YAML** for the requested version (default: current), served with an appropriate content type.
- **R-53** — WHEN a reader calls `GET /entities/{entity}`, THE registry SHALL respond `200 OK` with every source variant of that entity, a boolean **`divergent`** flag (true IFF the variants' current content hashes differ), and, when there are exactly two variants, a **semantic per-property diff** over the parsed contracts — listing properties/fields/quality rules added in one variant, removed from the other, or changed (with old→new values), not merely a text diff (D-18).
- **R-54** — IF a read request targets a `source`, `id`, `entity`, or `version` that does not exist in the catalog, THE registry SHALL respond `404 Not Found`.
- **R-55** — WHEN a reader calls `GET /crawls` (or `GET /crawls/{runId}`), THE registry SHALL respond `200 OK` with crawl-run history / a single run summary (R-12).
- **R-56** — IF any read endpoint is called with **no** credential (missing `Authorization` header), THE registry SHALL respond `401 Unauthorized`; IF it is called with a token that is invalid/expired **or** that lacks a required group (`reader` or `writer`), THE registry SHALL respond `403 Forbidden`; in neither case SHALL it return catalog data. (All endpoints require auth — D-6; status model — D-21.)

### 3.7 Web Front-End (React SPA)

- **R-60** — WHEN an unauthenticated user opens the app, THE front-end SHALL present a **native Cognito SRP sign-in gate** (an in-app form, not a Hosted-UI redirect — D-16/D-17) and SHALL only reach the app after successful authentication (access token attached to every API call).
- **R-61** — WHILE authenticated, THE front-end SHALL list cataloged contracts **grouped by entity** (the **default** browse view), showing each source variant and flagging entities whose variants are **divergent** (R-34/R-53); THE user SHALL be able to switch between this and the by-source view (R-65).
- **R-62** — WHEN a user selects a contract, THE front-end SHALL display its metadata, its raw ODCS YAML, and its version history.
- **R-63** — WHEN a user selects a divergent entity, THE front-end SHALL display a side-by-side/inline **diff** of the publisher vs consumer variant (R-53).
- **R-64** — WHERE the authenticated user is in the **writer** group, THE front-end SHALL offer a **Refresh** action that invokes `POST /refresh` and surfaces the returned crawl-run summary; WHERE the user is reader-only, that action SHALL be hidden or disabled.
- **R-65** — WHILE authenticated, THE front-end SHALL offer a **by-source** browse view, **toggleable** with the by-entity view (R-61), that lists **each crawled source** and, beneath each, **every ODCS contract associated with that source** as a summary row (entity, declared version, validation status); WHEN a user selects a contract row, THE front-end SHALL open the same contract detail as R-62. (Derived client-side from `GET /contracts` (R-50); no new endpoint — D-22.)

### 3.8 Identity & Access (Cognito)

- **R-70** — THE Cognito user pool SHALL **disable self-service sign-up**; users are **admin-created** only (D-17).
- **R-71** — THE registry SHALL define two Cognito groups, **`reader`** (may call all `GET` endpoints) and **`writer`** (may additionally call `POST /refresh`), and SHALL derive endpoint authorisation from the caller's group membership (R-16, R-56).
- **R-72** — THE deployment SHALL seed two demo users — one `reader` and one `writer` — each assigned to its corresponding group, so the system is demonstrable immediately after deploy (D-17).

### 3.9 Test Generation (contract-driven end-to-end tests)

> This component turns the discovered catalog into runnable end-to-end tests. It **generates and stores** tests; it does **not** run them (D-29, §2). A generation run reads the current catalog and produces a **generation artifact set** = a declarative **manifest** (source of truth) plus emitted **Vitest `*.generated.test.ts`** files (D-28). Two test kinds are produced: **live API-conformance** (per contract) and **cross-app compatibility** (per shared entity) — D-23.

#### 3.9.1 Trigger, inputs, auth

- **R-80** — WHEN an authorised **writer** invokes `POST /generate-tests`, THE registry SHALL read the **current catalog** (the entries persisted by the most recent crawl), generate the artifact set for all applicable cataloged contracts, persist the artifact set as a **generation-run**, and respond `200 OK` with a generation-run summary (run id, timestamps, and counts: conformance generated / compat generated / skipped, with skip reasons).
- **R-80a** — IF `POST /generate-tests` is called with **no** credential, THE registry SHALL respond `401`; IF it is called with a token that is invalid/expired **or** lacks the **writer** group, THE registry SHALL respond `403`; in no case SHALL generation run (status model per D-21, mirrors R-16).
- **R-81** — THE generator SHALL operate **only** on contracts already in the catalog; it SHALL NOT itself crawl GitHub (D-8/D-5). IF the catalog is empty, THE generator SHALL produce an **empty** artifact set and record the run as **success** (not an error).
- **R-82** — THE generator SHALL generate tests from the **current** version of each cataloged contract, and SHALL record in the manifest the exact **content hash** (blob SHA, R-11) and declared **version** each test was generated from, so a later reader can tell whether a generated test is stale relative to the catalog.

#### 3.9.2 Live API-conformance tests

- **R-83** — For each **applicable** cataloged contract (see skip rule R-85), THE generator SHALL emit one **live API-conformance** test that, WHEN later run, SHALL fetch records for the contract's **entity** from the **owning source app's deployed HTTP API** and assert that **every** returned record validates against a runtime schema derived from that contract's `schema[]` (D-25). A single non-conforming record SHALL fail the test, naming the offending record and the failing property/rule.
- **R-83a** — A generated conformance test SHALL obtain the app's **API base URL** and a **Cognito access token** from named **environment variables** documented in the manifest (R-86). WHILE any required environment variable is unset, THE generated test SHALL be **skipped** (Vitest `skip`), NOT failed — so the committed generated tests never fail in an environment that lacks live credentials (D-26).
- **R-83b** — THE generator SHALL resolve, per source and entity, the **API path** that returns that entity's records and the **env-var names** for that source's base URL and token, from configuration co-located with the source configuration (R-01). IF no path/mapping is configured for a cataloged entity, THE generator SHALL **skip** conformance generation for it with a recorded reason (R-85), rather than emit an unrunnable test.

#### 3.9.3 Cross-app compatibility tests

- **R-84** — For each **entity present in ≥2 sources**, THE generator SHALL emit one **cross-app compatibility** test asserting **consumer-can-read-publisher** (D-24, directional, matching the CDC data flow): **every property the `consumer` variant's contract requires** SHALL be **present and type-compatible** in the `publisher` variant's contract. Extra properties in the publisher variant SHALL **not** fail the test; a **missing** required consumer property, or a **type-incompatible** one, SHALL fail it — naming the entity, the property path, and the reason.
- **R-84a** — THE compatibility assertion SHALL be computed over the **parsed ODCS `schema[]`** of each variant (reusing the registry's property model from the semantic differ, R-53/D-18); "required" SHALL be read from each property's ODCS `required` flag, and "type-compatible" SHALL mean equal logical types (with any documented widening rules noted in the manifest).

#### 3.9.4 Skip rules (fault isolation)

- **R-85** — THE generator SHALL be **fault-isolating** (mirrors D-9): IF a cataloged contract has `validation: invalid` (R-21), THE generator SHALL **skip** conformance generation for it with a recorded reason; IF an entity is present in only **one** source, THE generator SHALL **skip** compatibility generation for it with a recorded reason (e.g. the consumer-only `class-roster`); IF a contract's entity has no configured API mapping, THE generator SHALL **skip** its conformance test (R-83b). In every skip case THE generator SHALL record the skip (kind, target, reason) in the manifest and SHALL **continue** generating for all other contracts/entities.

#### 3.9.5 Outputs — manifest + emitted TypeScript

- **R-86** — THE generator SHALL emit a machine-readable **manifest** (JSON) as the artifact set's **source of truth**, enumerating for **every** generated test: its **kind** (`conformance` | `compat`), target **source**/**entity**/**contract id**, the **content hash** and declared **version** generated from (R-82), the **target coordinates** (env-var names + API path for conformance; the two source variants for compat), and the **assertion definition**; and, for every **skipped** item, the `{kind, target, reason}` (R-85).
- **R-87** — THE generator SHALL emit executable **Vitest** test files (`*.generated.test.ts`) **derived from the manifest**, matching the repo's existing test conventions (Vitest + TypeScript), so a future runner executes them with plain `vitest` and **no** bespoke interpreter (D-28). Each emitted file SHALL carry a header comment marking it **generated — do not edit** and naming the manifest entry it derives from.
- **R-88** — Generation SHALL be **deterministic and idempotent**: given the **same catalog content**, re-running generation SHALL produce **byte-identical** manifest and test files (stable ordering; no embedded timestamps, run ids, or random values in the committed artifacts). Run-level metadata (timestamps, run id) SHALL live **only** in the generation-run record (R-89), never in the committed files — so an unchanged catalog yields a **no-op git diff**.
- **R-92** — THE generated artifacts SHALL be written under a fixed, **git-tracked** directory with a stable layout: `generated-tests/manifest.json`; `generated-tests/conformance/<source>.<entity>.generated.test.ts`; `generated-tests/compat/<entity>.generated.test.ts`. Regeneration SHALL **replace the tree wholesale** (stale files for removed contracts/entities SHALL not linger).
- **R-93** — THE generated `generated-tests/**` files SHALL be **excluded** from the registry's own `test:offline` / `test:web` / `test:all` suites (they depend on live apps and are the future runner's concern, D-29); their presence or absence SHALL NOT affect the registry's unit test run.

#### 3.9.6 Persistence, retrieval, and delivery into the repo

- **R-89** — THE registry SHALL persist each generation run's **artifact set in S3** (manifest + emitted files, addressed by run id) and a **generation-run record in DynamoDB** (run id, started/ended timestamps, counts, per-item skip reasons, and the catalog commit context it was generated from).
- **R-90** — WHEN an authorised **reader** calls `GET /test-artifacts` (list of generation runs) or `GET /test-artifacts/{runId}` / `GET /test-artifacts/latest`, THE registry SHALL respond `200 OK` with the generation-run record and the means to retrieve that run's artifact set (manifest + files). IF the `runId` does not exist, THE registry SHALL respond `404` (mirrors R-54). Auth failures follow R-56/D-21.
- **R-91** — THE project SHALL provide a **CLI** (`npm run generate-tests`) that authenticates as a **writer**, triggers a generation run (`POST /generate-tests`) — or, WHERE requested, pulls the **latest** existing run (R-90) — downloads that run's artifact set, and **writes** the manifest + `*.generated.test.ts` files into the working tree at the R-92 location, so a human can review and commit them. The CLI SHALL **not** itself commit or push (D-29 — human reviews the diff).
- **R-91a** — THE CLI SHALL require the operator to supply **nothing but AWS credentials** in the common case, sourcing all configuration from the deployed stack via `sst bind` (D-35). `npm run generate-tests` SHALL run under `sst bind`, which injects the app/stage's **SSM Parameter Store** config; the CLI SHALL read the **API URL** from the **Api resource binding** (`sst/node/api` → `Api.Api.url`), the **client id** from `Config.Parameter USER_POOL_CLIENT_ID`, and the **writer credential** from the existing seeded-writer `Config.Secret` (`REGISTRY_DEMO_PASSWORD`), so no config file, `.env`, or interactive prompt is required. (Per D-36 the redundant `REGISTRY_API_URL` `Config.Parameter` was removed — the Api binding already exposes the URL.) Plain **environment variables SHALL override** any resolved value (`REGISTRY_TOKEN` to skip login entirely; `REGISTRY_USERNAME`/`REGISTRY_PASSWORD`; `AWS_REGION`). IF neither `sst bind` config nor an override supplies the API URL or a credential, THE CLI SHALL **exit with a directive error**, never hang. THE CLI SHALL NOT persist any secret to a tracked file; the credential lives only in SSM (encrypted) and is fetched at run time (NFR-2).

### 3.10 Requirements Catalog (EARS requirements crawled per source)

> Alongside ODCS contracts, the registry crawls each source repo's own **EARS requirements** (its `docs/spec.md`), extracts them, and catalogs/serves them. Requirements are cataloged **per source, latest-snapshot with a change flag** (no append-only history — D-45), **independently** (no cross-source requirement diff — D-47), in the **same `POST /refresh`** pass as contracts (D-44). This makes each app's stated obligations discoverable next to the contracts it publishes/consumes.

#### 3.10.1 Source & trigger

- **R-100** — Each configured source repo (R-01) SHALL additionally expose an **EARS requirements document** at `docs/spec.md` on its default branch; THE registry SHALL discover and fetch it via the same **Git Trees / Blobs** crawl used for contracts (D-14).
- **R-101** — WHEN an authorised writer invokes `POST /refresh` (R-10), THE registry SHALL, **in the same crawl pass**, fetch each source's `docs/spec.md`, extract its EARS requirements, and catalog them — alongside contract discovery (D-44). There SHALL be no separate requirements-only trigger.

#### 3.10.2 Extraction & EARS parsing

- **R-102** — For each source, THE registry SHALL extract every numbered requirement bullet (`- **R-nn** — <text>`) appearing under the document's **"Functional Requirements (EARS)"** section (`## 3. …`), capturing each requirement's **id** (`R-nn`, including sub-ids like `R-17a`), its full **text**, and the **sub-section heading** (e.g. `### 3.2 Crawl / Refresh`) it falls under.
- **R-103** — For each extracted requirement, THE registry SHALL derive its **EARS type** from the leading keyword — `WHEN`→`event`, `IF`→`unwanted`, `WHILE`→`state`, `WHERE`→`optional`, none-of-these→`ubiquitous` — and its **modality** (`SHALL` / `SHOULD` / `MAY`), taking the first modality keyword present.
- **R-104** — IF an extracted requirement carries **no** modality keyword (`SHALL`/`SHOULD`/`MAY`), THE registry SHALL catalog it flagged **`earsConforming: false`** (still cataloged, never dropped — fault-isolating, mirrors R-21/D-27); otherwise **`earsConforming: true`**.
- **R-105** — IF a source's `docs/spec.md` is **absent, or is present but contains no requirements section**, THE registry SHALL **replace that source's requirement snapshot with the empty set** — the source now declares zero requirements, so its prior requirements are **removed** (latest-snapshot semantics, D-45) — recording the crawl as a **success** with `discovered: 0` and the prior count as `removed`. IF the **source's crawl fails** — it is unreachable, or its branch/tree/contract-blob fetch errors (R-13) — THE registry SHALL instead leave that source's previously-cataloged requirements **unchanged** (no deletion — the state was not observed, mirrors R-13/NFR-4). (A failure fetching or parsing **only** `docs/spec.md`, after the source's contracts are already cataloged, is neither "absent" nor a whole-source failure — it is isolated per **R-105a**, which also leaves the prior snapshot unchanged.) The distinction is deliberate: _reachable-but-empty_ is an observed "zero requirements" (wipe); an _unobserved_ state — whole-source failure or an isolated spec-doc read/parse error — keeps the prior snapshot.
- **R-105a** — IF extracting or storing a source's requirements **fails after that source's contracts have been cataloged** (e.g. a malformed requirements document or a storage error — as opposed to a whole-source fetch failure, which is R-105/E-36), THE registry SHALL record that source's **requirements** outcome as **failed** (logged `crawl.requirements.failed`) and SHALL **continue**: the source's already-cataloged contracts, its crawl-run contract counts, and every other source SHALL be **unaffected** (fault isolation, NFR-4).

#### 3.10.3 Catalog model — latest snapshot + change flag

- **R-106** — THE registry SHALL catalog each requirement under the composite identity **{source label, requirement id}**, storing its `text`, `earsType`, `modality`, `section`, `earsConforming`, the source spec's **content hash** (the blob SHA of `docs/spec.md`), and — WHERE the document declares one — its **`Spec version`**.
- **R-107** — WHEN a crawl re-ingests a source's requirements, THE registry SHALL **replace that source's requirement set wholesale** (latest-snapshot; **no** append-only history, deliberately unlike contracts — D-45, D-10), flagging each requirement **`changedInLastCrawl: true`** IFF its text **differs** from the previously-stored text for the same {source, id} (a **newly-appeared** requirement counts as changed); requirements **absent** from the newly-crawled document SHALL be **dropped** from the catalog.
- **R-108** — THE registry SHALL extend the crawl-run record (R-12) with **per-source requirement counts**: discovered / conforming / non-conforming / changed / removed, and SHALL return them in the `POST /refresh` response.

#### 3.10.4 Read API (authenticated)

- **R-109** — WHEN an authorised **reader** calls `GET /requirements`, THE registry SHALL respond `200 OK` with one row per {source, id} entry (source, id, section, earsType, modality, earsConforming, changedInLastCrawl), ordered by **source then requirement id in natural (numeric) order** (so `R-2` precedes `R-10` precedes `R-100`), and SHALL support optional filters `?source=`, `?earsType=`, and `?conforming=`.
- **R-110** — WHEN a reader calls `GET /requirements/{source}`, THE registry SHALL respond `200 OK` with that source's full requirement set plus the source's declared **spec version**, spec **content hash**, and **last-crawled** timestamp.
- **R-111** — WHEN a reader calls `GET /requirements/{source}/{id}`, THE registry SHALL respond `200 OK` with that single requirement's full detail.
- **R-112** — IF a requirements read targets a `source`/`id` not in the catalog, THE registry SHALL respond `404 Not Found` (mirrors R-54); auth failures follow R-56/D-21 (reader or writer group).

#### 3.10.5 Web Front-End

- **R-113** — WHILE authenticated, THE front-end SHALL offer a **Requirements** browse view as a **third toggle** beside By entity / By source (R-61/R-65) that lists, per crawled source, its requirements **grouped by section** — showing each requirement's id, text, EARS type, and modality — and **visibly flags** requirements that are **non-conforming** (R-104) or **changed since the last crawl** (R-107); WHEN a user selects a requirement, THE front-end SHALL open a detail panel for it. (Reader auth per R-60; derived from `GET /requirements`, R-109.)

#### 3.10.6 Storage

- **R-114** — THE registry SHALL persist requirement entries in **DynamoDB** (single-table, a new item kind — D-39) and SHALL store each source's current `docs/spec.md` **raw bytes in S3**, addressed by **{source}**, for provenance and source-document retrieval (parallel to R-41, but **latest-snapshot only** — one object per source, replaced on content change; no hash in the key, unlike the per-version contract objects). Encryption/least-privilege per R-42/NFR-2.

### 3.11 LLM-Powered Cross-Service Functional Test Generation

> Beyond the deterministic contract-derived tests of §3.9, this component turns the cataloged **ODCS contracts** (§3.9) **and** the cataloged **EARS requirements** (§3.10) into **end-to-end functional tests** that exercise the promised **cross-service behaviour** (publisher → CDC → consumer). Because a functional scenario is described in each service's **natural-language EARS prose** (which the registry does not control — D-3), an **LLM** synthesises it; a deterministic layer renders it to code (D-50, D-51). It **generates and stores** tests only — running them stays future work (D-29/D-56). Determinism is preserved by caching the LLM's output and re-rendering it deterministically (D-52).

#### 3.11.1 Trigger, inputs, auth (asynchronous)

- **R-115** — WHEN an authorised **writer** invokes `POST /generate-functional-tests`, THE registry SHALL start an **asynchronous** generation job over the current catalog (contracts **and** requirements), respond **`202 Accepted`** with a **job id** and a status/retrieval URL, and SHALL NOT block on the LLM (D-53 — LLM latency exceeds the API Gateway synchronous limit, contrast NFR-8).
- **R-115a** — IF `POST /generate-functional-tests` is called with **no** credential, THE registry SHALL respond `401`; IF the token is invalid/expired **or** lacks the **writer** group, `403`; in no case SHALL a job start (status model per D-21, mirrors R-16/R-80a).
- **R-116** — THE job SHALL operate **only** on artifacts already in the catalog (contracts from R-10, requirements from R-101); it SHALL NOT crawl GitHub itself (D-5/D-8). IF the catalog has **no groundable requirement** (see R-121), the job SHALL complete as a **success** with an empty artifact set.

#### 3.11.2 Grounding & plan synthesis (the LLM step)

- **R-117** — For each **applicable** requirement (skip rule R-121), THE job SHALL synthesise a **structured functional-test plan** using an LLM, providing as grounded context: the requirement's **EARS text / type / modality** (R-102/R-103), the **ODCS `schema[]`** of the contract(s) for the entities it references, and the **per-source API map** (D-31). THE LLM SHALL be constrained to **structured output** validated against a fixed **test-plan JSON schema**, so every plan references only entities/endpoints present in the supplied context — a plan that names an unknown target is rejected, never emitted (mitigates hallucination).
- **R-117a** — A functional-test plan SHALL describe a cross-service scenario as: **preconditions/setup**, the **triggering action** (which source's API + a request payload shaped to that entity's contract), the **propagation step** (the CDC wait/poll between publisher and consumer), and the **assertions** (which state to verify in which service). Each plan SHALL record the **requirement id(s)** it derives from and the **input hash** it was synthesised from (R-119).
- **R-118** — THE LLM integration SHALL sit behind an **injectable interface** (mirrors the `GitHubApi` seam, D-37), so the plan-synthesis core is **unit-testable offline** with a stub — no live LLM or network call in the offline suite (NFR-9, analog of NFR-8). LLM access SHALL be provided by the worker's **IAM execution role** (Amazon Bedrock, SigV4) — **no API key is stored** — and no credential or sensitive material SHALL ever be logged or returned (NFR-2).

#### 3.11.3 Determinism via an input-hash cache

- **R-119** — Each plan SHALL be **cached** keyed by a content hash over `{requirement text, contract content hash(es), API-map entry, model id, prompt version}`. WHEN a job runs and a cached plan exists for a requirement's **current** input hash, THE job SHALL **reuse** the cached plan and SHALL NOT re-invoke the LLM; only inputs that **changed** trigger re-synthesis. The cached plan is the **committed source of truth** for that test (D-52) — this is what makes regeneration stable despite LLM non-determinism, so **R-88's byte-identical guarantee does not apply to the synthesis step** of this test class (§2).
- **R-119a** — THE emitted Vitest files SHALL be **rendered deterministically** from the cached plan set (reusing the §3.9 emit approach, D-28): the **same plan set yields byte-identical files** (stable ordering; no timestamps, run ids, or random values), so re-rendering an unchanged plan set is a **no-op git diff**. (Determinism is preserved for the render step; only plan _synthesis_ is non-deterministic and cached.)

#### 3.11.4 Skip rules (fault isolation)

- **R-120** — THE job SHALL be **fault-isolating** (mirrors D-9/R-85): IF the LLM returns a malformed or non-schema-valid plan for one requirement, THE job SHALL **skip** that requirement with a recorded reason and **continue**; one bad plan SHALL NOT abort the job or corrupt the artifact set.
- **R-121** — THE job SHALL **skip with a recorded reason** any requirement that cannot be grounded into a cross-service functional test: a **single-service** requirement with no cross-service counterpart, a requirement referencing **no cataloged entity**, a requirement whose entity has **no API mapping** (D-31), or an **infra-only** requirement (e.g. "data at rest SHALL be encrypted"). In every skip case THE job SHALL record `{requirement, reason}` in the manifest and continue for all other requirements.

#### 3.11.5 Outputs — plan manifest + emitted TypeScript

- **R-122** — THE job SHALL emit a machine-readable **functional-test manifest** (JSON, the artifact set's **source of truth**) enumerating, for **every** generated test: its kind (`functional`), the **requirement id(s)** it derives from, the source scenario (setup / trigger / propagation / assertions), the **input hash** synthesised from (R-119), and the **target coordinates** (the source APIs + entities involved); and, for every **skipped** requirement, `{requirement, reason}` (R-120/R-121).
- **R-123** — THE job SHALL emit executable **Vitest** test files (`*.generated.test.ts`) **derived from the manifest** (D-28), each carrying a **generated — do not edit** header naming its manifest entry and the requirement id(s) it derives from. THE artifacts SHALL be written under `generated-tests/functional/` with a stable layout; regeneration SHALL **replace that subtree wholesale** (R-92 analog). THE `generated-tests/functional/**` files SHALL be **excluded** from the registry's own `test:offline`/`test:web` suites (R-93 analog) — they depend on the live apps and are the future runner's concern.

#### 3.11.6 Job persistence, retrieval, and delivery

- **R-124** — THE registry SHALL persist each job's **artifact set in S3** (manifest + emitted files + the synthesised plans, addressed by job id) and a **job record in DynamoDB** (job id, status `pending`/`running`/`succeeded`/`failed`, started/ended timestamps, counts generated / skipped with reasons, and the catalog + model + prompt-version context it ran against).
- **R-125** — WHEN an authorised **reader** calls `GET /functional-test-jobs` (list), `GET /functional-test-jobs/{jobId}`, or `GET /functional-test-jobs/latest`, THE registry SHALL respond `200 OK` with the job record and the means to retrieve that job's artifact set; IF the `jobId` does not exist, `404`; auth failures follow R-56/D-21.
- **R-126** — THE `generate-tests` CLI SHALL gain a mode that **triggers** a functional-generation job, **polls** it to completion, **downloads** the artifact set, and **writes** `generated-tests/functional/**` (manifest + `*.generated.test.ts`) into the working tree for a human to review and commit (D-34, D-53). The CLI SHALL **not** itself commit or push.

---

## 4. Non-Functional Requirements

- **NFR-1 (Performance)** — Read endpoints SHOULD respond within **300 ms p95** (excluding cold starts), serving the pre-crawled catalog from DynamoDB/S3 rather than crawling live. A full crawl of both repos SHOULD complete within **30 s p95**.
- **NFR-2 (Security)** — All endpoints require Cognito auth (R-56); the GitHub credential lives only in an SST Secret (R-02) and is never logged or returned; IAM roles SHALL follow least privilege; data encrypted at rest (R-42) and in transit (TLS); no secrets in source.
- **NFR-3 (Scale)** — DynamoDB on-demand capacity. The design SHALL comfortably handle the two sources × four entities today and SHALL not require structural change to catalog **≥10 sources × ≥25 contracts each** with full version history, nor to catalog each source's **EARS requirement set** (§3.10, ~40–50 requirements per source at present).
- **NFR-4 (Reliability)** — A crawl SHALL be **fault-isolating**: one unreachable source, one malformed file, or one invalid contract SHALL NOT prevent the remaining sources/files from being cataloged (R-13, R-21). A crawl SHALL never leave the catalog in a partially-corrupt state.
- **NFR-5 (Observability)** — Every Lambda SHALL emit structured logs; each crawl SHALL log per-source and per-file outcomes with the offending path/id on any failure — including the requirements crawl (per-source requirement discovery / parse outcomes, §3.10); the GitHub credential SHALL never appear in logs.
- **NFR-6 (Portability/IaC)** — The entire stack SHALL be defined as code in **SST v2 (TypeScript)** and deployable to a real AWS account via a single deploy command.
- **NFR-7 (Language)** — All application and infrastructure code SHALL be **TypeScript**.
- **NFR-8 (Generation performance & determinism)** — A generation run over the catalog SHOULD complete **synchronously within the API Gateway timeout (<29 s)** for the v1 scale (2 sources × ~4 entities), like the crawl (R-10). Generation SHALL be **deterministic** (R-88): the same catalog input always yields byte-identical artifacts. The generator's core (catalog → artifact set) SHALL be a **pure, offline-testable** function with no AWS or network dependency, so it can be unit-tested without deploying. _(NFR-8 governs the §3.9 contract-derived generator; the §3.11 functional generator is async and LLM-backed — see NFR-9.)_
- **NFR-9 (Functional-test generation — LLM usage, cost, and the offline seam)** — Functional-test **plan synthesis** (§3.11) SHALL use a configured **Claude model on Amazon Bedrock** (via `@aws-sdk/client-bedrock-runtime` `InvokeModel`, structured output by forced tool use); access is the worker's **IAM execution role** (SigV4) — no stored key — and nothing sensitive appears in logs or responses (NFR-2). Because plan synthesis is **non-deterministic**, it SHALL be **cached** by input hash (R-119) rather than re-run, so an unchanged catalog re-uses cached plans and re-renders byte-identically (R-119a); overall cost is bounded by the cache (only changed inputs re-synthesise). Generation SHALL run **asynchronously** (R-115). The generator's core (catalog + cache → plans → emitted artifacts) SHALL keep a **pure, offline-testable seam** with the LLM behind an injectable interface (R-118), so the offline suite exercises it with a stub and **no network call**.

---

## 5. Edge Cases

| #     | Condition                                                                                                                | Expected behaviour                                                                                                                                                                                                                                              |
| ----- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E-1   | A source repo is unreachable / GitHub 5xx / auth fails                                                                   | That source marked `failed` in the run; other sources still crawled; existing entries for it untouched (R-13)                                                                                                                                                   |
| E-2   | A source repo has no `contract/*.odcs.yaml` files                                                                        | Recorded as success with 0 discoveries (R-14)                                                                                                                                                                                                                   |
| E-3   | A discovered file is not valid YAML                                                                                      | Entry cataloged `validation: invalid` with parse error; crawl continues (R-21)                                                                                                                                                                                  |
| E-4   | A discovered file is valid YAML but fails ODCS v3.1.0 schema                                                             | Entry cataloged `validation: invalid` with failing paths; crawl continues (R-21)                                                                                                                                                                                |
| E-5   | The identical `org` contract appears in both repos                                                                       | Two separate entries (`publisher/…org…`, `consumer/…org…`); `GET /entities/org` reports `divergent: false` (R-30, R-34)                                                                                                                                         |
| E-6   | `user`/`class`/`enrollment` differ between repos                                                                         | Two entries each; `GET /entities/{e}` reports `divergent: true` + diff (R-34, R-53)                                                                                                                                                                             |
| E-7   | Same {source, id} crawled again, content unchanged                                                                       | No new version; last-seen timestamp/SHA updated (R-32)                                                                                                                                                                                                          |
| E-8   | Same {source, id} crawled again, content changed                                                                         | New history version appended; prior versions retained (R-33)                                                                                                                                                                                                    |
| E-9   | Two files in one repo declare the **same** `id`                                                                          | First cataloged; id-collision warning naming both paths recorded in the crawl run (R-30a, D-13)                                                                                                                                                                 |
| E-10  | Content changed but the contract's `version` field did **not**                                                           | New history version recorded (history keys on content hash); version flagged `versionNotBumped` (R-33a, D-16)                                                                                                                                                   |
| E-11  | `POST /refresh` while a crawl is already running                                                                         | `409 Conflict` / returns in-flight run id; no concurrent crawl (R-15)                                                                                                                                                                                           |
| E-12a | Read/refresh with **no** `Authorization` header                                                                          | `401` — gateway short-circuits before the authorizer (R-16, R-56, D-21)                                                                                                                                                                                         |
| E-12b | Read/refresh with an expired/malformed token, or a valid token lacking the required group                                | `403` — authorizer denies (R-16, R-56, R-71, D-21)                                                                                                                                                                                                              |
| E-13  | `POST /refresh` by a reader-only user                                                                                    | `403`; no crawl (R-16)                                                                                                                                                                                                                                          |
| E-14  | `GET` for an unknown source/id/entity/version                                                                            | `404` (R-54)                                                                                                                                                                                                                                                    |
| E-15  | A contract's `schema[]` has zero or no usable name                                                                       | Entity falls back to the filename stem; entry still cataloged (R-22, D-12)                                                                                                                                                                                      |
| E-16  | GitHub API rate limit hit mid-crawl                                                                                      | Source marked `failed` with a rate-limit reason; other sources unaffected (R-13, D-15)                                                                                                                                                                          |
| E-17  | Reader-only user opens the SPA                                                                                           | Refresh action hidden/disabled; only GETs succeed; `POST /refresh` would be `403` (R-64, R-71)                                                                                                                                                                  |
| E-18  | A source has no successfully cataloged contracts (all failed / none discovered)                                          | The by-source view derives sources from the catalog, so that source shows no contract rows; its crawl outcome stays visible via `GET /crawls` (R-65, E-1/E-2)                                                                                                   |
| E-19  | `POST /generate-tests` when the catalog is empty (no prior crawl)                                                        | Empty artifact set produced; run recorded as **success** with zero counts (R-81)                                                                                                                                                                                |
| E-20  | A cataloged contract is `validation: invalid`                                                                            | Conformance generation **skipped** for it with a recorded reason; all other contracts still generated (R-85)                                                                                                                                                    |
| E-21  | An entity exists in only one source (e.g. consumer-only `class-roster`)                                                  | Compatibility generation **skipped** for it with a recorded reason; conformance still generated if applicable (R-85)                                                                                                                                            |
| E-22  | `POST /generate-tests` re-run against an **unchanged** catalog                                                           | Byte-identical manifest + files; writing them into the repo yields a **no-op git diff** (R-88)                                                                                                                                                                  |
| E-23  | A generated conformance test is later run with its API-URL / token env vars **unset**                                    | The test is **skipped** (Vitest `skip`), not failed (R-83a)                                                                                                                                                                                                     |
| E-24  | `POST /generate-tests` with no / invalid / non-writer credential                                                         | `401` (no credential) or `403` (rejected/insufficient); no generation runs (R-80a)                                                                                                                                                                              |
| E-25  | A property the **consumer** variant requires is **absent** (or type-incompatible) in the **publisher** variant           | The generated compatibility test, WHEN run, **fails**, naming entity + property path + reason (R-84) — this is the divergence the test exists to catch                                                                                                          |
| E-26  | The **publisher** variant has **extra** properties beyond the consumer's required set                                    | The compatibility test **passes** (extra publisher fields are allowed under consumer-can-read-publisher, R-84)                                                                                                                                                  |
| E-27  | A cataloged entity has **no configured API path/env mapping** for conformance                                            | Conformance generation **skipped** for it with a recorded reason; no unrunnable test emitted (R-83b, R-85)                                                                                                                                                      |
| E-28  | A contract present in a prior generation is **removed** from the catalog, then re-generated                              | Its stale `*.generated.test.ts` is **removed** (tree replaced wholesale, R-92); the manifest no longer lists it                                                                                                                                                 |
| E-29  | A source's `docs/spec.md` is **absent**, or is **present but has no requirements section** (source reachable)            | That source's requirement snapshot is **wiped to zero** (`discovered: 0`, `removed` = prior count), recorded as a **success** (R-105) — the observed state is "zero requirements". (A spec-doc that can't be fetched or parsed is instead R-105a — keep prior.) |
| E-36  | A source is **unreachable / its crawl fails** before its `docs/spec.md` is read                                          | The source's previously-cataloged requirements are **kept unchanged** (unobserved state, no deletion) and the source is marked `failed` (R-105, R-13, E-1)                                                                                                      |
| E-37  | Extracting / storing a source's requirements **fails after its contracts are cataloged** (malformed doc / storage error) | That source's **requirements** are marked **failed** (`crawl.requirements.failed`); its cataloged contracts and every other source are **unaffected**; the source's contract outcome stays `success` (R-105a, NFR-4)                                            |
| E-38  | A source's `docs/spec.md` declares the **same `R-nn` twice** under the requirements section                              | The **first** occurrence is cataloged, the duplicate dropped, and a `crawl.requirements.collision` is recorded naming the id(s) (mirrors the contract id-collision rule E-9/R-30a — D-49)                                                                       |
| E-30  | A requirement bullet has **no modality** keyword (`SHALL`/`SHOULD`/`MAY`)                                                | Cataloged with **`earsConforming: false`**, still listed and served (R-104)                                                                                                                                                                                     |
| E-31  | A source's `docs/spec.md` is re-crawled **unchanged**                                                                    | Requirement set replaced in place; **no** requirement flagged `changedInLastCrawl` (all `false`) — content hash matches (R-107)                                                                                                                                 |
| E-32  | A requirement is **removed** from `docs/spec.md` between crawls                                                          | It is **dropped** from the catalog (latest-snapshot, R-107); the removal is counted in the crawl-run summary (R-108)                                                                                                                                            |
| E-33  | A requirement's **text changes** between crawls (or a new one appears)                                                   | Flagged **`changedInLastCrawl: true`** (R-107)                                                                                                                                                                                                                  |
| E-34  | `GET /requirements/{source}/{id}` for an unknown source/id                                                               | `404 Not Found` (R-112)                                                                                                                                                                                                                                         |
| E-35  | Any `/requirements` read with **no** / invalid / insufficient credential                                                 | `401` (no credential) or `403` (rejected) — no requirement data returned (R-112, R-56, D-21)                                                                                                                                                                    |
| E-39  | A functional-gen job runs against a catalog with **no groundable requirement**                                           | Success with an **empty** artifact set; every requirement recorded as skipped with a reason (R-116, R-121)                                                                                                                                                      |
| E-40  | A requirement is **single-service / references no cataloged entity / has no API mapping / is infra-only**                | **Skipped** with a recorded reason; the job continues for the rest (R-121)                                                                                                                                                                                      |
| E-41  | The LLM returns a **malformed / non-schema-valid** plan for one requirement                                              | That requirement is **skipped** (isolated, reason recorded); the job does not abort and the artifact set is not corrupted (R-120)                                                                                                                               |
| E-42  | A functional-gen job re-runs against an **unchanged** catalog with the **same model + prompt version**                   | Every plan is a **cache hit** → **no** LLM calls; the emitted files are **byte-identical** → writing them yields a **no-op git diff** (R-119, R-119a)                                                                                                           |
| E-43  | A contract or requirement **changed** since the last job (input hash differs)                                            | Only the **affected** plans are re-synthesised (cache miss); unchanged plans are reused (R-119)                                                                                                                                                                 |
| E-44  | `POST /generate-functional-tests` with **no** / invalid / non-writer credential                                          | `401` (no credential) or `403` (rejected/insufficient); no job starts (R-115a)                                                                                                                                                                                  |
| E-45  | `GET /functional-test-jobs/{jobId}` for an unknown job id                                                                | `404 Not Found` (R-125)                                                                                                                                                                                                                                         |
| E-46  | Bedrock **access is denied** or the model is **not enabled** in-region when a job runs                                   | The job is marked `failed` with the (redacted) Bedrock error recorded on the job record; **no** partial artifacts are produced (R-118, R-124, NFR-9)                                                                                                            |
| E-47  | A functional-gen job **crashes or times out** mid-run                                                                    | The job record is marked `failed`; the **previously-committed** `generated-tests/functional/**` are left **untouched** (R-124, NFR-4 spirit)                                                                                                                    |

---

## 6. Open Questions

**Registry core (OQ-1…OQ-9): all resolved** on 2026-07-08 and folded into the Decisions Log (§7) as D-12 through D-20.

**Test Generator (OQ-10…OQ-14): RESOLVED** on 2026-07-09 at the Phase-1 gate — the user accepted all recommended defaults; folded into the Decisions Log as **D-30…D-34**. No blocking questions remain; Test-Generator Phase 2 (Plan) may begin.

**LLM Functional Test Generator (§3.11): RESOLVED** on 2026-07-16 via assumption-validation + clarifying questions before spec generation — the user validated that an LLM is needed (D-50), and chose: structured-plan synthesis rendered deterministically (D-51), input-hash cache + committed plan for determinism (D-52), an async job (D-53), cross-service scope with skip-with-reason (D-54), Claude on **Amazon Bedrock** via `@aws-sdk/client-bedrock-runtime` `InvokeModel` (forced tool use) with IAM-role auth and no stored key (D-55, revised from the Anthropic first-party SDK + SST Secret at the user's direction), generate-and-store only (D-56). Folded into the Decisions Log as **D-50…D-56**. **Implemented + deployed 2026-07-16** (T-33…T-39, tests-first); pipeline verified live end-to-end — producing plans is gated only on the account's Bedrock model access.

**Requirements Catalog (§3.10): RESOLVED** on 2026-07-15 via clarifying questions before spec generation — interpretation (new crawl-and-catalog feature), surface (API + SPA), scope (all EARS requirements per source), versioning (latest-snapshot + change flag), trigger (extend `POST /refresh`), extraction depth (EARS type + modality + non-conforming flag), raw-spec provenance (store in S3), SPA placement (third toggle). Folded into the Decisions Log as **D-44…D-48**. No blocking questions remain.

- **OQ-10 — Runtime schema source for conformance assertions.** A conformance test must validate live records against _something_. The registry deliberately does **not** compile ODCS → JSON Schema (D-11/D-20). Options: **(a, recommended)** the generator derives a JSON Schema from the contract's parsed `schema[]` and **embeds it in the manifest**, and the emitted test validates records with Ajv against that embedded schema (self-contained, no dependency on the apps' build); (b) the emitted test fetches each app's own compiled `*.schema.json` at run time (couples tests to app internals); (c) assert field-by-field from `schema[]` without a JSON Schema (reimplements validation). _Recommend (a)._
- **OQ-11 — Entity → API-path resolution for conformance.** How does the generator know which HTTP path returns an entity's records (e.g. `user` → `GET /users`)? Options: **(a, recommended)** a small **configured per-source map** (`entity → { path, baseUrlEnv, tokenEnv }`) co-located with `sources.ts`, since the two apps' routes are known and fixed; (b) derive from the ODCS `servers`/`apiVersion` block if present (brittle — the contracts may not carry runtime server info). _Recommend (a); entities with no mapping are skipped (R-83b)._
- **OQ-12 — Artifact retrieval/delivery mechanism for the CLI.** How does the CLI get the artifact bytes the endpoint produced? Options: **(a, recommended)** `GET /test-artifacts/{runId|latest}` returns the manifest + files **inline in the JSON response** (artifact set is small — a few KB); (b) return **S3 pre-signed download URLs**; (c) CLI re-generates locally from `GET /contracts` instead of downloading (diverges endpoint vs CLI output — rejected). _Recommend (a) for v1; escalate to (b) only if artifacts grow large._
- **OQ-13 — CLI offline/local generation mode.** Besides pulling endpoint artifacts (R-91), should the CLI also generate **locally** (calling the pure core against `GET /contracts`, no deployed generate endpoint)? Options: **(a, recommended)** ship a `--local` mode that runs the same pure core against the read API, for dev use, while the default pulls the endpoint run; (b) endpoint-pull only. _Recommend (a) — the core is pure (NFR-8), so local mode is nearly free and aids development._
- **OQ-14 — Commit behaviour.** Should the CLI stage/commit the generated tree, or only write it? Options: **(a, recommended)** write files only; the human reviews `git diff` and commits (D-29); (b) auto-commit on a branch. _Recommend (a)._

_(Original registry-core questions retained for provenance:)_

- **OQ-1 — Entity-name resolution.** → **D-12**
- **OQ-2 — What is a "version"?** → **D-16**
- **OQ-3 — Duplicate `id` within one source.** → **D-13**
- **OQ-4 — GitHub access mechanism.** → **D-14**
- **OQ-5 — Cognito user/group provisioning.** → **D-17**
- **OQ-6 — Scheduled crawl.** → **D-19**
- **OQ-7 — Crawl concurrency & rate limits.** → **D-15**
- **OQ-8 — Diff granularity.** → **D-18**
- **OQ-9 — Attaching the app-compiled `*.schema.json`.** → **D-20**

---

## 7. Decisions Log

_(Each entry: **Decision / Reason / Affects**. D-1…D-11 below were fixed during Phase 1 clarification on 2026-07-07; OQ resolutions will be appended as D-12+.)_

**D-1 — The registry is a deployed AWS service (SST v2).**

- **Decision:** Build the registry as a real SST v2 application on AWS (DynamoDB + S3 + API Gateway HTTP API + Lambda + Cognito + a React SPA), mirroring the two example apps' stack.
- **Reason:** Highest-fidelity demonstration and consistent with the sibling apps; the user selected this over a static catalog or a library/CLI.
- **Affects:** entire design, NFR-6.

**D-2 — Catalog both variants as-is; do not reconcile.**

- **Decision:** Store the publisher's and consumer's copy of each contract as distinct entries; never merge or produce a canonical version.
- **Reason:** The registry's value here is making the _existing divergence_ visible; reconciliation is a separate concern.
- **Affects:** §1, §2, R-30, R-34, R-53.

**D-3 — The two source apps are not modified.**

- **Decision:** The registry only reads the repos; it does not change them or wire them to consume from it.
- **Reason:** Keeps blast radius to the new project; app integration is future work.
- **Affects:** §2.

**D-4 — Population is by crawl only; no client upload API.**

- **Decision:** Contracts enter the registry exclusively by crawling the configured repos on demand; there is no `POST /contracts` upload.
- **Reason:** The user specified "crawl the repos on-demand" as the population model.
- **Affects:** §2, R-10, R-40.

**D-5 — Source repos are fixed configuration, not runtime input.**

- **Decision:** The crawl targets a fixed, configured list (the two example apps); callers cannot point the crawler at arbitrary repos.
- **Reason:** Security and scope; a demo registry over two known repos.
- **Affects:** §2, R-01.

**D-6 — Authenticated reads _and_ writes (Cognito).**

- **Decision:** Every endpoint requires a valid Cognito token; the `reader` group may GET, the `writer` group may additionally `POST /refresh`.
- **Reason:** The user chose authed-reads-and-writes, mirroring the two apps' posture.
- **Affects:** R-16, R-56, R-60, R-64, NFR-2.

**D-7 — Trigger-then-cache freshness model.**

- **Decision:** Reads serve a **pre-crawled, cached** catalog from DynamoDB/S3; a crawl is triggered explicitly via `POST /refresh`. Reads never crawl live.
- **Reason:** The user chose trigger-then-cache over crawl-per-request; keeps reads fast and avoids per-read GitHub rate-limit exposure.
- **Affects:** R-10, R-40, R-41, R-50, NFR-1.

**D-8 — Crawl source is the GitHub API on the default branch.**

- **Decision:** The crawler fetches contracts from each repo's **default branch (main)** via the GitHub API using a token in an SST Secret; a deployed Lambda cannot read local checkouts.
- **Reason:** The user selected GitHub-API remote crawling for the deployed service.
- **Affects:** R-01, R-02, R-10, R-11, OQ-4.

**D-9 — Fault-isolating crawl.**

- **Decision:** A crawl records per-source and per-file outcomes; one failure never aborts the rest and never partially corrupts the catalog.
- **Reason:** Reliability; a registry that drops everything because one file is bad is worse than useless.
- **Affects:** R-13, R-14, R-21, NFR-4, E-1…E-4.

**D-10 — Append-only version history keyed on content hash.**

- **Decision:** Each {source, id} entry keeps an immutable, append-only version history; a new version is recorded whenever crawled content differs by hash.
- **Reason:** Preserves the full divergence timeline; content hash is an unambiguous change signal independent of the declared `version` field.
- **Affects:** R-31, R-32, R-33, E-7, E-8, E-10, OQ-2.

**D-11 — Store ODCS source; app-compiled schema is at most an attached artifact.**

- **Decision:** The registry catalogs the ODCS `*.odcs.yaml` **source**; it does not run the compiler. Whether to also attach each app's compiled `*.schema.json` is deferred to OQ-9 (default: ignore for v1).
- **Reason:** The compiler lives in each app; the registry's product is the contract source and its validation status.
- **Affects:** §2, R-41, OQ-9.

---

_(D-12…D-20 resolve the open questions, decided 2026-07-08.)_

**D-12 — Entity name = `schema[0].name`, fallback filename stem.** (resolves OQ-1)

- **Decision:** An entry's entity is the `name` of the first object in `schema[]`; if that is missing/empty, fall back to the file's name stem (`enrollment.odcs.yaml` → `enrollment`).
- **Reason:** Content-driven and robust; the filename fallback keeps every file catalogable even if its schema is malformed.
- **Affects:** R-22, E-15, R-34, R-53.

**D-13 — Catalog key is {source, id}; duplicate ids within a source are flagged, not overwritten.** (resolves OQ-3)

- **Decision:** Entries key on {source label, contract `id`}. If one source has two files sharing an `id`, the first is cataloged and an id-collision warning (naming both paths) is recorded in the crawl run.
- **Reason:** Contract `id` is the authoritative identity; silent overwrite would hide a real authoring bug.
- **Affects:** R-30, R-30a, E-9.

**D-14 — GitHub access via a fine-grained PAT + Git Trees/Blobs API.** (resolves OQ-4)

- **Decision:** Authenticate with a read-only fine-grained Personal Access Token (Contents:read, scoped to the two repos) stored as SST Secret `GITHUB_TOKEN`. Crawl by listing the recursive Git Tree of the default branch and fetching each matching blob.
- **Reason:** Simplest credential for a personal/demo project; the Trees+Blobs API gives exact per-file blob SHAs (feeds the content-hash version model, D-10) without downloading whole tarballs.
- **Affects:** R-02, R-10, R-11.

**D-15 — Single-flight via a DynamoDB conditional lock item; rate-limits fail the source.** (resolves OQ-7)

- **Decision:** Acquire a lock item with a conditional write (`attribute_not_exists`) at crawl start, release at end, with a TTL fallback. A second `POST /refresh` that fails the condition returns `409` with the in-flight run id. GitHub rate-limit responses mark that source `failed` per the fault-isolation rule (D-9).
- **Reason:** Lightweight correctness for the write path with no extra services (no Step Functions / reserved-concurrency coupling).
- **Affects:** R-15, E-11, E-16.

**D-16 — Surface the declared `version` field and warn on content-change-without-bump.** (resolves OQ-2)

- **Decision:** Each stored version records both its content hash and the contract's declared `version` field; a content-differing version that reuses the prior declared `version` is flagged `versionNotBumped`.
- **Reason:** Content hash is the source of truth for change (D-10), but surfacing the declared version and flagging non-bumps is a useful contract-hygiene signal.
- **Affects:** R-33a, E-10, R-62 (UI shows it).

**D-17 — Admin-created Cognito users, no self-signup; seed a reader and a writer.** (resolves OQ-5)

- **Decision:** Disable self-service sign-up; seed one `reader` and one `writer` demo user, each in its group, at deploy.
- **Reason:** A locked-down registry demonstrable immediately after deploy; mirrors the consuming app's native-user posture.
- **Affects:** R-70, R-71, R-72, D-6.

**D-18 — Semantic per-property diff for divergent entities.** (resolves OQ-8)

- **Decision:** `GET /entities/{entity}` returns a structured diff over the parsed contracts (properties/fields/quality rules added / removed / changed with old→new), not a raw text diff.
- **Reason:** Surfacing _contract_ drift (the whole point of the registry) is far more useful than a formatting-noisy line diff.
- **Affects:** R-53, R-63.

**D-19 — Manual-only crawl for v1 (no scheduled cron).** (resolves OQ-6)

- **Decision:** Crawls happen only via authenticated `POST /refresh`; no EventBridge schedule in v1.
- **Reason:** Keeps the write path simple and intentional; scheduling is an easy additive follow-up.
- **Affects:** §2, R-10.

**D-20 — Catalog ODCS source only; ignore compiled `*.schema.json`.** (resolves OQ-9)

- **Decision:** The crawler ingests `*.odcs.yaml` source only; it does not pick up the apps' compiled `*.schema.json`.
- **Reason:** The registry's product is the contract source and its validation status (D-11); the compiled artifact adds noise without new information for v1.
- **Affects:** §2, R-23, R-41.

---

_(D-21 added during Phase 2 design review, 2026-07-08.)_

**D-21 — Group authorization via a Lambda REQUEST authorizer on the HTTP API; `401` = no credential, `403` = credential rejected.** (design decision)

- **Decision:** Enforce authentication **and** `reader`/`writer` group authorization at the edge with a single Lambda REQUEST authorizer (`aws-jwt-verify` for Cognito access-token verification; per-route rule keyed on `routeKey` + the `cognito:groups` claim; authorizer result caching disabled). Status model: a missing `Authorization` header returns `401` (API Gateway short-circuits before the authorizer); a present-but-rejected token — invalid, expired, or lacking the required group — returns `403`.
- **Reason:** No built-in authorizer (neither the HTTP API `user_pool` JWT authorizer nor the REST API Cognito authorizer) can gate on Cognito **groups**; a Lambda authorizer is the way to enforce groups at the gateway on either API type, so it is _not_ a reason to switch to REST API. HTTP API is retained for consistency with both sibling apps and for lower cost/latency. The `401/403` split shifts the previous "expired/malformed token → `401`" (R-16/R-56/E-12) to `403`, adopting the standard "401 = who are you / 403 = you may not" model. _(Alternative — a REST API Lambda authorizer can emit `401` via `throw "Unauthorized"` and `403` via a Deny policy, preserving strict 401-for-invalid-token; rejected in favour of HTTP API consistency.)_
- **Affects:** R-16, R-56, R-71, E-12a, E-12b; design §1, §3, §4, §6, §7.1.

---

_(D-22 added during Maintenance change request, 2026-07-09 — recipe Prompt 13, requirements-first.)_

**D-22 — By-source browse view is a toggle against the by-entity view, reusing the shared contract detail.** (change request)

- **Original question:** How should the requested per-source view relate to the existing entity-grouped browse view, and how much of each contract should it show?
- **Decision:** Add a **by-source** view selectable via a top-level **toggle** (By entity / By source). The by-entity view remains the **default** and keeps the divergence diff (R-63). The by-source view lists each crawled source with its contracts as **summary rows** (entity, declared version, validation status); selecting a row opens the **same** detail panel as R-62 (metadata, version history, raw YAML). No new backend endpoint — the view is derived client-side from `GET /contracts` (R-50).
- **Reason:** A toggle keeps both organizations first-class without crowding one screen; summary-rows-plus-shared-detail reuses R-62 and the existing `listContracts` data, so the change is purely additive front-end with zero API/data-model impact.
- **Affects:** R-61 (now default/toggleable), R-65 (new), R-62 (detail reused), E-18.

---

_(D-23…D-29 added for the Test Generator component, 2026-07-09 — recipe Phase 1, resolved with the user via clarifying questions before spec generation.)_

**D-23 — Generate both live-conformance and cross-app-compatibility tests.**

- **Decision:** Each generation run produces, per applicable contract, a **live API-conformance** test, and per shared entity, a **cross-app compatibility** test.
- **Reason:** The user chose "both": conformance proves each app's live data honours its own contract; compatibility proves the divergence the registry catalogs does not actually break the publisher→consumer flow.
- **Affects:** R-82, R-83, R-84, §3.9.

**D-24 — Compatibility criterion = consumer-can-read-publisher (directional).**

- **Decision:** A shared entity passes iff every property the **consumer** variant requires is present and type-compatible in the **publisher** variant; extra publisher properties are allowed.
- **Reason:** Matches the real CDC data flow (publisher emits → consumer reads); a plain exact-match or reused semantic-diff would flag harmless additive/cosmetic drift as failure.
- **Affects:** R-84, R-84a, E-25, E-26.

**D-25 — Live conformance targets the deployed HTTP API with a Cognito token.**

- **Decision:** Emitted conformance tests call each app's **deployed API Gateway** per-entity endpoint, authenticating with a **test user's Cognito access token** supplied via environment variables at run time.
- **Reason:** The user chose a true end-to-end check of the running service over reading DynamoDB directly; env-supplied token keeps credentials out of the committed tests.
- **Affects:** R-83, R-83a, R-83b, OQ-11.

**D-26 — Missing live credentials → skip, not fail.**

- **Decision:** A generated conformance test whose required env vars are unset is **skipped** (Vitest `skip`), never failed.
- **Reason:** The committed generated tests must be safe to have in the tree without live credentials present; a hard failure would break any unrelated run. (Also reinforced by R-93 excluding them from the registry's own suites.)
- **Affects:** R-83a, E-23.

**D-27 — Invalid or unmatched contracts are skipped with a recorded reason.**

- **Decision:** Invalid contracts (skip conformance) and single-source entities (skip compat) and unmapped entities (skip conformance) are **skipped with a reason recorded in the manifest**, and generation continues for everything else.
- **Reason:** The user chose skip-with-reason over emitting negative tests or hard-failing; fault isolation mirrors the crawl (D-9) and keeps a partial catalog useful.
- **Affects:** R-85, E-20, E-21, E-27.

**D-28 — Output is both a declarative manifest (source of truth) and emitted Vitest TS.**

- **Decision:** Each run emits a JSON **manifest** enumerating every test/skip, **and** executable **Vitest `*.generated.test.ts`** derived from it.
- **Reason:** The user chose "both": the manifest is language-agnostic and diff-friendly and drives the future runner; the emitted Vitest files run today with no bespoke interpreter, matching the repo's stack.
- **Affects:** R-86, R-87, R-88, R-92.

**D-29 — Produced by both a writer-authed endpoint and a CLI; running is out of scope.**

- **Decision:** A deployed writer-authed `POST /generate-tests` produces and stores the artifact set (S3 + DynamoDB run record, retrievable via `GET /test-artifacts`); a **CLI** authenticates as writer, pulls a run's artifacts, and writes them into the repo working tree for the human to review and commit. **Executing** the generated tests on demand is a separate future feature.
- **Reason:** The user chose "both" for the trigger and "generation + storage only" for scope; the deployed endpoint keeps generation reproducible server-side against the live catalog, while the CLI is how tests land "in this repo".
- **Affects:** R-80, R-89, R-90, R-91, R-93, §2, OQ-12, OQ-14.

---

_(D-30…D-34 resolve the Test-Generator open questions OQ-10…OQ-14, decided 2026-07-09 at the Phase-1 gate; user accepted all recommended defaults.)_

**D-30 — Conformance runtime schema = JSON Schema derived from `schema[]`, embedded in the manifest.** (resolves OQ-10)

- **Decision:** The generator derives a JSON Schema from each contract's parsed ODCS `schema[]` and embeds it in the manifest; the emitted conformance test validates each live record with **Ajv** against that embedded schema.
- **Reason:** Self-contained — the generated test depends on neither the apps' build output nor a re-fetch; keeps the registry's "validate, never assume" principle and reuses the vendored Ajv stack.
- **Affects:** R-83, R-86, R-87.

**D-31 — Entity → API path via a configured per-source map co-located with `sources.ts`.** (resolves OQ-11)

- **Decision:** A small static map `{ source → { entity → { path, baseUrlEnv, tokenEnv } } }` lives beside the source configuration; unmapped entities are skipped for conformance (R-83b).
- **Reason:** The two apps' routes are fixed and known; deriving paths from ODCS `servers` is brittle and the contracts may not carry runtime server info.
- **Affects:** R-83b, R-85, E-27.

**D-32 — `GET /test-artifacts` returns the manifest + files inline in the JSON response.** (resolves OQ-12)

- **Decision:** The retrieval endpoint returns the artifact set inline (a few KB) rather than S3 pre-signed URLs; escalate to pre-signed download only if artifacts grow large.
- **Reason:** Simplest delivery for the CLI at v1 scale; no extra S3-URL signing/round-trip.
- **Affects:** R-90, R-91.

**D-33 — CLI ships a `--local` generation mode in addition to endpoint-pull.** (resolves OQ-13)

- **Decision:** The default CLI mode triggers/pulls the deployed run (R-91); a `--local` mode runs the same **pure core** against `GET /contracts` for offline/dev use, producing identical output.
- **Reason:** The core is a pure offline function (NFR-8), so local mode is nearly free and speeds development; both modes share one code path so output cannot diverge.
- **Affects:** R-91, NFR-8.

**D-34 — CLI writes files only; the human reviews `git diff` and commits.** (resolves OQ-14)

- **Decision:** The CLI writes the `generated-tests/` tree into the working directory and stops; it does not stage, commit, or push.
- **Reason:** Generated tests are code review-worthy; a human gate before commit matches D-29 and the recipe's spec-anchored discipline.
- **Affects:** R-91, §2.

**D-35 — `generate-tests` CLI sources all config from the deployed stack via `sst bind` (SSM); no config file, no prompt.** (decided 2026-07-15; supersedes the interim env/`.env`/prompt design)

- **Decision:** `npm run generate-tests` runs as `sst bind tsx scripts/generate-tests.ts`. `sst bind` injects the stage's SSM-backed bindings; the CLI reads the API URL from the **Api resource binding** (`sst/node/api` → `Api.Api.url`), the client id from `Config.Parameter USER_POOL_CLIENT_ID` (AuthStack), and the writer password from the existing `Config.Secret REGISTRY_DEMO_PASSWORD` (the same secret the seed uses to set writer@demo's password), then authenticates as `writer@demo` via `USER_PASSWORD_AUTH`. Environment variables override any value (`REGISTRY_TOKEN`, `REGISTRY_USERNAME`/`REGISTRY_PASSWORD`, `AWS_REGION`). Missing API URL or credential → directive error, never a hang.
- **Reason:** The end user always has AWS credentials, so `sst bind` + Parameter Store is strictly better than a committed `generate-tests.config.json` (which nobody wants to maintain and which duplicates deploy outputs) or an interactive prompt: SSM is the single source of truth, the writer secret already exists there, and there is nothing to keep in sync. SSM SecureString (via SST `Config.Secret`) is the right store here — Secrets Manager's rotation/cross-account features aren't needed for a demo credential and it would leave the SST idiom.
- **Affects:** R-91, R-91a, NFR-2 (secret only in encrypted SSM, never in source), AuthStack (`Config.Parameter`s), package.json (`generate-tests` wrapped in `sst bind`).

**D-36 — resource + config values are read through `sst/node` bindings, not hand-threaded env vars.** (decided 2026-07-15, aligning with SST v2 guidance)

- **Decision:** Function handlers read their dependencies through SST resource bindings via `sst/node`: `repository.ts` reads the table/bucket names from `sst/node/table` (`Table.Registry.tableName`) and `sst/node/bucket` (`Bucket.Contracts.bucketName`); the authorizer and seed read the Cognito pool id + client id from `Config.Parameter`s (`USER_POOL_ID`, `USER_POOL_CLIENT_ID`) via `sst/node/config`. The corresponding `environment: {}` entries and the redundant `REGISTRY_API_URL` `Config.Parameter` (the Api binding already exposes the URL) are removed. The `test:offline` suite stubs the `SST_{Construct}_{prop}_{id}` binding env vars (`vitest.setup.ts`) so it still runs without AWS; `npm test` (`sst bind vitest run`) exercises the real bound values.
- **Reason:** SST v2 recommends accessing bound resources through `sst/node` (which also grants the IAM permissions) rather than manually copying values into `environment`. Cognito has no native `sst/node` binding, so a `Config.Parameter` is the idiomatic bridge for those construct values. Reading through bindings makes SSM/the stack the single source of truth and keeps handlers consistent with how secrets are already consumed.
- **Affects:** repository.ts, authorizer.ts, seed.ts, ApiStack, AuthStack, vitest.config.ts + vitest.setup.ts, NFR-6/NFR-7 (idiomatic IaC).

---

_(D-37…D-42 added 2026-07-15 during the periodic health check — recipe Step 11. D-37…D-41 promote decisions that were live in the implementation/design but never recorded here; D-42 records a scope correction. No requirement was changed.)_

**D-37 — GitHub crawl uses `@octokit/rest` behind the `GitHubApi` interface.** (promoted; captured in design §7.5)

- **Decision:** The crawler fetches the recursive Git Tree + blobs via `@octokit/rest`, hidden behind the `GitHubApi` interface, rather than a hand-rolled `fetch` wrapper.
- **Reason:** Octokit provides typed auth, pagination, and error handling that directly serve the fault-isolation model (R-13); the interface keeps a `fetch` implementation drop-in if dependency minimalism is later preferred.
- **Affects:** R-02, R-10, R-11, R-13; `packages/core/src/github.ts`.

**D-38 — The GitHub blob SHA is reused directly as the content hash.** (promoted; captured in design §7.3)

- **Decision:** Each file's git blob SHA (SHA-1) _is_ the content hash that drives the append-only version model (D-10) and the cross-repo divergence check (R-34); no separate digest is computed.
- **Reason:** The blob SHA is already content-addressed and stable, so it doubles as change signal and identity with zero extra hashing. SHA-1 is acceptable here because it is a change-detection/identity key, not a security boundary.
- **Affects:** R-11, R-32, R-33, R-34, E-5; D-10, D-14.

**D-39 — Storage is one DynamoDB table with `byEntity` and `byKind` GSIs.** (promoted; captured in design §2.1)

- **Decision:** Entries, immutable versions, crawl runs, generation runs, and the single-flight lock share one table using typed PK/SK prefixes (`SRC#`/`CON#`, `VER#`/`V#000n`, `RUN#`, `GEN#`, `LOCK`/`CRAWL`); GSI `byEntity` backs `GET /entities/{entity}` (R-34/R-53) and GSI `byKind` backs newest-first crawl- and generation-run listings (R-55, R-90).
- **Reason:** On-demand single-table + two GSIs scales to the spec's volume (NFR-3) with no capacity planning; disjoint key prefixes keep heterogeneous item kinds in one table, and `kind="CRAWL"` vs `"GENERATION"` keep the two run listings disjoint.
- **Affects:** R-40, R-42, R-53, R-55, R-89, R-90, NFR-3; `packages/functions/src/repository.ts`.

**D-40 — The derived conformance JSON Schema is presence + type only (`additionalProperties: true`).** (promoted; captured in `derive-schema.ts`)

- **Decision:** The JSON Schema derived from a contract's `schema[]` (D-30) asserts required fields are present and well-typed but sets `additionalProperties: true`, so a live record carrying extra fields is still conformant.
- **Reason:** Consistent with the "extra allowed" stance of consumer-can-read-publisher (D-24); conformance checks that the contract's fields are honoured, not that the record is byte-exact to the contract.
- **Affects:** R-83, R-86, R-87; D-24, D-30.

**D-41 — The `generate-tests` CLI has a third `--pull` mode.** (promoted; captured in the CLI header)

- **Decision:** Besides the default (generate + pull latest) and `--local` (offline pure core) modes (D-33), the CLI supports `--pull`: authenticate and download the latest existing generation-run artifacts _without_ triggering a new `POST /generate-tests`.
- **Reason:** Lets an operator land the most recent server-generated tests without re-running generation (e.g. after another writer already generated).
- **Affects:** R-91; D-29, D-33, D-35.

**D-42 — An out-of-scope conformance _runner_ was added, then removed to honour §2/D-29.** (scope correction)

- **Original situation:** A `vitest.conformance.config.ts` + `npm run test:conformance` runner that _executes_ the generated conformance tests against the live apps was introduced, contradicting §2 and D-29 (which place _running_ the generated tests — on demand, on a schedule, or in CI — out of scope).
- **Decision:** Remove the runner. The generator continues to **generate and store** tests only; executing them remains a separate future feature. The generated `generated-tests/**` files stay committed for review and excluded from the registry's suites (R-93), and remain runnable later by that future feature.
- **Reason:** Keep the oracle and the code aligned; re-scoping "running the tests" in is a deliberate decision to make explicitly if/when the future runner is built, not a side effect of a convenience script.
- **Affects:** §2, R-93; D-29 (re-affirmed); removes `vitest.conformance.config.ts` + the `test:conformance` script.

---

_(D-43 added 2026-07-15 during the second health-check pass — recipe Step 11. Documents the structured-logging contract introduced by the NFR-5 remediation, plus the credential-redaction boundary added in the same pass.)_

**D-43 — Structured logging is a shared `log` helper: JSON-line, no embedded timestamp, non-scrubbing by default, with a fixed event taxonomy and a single redaction boundary.** (design decision)

- **Decision:** All Lambdas log through `packages/functions/src/log.ts` — `log.info|warn|error(event, fields)` emitting one `JSON.stringify({ level, event, ...fields })` line per call (NFR-5). Deliberate choices: **(a)** no timestamp is embedded (CloudWatch stamps each line); **(b)** the logger does **not** scrub — callers are contractually responsible for keeping secrets out of `fields` (NFR-2), which is why handlers log usernames/groups but never tokens or passwords; **(c)** a fixed event-name taxonomy (`crawl.start`, `crawl.source.done`, `crawl.file.invalid`, `crawl.id.collision`, `crawl.source.failed`, `crawl.requirements.done`, `crawl.requirements.failed`, `crawl.requirements.collision`, `crawl.done`, `authz.decision`, `authz.denied`, `seed.user`, `generate.start`, `generate.done`); **(d)** the **places** that handle an _uncontrolled_ upstream string — a crawl **source-failure** `reason` and a **requirements-failure** `reason`, both derived from a GitHub-client error — pass it through `redact()` (strips `ghp_`/`github_pat_`/… token shapes) before it reaches logs **or** the `POST /refresh` response, so an accidentally-echoed credential cannot leak (NFR-2).
- **Reason:** Matches the sibling apps' Powertools-free posture (design §4); CloudWatch already timestamps, so embedding one is redundant; a non-scrubbing hot path stays trivial while the single redaction boundary covers the only untrusted string. Promoted to a decision because these are security-relevant contracts that otherwise lived only in a code comment.
- **Affects:** NFR-5, NFR-2, R-02; `packages/functions/src/log.ts`, `refresh.ts`, `authorizer.ts`, `seed.ts`, `generate.ts`.

---

_(D-44…D-48 added 2026-07-15 for the Requirements Catalog component — recipe Phase 1, resolved with the user via clarifying questions before spec generation.)_

**D-44 — Requirements are crawled from each source's `docs/spec.md` in the same `POST /refresh` pass.**

- **Decision:** The existing writer-only crawl (R-10) additionally fetches, parses, and catalogs each source's `docs/spec.md` EARS requirements in the same run, recorded in the same crawl-run record; there is no separate requirements-only endpoint.
- **Reason:** The user chose "extend `POST /refresh`" — one trigger and one crawl-run keep the operator model and the freshness story identical to contracts, and requirements + contracts come from the same repo tip so a single crawl is coherent.
- **Affects:** R-100, R-101, R-108, R-12, R-10; `packages/functions/src/refresh.ts`, `packages/core/src/github.ts`.

**D-45 — Requirements use a latest-snapshot + change-flag model, not append-only history.**

- **Decision:** Each source's requirement set is stored as the **current snapshot** only; a per-requirement **`changedInLastCrawl`** flag (computed by comparing text against the prior snapshot, keyed on the `docs/spec.md` blob SHA) records what moved. No `REQVER#` history items are kept — deliberately unlike contracts (D-10).
- **Reason:** The user chose latest-snapshot + change flag. Requirement **prose churns** (wording tweaks, renumbering) far more than contract structure, and the registry's value here is "what does each app require **now**, and what just changed" — not a full timeline. This keeps the data model and code materially lighter than the contract version history.
- **Affects:** R-106, R-107, R-114, E-31, E-32, E-33; `packages/functions/src/repository.ts`.

**D-46 — Extraction parses EARS type + modality and flags non-conforming lines but still catalogs them.**

- **Decision:** The parser derives each requirement's EARS **type** (event/unwanted/state/optional/ubiquitous from WHEN/IF/WHILE/WHERE/none) and **modality** (SHALL/SHOULD/MAY); a line lacking a modality is flagged **`earsConforming: false`** and **still cataloged** (never dropped).
- **Reason:** The user chose the richer model. Classifying by EARS keyword powers SPA grouping/filtering and makes the catalog genuinely "EARS-aware"; flagging-but-keeping non-conforming lines is fault-isolating (mirrors D-27/R-21) so a stray bullet never loses a real requirement.
- **Affects:** R-102, R-103, R-104, E-30; `packages/core/src/requirements.ts` (new parser).

**D-47 — Requirements are cataloged per source independently; no cross-source requirement divergence/diff.**

- **Decision:** Unlike contracts (which get a shared-entity divergence flag + semantic diff, R-34/R-53/D-2), requirements are cataloged **per source only**; the registry does **not** compare, align, or diff requirements across the publisher and consumer.
- **Reason:** Contracts share an **entity identity** across apps (both have an `org` contract), so divergence is meaningful; requirement `R-13` in the publisher and `R-13` in the consumer are **unrelated** documents with no shared identity, so a cross-source requirement diff would be noise. Scoped out in §2.
- **Affects:** §2 (Out of Scope), R-106…R-112; contrast with R-34/R-53.

**D-48 — Requirements are surfaced via a read API + a SPA browse view.**

- **Decision:** Three reader-authed read endpoints (`GET /requirements`, `/requirements/{source}`, `/requirements/{source}/{id}`) plus a **Requirements** SPA view added as a third toggle beside By entity / By source (reusing the D-22 toggle pattern).
- **Reason:** The user chose "API + SPA". The endpoints mirror the contracts read API (R-50…R-56) for consistency; the SPA toggle reuses the existing browse chrome (D-22) for minimal new UI surface.
- **Affects:** R-109, R-110, R-111, R-112, R-113; `packages/functions/src/read.ts`, `stacks/ApiStack.ts`, `packages/functions/src/authorizer.ts`, `packages/web`.

---

_(D-49 added 2026-07-16 during the fourth health-check pass — recipe Step 11. Records the in-source requirement id-collision handling, giving the requirements crawl full parity with the contract R-30a rule.)_

**D-49 — A repeated requirement id within one source is kept-first and recorded as a collision.**

- **Decision:** IF a source's `docs/spec.md` declares the same `R-nn` more than once under the requirements section, `putRequirements` catalogs the **first** occurrence, drops the rest (enforcing the R-106 `{source, id}` key — a batch cannot carry duplicate keys), and returns the colliding id(s); the crawl logs `crawl.requirements.collision` and carries the ids in the run summary's per-source `requirements` block. This mirrors the contract in-source id-collision rule (R-30a/E-9) — both halves: keep-first **and** surface the collision.
- **Reason:** The v0.5.3 dedup added keep-first but not the visibility; a silently-dropped requirement is an authoring bug worth surfacing, exactly as for contracts. Fresh-eyes health check #4 flagged the asymmetry.
- **Affects:** R-106, R-108, E-38, D-43 (`crawl.requirements.collision`); `packages/functions/src/repository.ts` (`putRequirements`), `refresh.ts`.

---

_(D-50…D-56 added 2026-07-16 for the LLM-Powered Functional Test Generator — recipe Phase 1, resolved with the user via assumption-validation + clarifying questions before spec generation.)_

**D-50 — Functional tests require an LLM; the deterministic generators do not.**

- **Decision:** The §3.9 conformance/compatibility generators stay deterministic (they work from structured contract data). The new §3.11 **functional** tests use an **LLM**, because a functional scenario lives in each service's **natural-language EARS prose** — turning "WHEN X THE system SHALL Y" into a runnable cross-service test is an open-ended NL→code synthesis over input the registry does not control (D-3 forbids modifying the apps to add a machine-readable DSL).
- **Reason:** The user's assumption was validated: deterministic parsing can't cross the prose gap, and the non-LLM alternative (GWT `it.todo` scaffolds) under-delivers (stubs, not runnable tests).
- **Affects:** §3.11, R-117; NFR-9.

**D-51 — The LLM synthesises a structured plan, not raw code; a deterministic layer renders it.**

- **Decision:** The LLM produces a **structured functional-test plan** (JSON) via **structured outputs** validated against a fixed schema — it selects entities/endpoints from the supplied contract/requirement/api-map context. The existing §3.9 emit approach then renders the plan → Vitest.
- **Reason:** Constraining the model to a schema over real targets **contains hallucination** (no invented endpoints), **preserves render determinism** (only the plan is model-authored), and **reuses the manifest+emit pattern** (D-28).
- **Affects:** R-117, R-117a, R-122, R-123.

**D-52 — Determinism is reconciled by an input-hash cache + a committed plan; R-88 is scoped to exclude §3.11 synthesis.**

- **Decision:** Each synthesised plan is **cached** by `{requirement hash + contract hash + api-map entry + model id + prompt version}` and committed as a reviewed artifact; a job re-invokes the LLM only when an input changed, and re-renders cached plans **byte-identically** (R-119/R-119a). R-88's byte-identical guarantee therefore applies to the render step but **not** to plan synthesis.
- **Reason:** The user chose "committed artifact + input-hash cache" over accepting nondeterministic diffs; it keeps `git diff generated-tests/functional` stable while allowing an LLM in the loop.
- **Affects:** R-88 (scoped), R-119, R-119a, §2, E-42, E-43; NFR-9.

**D-53 — Functional generation runs asynchronously (a job), not on the synchronous endpoint.**

- **Decision:** `POST /generate-functional-tests` starts an **async job** (returns `202` + a job id); the job runs the LLM pipeline in the background; `GET /functional-test-jobs/{id|latest}` polls/retrieves; the CLI triggers + polls + writes the artifacts for human review (D-34).
- **Reason:** The user chose an async endpoint. LLM latency (Opus over N requirements, optionally the Batch API) exceeds the API Gateway synchronous limit (contrast NFR-8 / R-80's synchronous generation).
- **Affects:** R-115, R-124, R-125, R-126; NFR-9.

**D-54 — Scope is cross-service behaviour grounded in EARS + contracts + api-map; ungroundable requirements are skipped.**

- **Decision:** Functional tests exercise the **publisher → CDC → consumer** flow, grounded in each service's EARS requirements, ODCS contracts, and the api-map. Single-service, unmapped, entity-less, or infra-only requirements are **skipped with a reason** (mirrors D-27).
- **Reason:** The user chose the cross-service scope; it is where the end-to-end value is, and fault isolation keeps a partial catalog useful.
- **Affects:** R-117a, R-120, R-121, E-39, E-40.

**D-55 — Claude on Amazon Bedrock via `@aws-sdk/client-bedrock-runtime` `InvokeModel`; IAM-role auth; no stored key.**

- **Decision:** Plan synthesis calls **Claude on Amazon Bedrock** — default the granted US Sonnet 4.6 cross-region inference profile `us.anthropic.claude-sonnet-4-6` (Opus 4.8 `us.anthropic.claude-opus-4-8` once its access grant lands), overridable per stage via `BEDROCK_MODEL_ID` — through the **AWS-native `@aws-sdk/client-bedrock-runtime` `InvokeModel`** operation. **Structured output uses forced tool use**: a single tool whose `input_schema` IS `PLAN_SCHEMA` with `tool_choice` pinned to it, so the plan returns as the tool-use `input` (broadly supported on Bedrock InvokeModel; the beta `output_format` endpoint is not routable on Bedrock). Auth is the worker Lambda's **execution role** (SigV4) granted `bedrock:InvokeModel`; there is **no API key or SST Secret**. The prompt is **versioned** and, with the model id, part of the cache key (a prompt or model change invalidates cached plans).
- **Reason:** The registry already runs on AWS with IAM, so Bedrock removes the managed-secret surface entirely (strengthens NFR-2) and keeps billing/governance in-account. The AWS SDK hits the correct `InvokeModel` operation directly (the `@anthropic-ai/bedrock-sdk` client returned `UnknownOperationException` against this account's Bedrock endpoint); forced tool use is the portable structured-output mechanism there, and the core re-validates every response with Ajv (D-51). _(Superseded the original v0.6.0 draft — Anthropic first-party SDK + an `ANTHROPIC_API_KEY` SST Secret — at the user's direction, 2026-07-16.)_
- **Operational note:** Invoking requires the AWS account to have **Bedrock model access** for the chosen model (Anthropic use-case form + a model-access grant per model); until then invocation returns `AccessDenied`/`ResourceNotFound`, which a job records as `failed` (E-46). The pipeline (IAM auth, InvokeModel, forced tool use) is verified end-to-end.
- **Affects:** R-117, R-118, R-124, NFR-9; new dependency `@aws-sdk/client-bedrock-runtime`; a `bedrock:InvokeModel` IAM grant on the worker (no new secret).

**D-56 — Generate-and-store only; running the functional tests stays future work.**

- **Decision:** The functional generator produces and stores tests and lands them in `generated-tests/functional/` for review; **executing** them is a separate future feature.
- **Reason:** Re-affirms D-29 for this new test class; running true cross-service e2e needs both apps deployed + live creds + a runner — infra out of scope here.
- **Affects:** §2, R-123; D-29 (re-affirmed).

<!-- Decisions promoted at the 2026-07-17 periodic health check (recipe Step 11, HC-4): implementation choices made in code during the D-50…D-56 Bedrock/functest work that lacked a decisions-log entry. -->

**D-57 — Functional-worker Lambda sizing: 15-minute timeout, 1024 MB.**

- **Decision:** The async functional-gen worker runs with `timeout: "15 minutes"` and `memorySize: "1024 MB"` (vs the 30s route handlers).
- **Reason:** D-53 established the job is async because LLM synthesis exceeds the 29s gateway limit but set no concrete ceiling; 15 min is the Lambda maximum, chosen as headroom for a multi-requirement Bedrock loop; 1024 MB gives proportional CPU without over-provisioning.
- **Affects:** R-115, D-53; NFR-9. Evidence: `stacks/ApiStack.ts` (`FunctionalWorker`).

**D-58 — `bedrock:InvokeModel` IAM scope: all Anthropic foundation-models + all inference-profiles.**

- **Decision:** The worker's IAM grant scopes `bedrock:InvokeModel` to `arn:aws:bedrock:*::foundation-model/anthropic.*` and `arn:aws:bedrock:*:*:inference-profile/*`.
- **Reason:** Lets `BEDROCK_MODEL_ID` switch models/profiles per stage without a policy change (D-55's one-env-var switch). The foundation-model ARN is Anthropic-only; the **inference-profile ARN is intentionally account-wide** (profile ARNs don't carry the model vendor), accepted because InvokeModel is the only granted action and the account's profiles are all first-party. Revisit (scope to specific profile ARNs) if non-Anthropic profiles are ever provisioned.
- **Affects:** D-55; NFR-2. Evidence: `stacks/ApiStack.ts` (worker `PolicyStatement`).

**D-59 — Bedrock request cap: `max_tokens: 8192`.**

- **Decision:** Each `InvokeModel` call caps output at `max_tokens: 8192`.
- **Reason:** A single structured test-plan is small; 8192 bounds cost/latency with ample headroom for the largest plan.
- **Affects:** R-118, D-55. Evidence: `packages/functions/src/llm.ts`.

**D-60 — Grounding uses the `publisher` variant's schema as the canonical trigger shape.**

- **Decision:** When an entity exists in ≥2 sources, grounding feeds the LLM the **`publisher`** variant's `schema[0]` (by literal source name), falling back to the alphabetically-first source.
- **Reason:** The publisher is the write side of the publisher→CDC→consumer flow (D-3/D-50), so its schema is authoritative for the trigger payload.
- **Affects:** R-117, D-54. Evidence: `packages/functest/src/ground.ts`.

**D-61 — Entity-reference detection: whole-word, case-insensitive, optional trailing plural.**

- **Decision:** A requirement "references" a cataloged entity when the entity name matches as a whole word (case-insensitive, optional trailing `s`) in the requirement text; this gates groundability (a match keeps it, no match skips it with a reason).
- **Reason:** A cheap deterministic NL heuristic to pick the relevant entity before the LLM is invoked; D-54 says entity-less requirements are skipped but never specified the matching mechanism.
- **Affects:** R-121, D-54. Evidence: `packages/functest/src/ground.ts` (`mentions()`).

**D-62 — Catalog/requirements list endpoints use a filtered `Scan`, not a GSI query.**

- **Decision:** `listEntries` (R-50) and `listRequirements` (R-109) read the single table with `Scan` + `begins_with(SK, …)` + in-memory filters, rather than a dedicated GSI.
- **Reason:** At the NFR-3 target scale (≥10 sources × ≥25 contracts + versions + requirements ≈ low-thousands of small items) the table is a single Scan page (<1 MB, tens of ms), so NFR-1's 300 ms p95 SHOULD is met without a GSI's write-amplification and projection cost. **Revisit** (add a constant-partition or `kind` GSI and switch to `Query`) if the catalog grows beyond a single Scan page or p95 regresses.
- **Affects:** R-50, R-109; NFR-1, NFR-3. Evidence: `packages/functions/src/repository.ts`.

<!-- End of spec v0.6.0 — LLM-Powered Functional Test Generator (§3.11, R-115…R-126; NFR-9; E-39…E-47; D-50…D-56): async job synthesises structured cross-service functional-test plans with an LLM (grounded in contracts + EARS + api-map, structured outputs), caches plans by input-hash (R-88 scoped out of synthesis), renders deterministically, stores + delivers via CLI for human review. Generate-and-store only (D-56). -->
<!-- End of spec v0.5.4 — fourth health check (fresh eyes): requirement id-collision keep-first + crawl.requirements.collision (D-49, E-38); GET /requirements natural-id order (R-109); batchWriteAll backoff; StorageStack item-kind comment; design §9.1 buildManifest→serializeManifest, §10.3 dedup step, latest-404 note; compliance CLI instruction fixed; version stamps re-synced. No requirement behaviour weakened. -->
<!-- Prior: v0.5.3 — third health check (fresh eyes): putRequirements de-dups repeated R-nn (R-106 key, mirrors R-30a); tested present-but-no-section wipe; dropped "unreadable" from R-105/E-29 wipe branch (it's R-105a); design header + §8 traceability updated for §10. No requirement changed. -->
<!-- Prior: v0.5.2 — second health check (fresh eyes): spec-doc fetch moved into the isolated block (R-105a covers it); BatchWrite retries UnprocessedItems (R-107/NFR-4); parser keeps heading number (R-102); R-114 S3 key = {source}; D-43 redaction "the places"; R-105 whole-source-vs-spec-doc clarified; design §1/§3 aligned. -->
<!-- Prior: v0.5.1 — Requirements Catalog health check (recipe Step 11): R-105 absent-spec = wipe-to-zero (fetch-fail keeps prior); R-105a requirements-failure isolation; E-36/E-37 added; crawl.requirements.done + crawl.requirements.failed added to D-43 taxonomy; design §10.2/§10.3 corrected. -->
<!-- Prior: v0.5.0 — Requirements Catalog component (§3.10, R-100…R-114; E-29…E-35; D-44…D-48): crawl each source's docs/spec.md EARS requirements in the same POST /refresh, catalog per-source latest-snapshot + change flag (no history), serve via 3 read endpoints + a SPA toggle. -->
<!-- End of spec v0.4.2 — health check pass 1: D-37…D-41 promote pre-existing decisions; D-42 removes the out-of-scope conformance runner; code brought into compliance for NFR-5, R-12, R-62, R-82/R-86, R-89. Pass 2: D-43 documents the logging contract; R-15 409 now carries the in-flight run id; entity-diff ordering fixed publisher-first; credential-redaction boundary added; R-91a prose aligned to D-36. -->
<!-- Prior: v0.4.1 — D-35 (generate-tests CLI UX): all config from `sst bind`/SSM; R-91a added. D-36: resource/config values read via sst/node bindings, not env vars. -->
<!-- Prior: v0.3.0 — change request D-22 (by-source view) folded in. -->
<!-- Prior: v0.3.0 — change request D-22 (by-source view) folded in. -->
