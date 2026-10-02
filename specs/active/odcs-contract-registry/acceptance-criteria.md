# ODCS Contract Registry — Acceptance Criteria (GIVEN / WHEN / THEN)

> Derived from `docs/spec.md` (v0.5.4). Each block traces to a requirement `R-nn` (and, where relevant, an edge case `E-nn` / decision `D-nn`). These skeletons become the failing tests written **before** implementation in Phase 4 (Step 8). The spec is the oracle — if a test here ever contradicts the spec, fix the test.
>
> **Test tiers** (mirroring the two apps): **[infra]** offline CloudFormation-synth assertions over the SST stacks; **[unit]** pure logic (crawler parsing, validation, hashing, diff, handlers) with the GitHub client and AWS SDK mocked; **[gen-unit]** pure test-generator logic (catalog → artifact set) over catalog fixtures — the _generated_ tests are not executed here (D-29); **[web]** jsdom SPA tests. NFRs are verification scenarios, not unit tests.

---

## Sources & Configuration — R-01…R-03

**AC-01 (R-01, D-5)** — [infra/unit]

- GIVEN the registry's source configuration
- WHEN it is inspected
- THEN exactly two sources are defined — `publisher` → `collegeboard-personal/awp-odcs-publishing` and `consumer` → `collegeboard-personal/awp-odcs-consuming` — each with a stable label, `owner/repo`, and default branch

**AC-02 (R-02, D-14, NFR-2)** — [infra/unit]

- GIVEN the deployed stack and the crawler
- WHEN the GitHub credential is resolved
- THEN it is read from the SST Secret `GITHUB_TOKEN` AND it never appears in any API response body or log line (asserted by scanning emitted logs for the token value)

**AC-03 (R-03, R-10, D-14)** — [unit]

- GIVEN a source repo's recursive git tree
- WHEN the crawler selects files
- THEN it selects exactly the paths matching `contract/*.odcs.yaml` AND ignores everything else (e.g. `odcs-v3.1.0.schema.json`, `*.schema.json`, files outside `contract/`)

---

## Crawl / Refresh — R-10…R-16

**AC-10 (R-10, R-11, D-14)** — [unit]

- GIVEN both sources reachable, each exposing `contract/*.odcs.yaml` blobs
- WHEN `POST /refresh` runs a crawl
- THEN every matching file in every source is fetched via the Git Trees + Blobs API AND each ingested entry records {source label, repo, file path, branch-tip commit SHA, blob SHA/content hash}

**AC-12 (R-12)** — [unit]

- GIVEN a completed crawl
- WHEN the `POST /refresh` response and the persisted crawl-run record are read
- THEN both contain: run id, start/end timestamps, sources crawled, and per-source counts {discovered, valid, invalid, new-version, unchanged}

**AC-13 (R-13, E-1, D-9)** — [unit]

- GIVEN source `publisher` returns a GitHub 5xx / auth error while `consumer` succeeds
- WHEN the crawl runs
- THEN `publisher` is marked `failed` in the run, `consumer` is still fully cataloged, AND the previously-cataloged `publisher` entries are left unchanged (no deletion)

**AC-14 (R-14, E-2)** — [unit]

- GIVEN a reachable source with **no** `contract/*.odcs.yaml` files
- WHEN the crawl runs
- THEN that source's outcome is `success` with 0 discoveries (not an error)

**AC-15 (R-15, E-11, D-15)** — [unit]

- GIVEN a crawl is in progress (lock item held)
- WHEN a second `POST /refresh` arrives
- THEN it responds `409 Conflict` with the in-flight run id AND no second concurrent crawl starts; AND GIVEN a stale lock past its TTL, a new crawl may acquire the lock

**AC-16a (R-16, E-12a, D-21)** — [unit/infra]

- GIVEN `POST /refresh`
- WHEN called with **no** `Authorization` header
- THEN response is `401` (gateway short-circuits) and no crawl runs

**AC-16b (R-16, E-12b, D-21)** — [unit/infra]

- GIVEN `POST /refresh`
- WHEN called with an **expired/malformed** token
- THEN the authorizer denies → response is `403` and no crawl runs

**AC-16c (R-16, R-71, E-13)** — [unit/infra]

- GIVEN a valid token whose user is in `reader` only
- WHEN `POST /refresh`
- THEN the authorizer denies (writer required) → response is `403` and no crawl runs

---

## Validation — R-20…R-23

**AC-20 (R-20)** — [unit]

- GIVEN a discovered file whose bytes are a valid ODCS v3.1.0 contract
- WHEN it is validated against the vendored `odcs-v3.1.0.schema.json`
- THEN validation passes AND the entry is cataloged `validation: valid`

**AC-21a (R-21, E-3)** — [unit]

- GIVEN a discovered file that is **not valid YAML**
- WHEN ingested
- THEN the entry is cataloged `validation: invalid` with a parse-error detail AND the crawl continues to the remaining files

**AC-21b (R-21, E-4, D-9)** — [unit]

- GIVEN a file that parses as YAML but **fails** the ODCS v3.1.0 schema (e.g. missing `kind`)
- WHEN ingested
- THEN the entry is `validation: invalid` with a structured list of failing schema paths/rules AND other files in the same crawl are unaffected

**AC-22a (R-22, D-12)** — [unit]

- GIVEN a valid contract
- WHEN metadata is extracted
- THEN {id, name, version, apiVersion, kind, status, domain, dataProduct, tags} are captured AND `entity == schema[0].name`

**AC-22b (R-22, E-15, D-12)** — [unit]

- GIVEN a valid-enough contract whose `schema[]` is empty or has no usable name, in a file `enrollment.odcs.yaml`
- WHEN metadata is extracted
- THEN `entity == "enrollment"` (filename-stem fallback) AND the entry is still cataloged

**AC-23 (R-23, D-20)** — [unit]

- GIVEN a `contract/` directory containing `org.odcs.yaml`, `org.schema.json`, and `odcs-v3.1.0.schema.json`
- WHEN the crawler runs
- THEN only `org.odcs.yaml` is cataloged as a contract; the compiled schema and the meta-schema are not

---

## Catalog Model & Versioning — R-30…R-34

**AC-30 (R-30, D-2, E-5)** — [unit]

- GIVEN the identical `org` contract present in both repos
- WHEN both are cataloged
- THEN there are **two** distinct entries — `{publisher, <org-id>}` and `{consumer, <org-id>}` — neither merged into the other

**AC-30a (R-30a, E-9, D-13)** — [unit]

- GIVEN one source containing two files that declare the same contract `id`
- WHEN cataloged
- THEN the first is cataloged AND an id-collision warning naming both file paths is recorded in the crawl run (no silent overwrite)

**AC-31 (R-31)** — [unit]

- GIVEN a `{source, id}` not seen before
- WHEN cataloged
- THEN a new entry is created at history version 1

**AC-32 (R-32, E-7)** — [unit]

- GIVEN a `{source, id}` whose stored current content hash equals the freshly-crawled hash
- WHEN re-crawled
- THEN no new history version is appended AND only last-seen timestamp / commit SHA are updated

**AC-33 (R-33, E-8)** — [unit]

- GIVEN a `{source, id}` whose freshly-crawled content hash **differs** from the stored current version
- WHEN re-crawled
- THEN a new history version is appended AND all prior versions and their metadata remain retrievable (append-only)

**AC-33a (R-33a, E-10, D-16)** — [unit]

- GIVEN a content-differing new version whose declared `version` field equals the superseded version's declared `version`
- WHEN the new version is recorded
- THEN it carries a `versionNotBumped` warning AND the declared `version` is surfaced alongside the content hash

**AC-34 (R-34, D-2)** — [unit]

- GIVEN two source variants of an entity
- WHEN their current content hashes are compared
- THEN the entity reports `divergent: true` IFF the hashes differ (`org` → false in the seed data; `user`/`class`/`enrollment` → true) (E-5, E-6)

---

## Storage — R-40…R-42

**AC-40 (R-40)** — [infra]

- GIVEN the deployed stack
- WHEN the DynamoDB table(s) are inspected
- THEN catalog entries, versions, and crawl-run records are persisted in DynamoDB (on-demand billing)

**AC-41 (R-41)** — [unit/infra]

- GIVEN a cataloged version
- WHEN its raw document is requested
- THEN the exact original bytes are retrievable from S3, addressed by {source, id, version, content hash}, including for superseded historical versions

**AC-42 (R-42, NFR-2)** — [infra]

- GIVEN the DynamoDB table and the S3 bucket
- WHEN their settings are inspected
- THEN both are encrypted at rest AND the S3 bucket blocks all public access

---

## Read API — R-50…R-56

**AC-50 (R-50)** — [unit]

- GIVEN a populated catalog
- WHEN `GET /contracts`
- THEN response is `200` with one row per {source, id} entry carrying {source, entity, id, name, current version, validation, last-crawled}; AND `?source=`, `?entity=`, `?validation=` filters narrow the result correctly

**AC-51 (R-51)** — [unit]

- GIVEN an existing entry with multiple history versions
- WHEN `GET /contracts/{source}/{id}`
- THEN response is `200` with full metadata AND the version history (each: version #, content hash, commit SHA, crawled-at, validation)

**AC-52 (R-52)** — [unit]

- GIVEN an existing entry
- WHEN `GET /contracts/{source}/{id}/raw` (and `...?version=<n>`)
- THEN response is `200` with the raw ODCS YAML (appropriate content type) for the requested version, defaulting to current

**AC-53 (R-53, D-18, E-6)** — [unit]

- GIVEN entity `user` with a `publisher` and a `consumer` variant that differ
- WHEN `GET /entities/user`
- THEN response is `200` listing both variants, `divergent: true`, AND a semantic per-property diff enumerating properties/fields/quality-rules added / removed / changed (old→new); AND for entity `org`, `divergent: false` with an empty diff (E-5)

**AC-54 (R-54, E-14)** — [unit]

- GIVEN a catalog
- WHEN a GET targets an unknown source, id, entity, or version
- THEN response is `404`

**AC-55 (R-55, R-12)** — [unit]

- GIVEN completed crawls
- WHEN `GET /crawls` and `GET /crawls/{runId}`
- THEN response is `200` with crawl-run history / the single run summary

**AC-56 (R-56, E-12a, E-12b, D-21)** — [unit/infra]

- GIVEN any read endpoint
- WHEN called with **no** `Authorization` header → response is `401`; WHEN called with an expired/malformed token, or a valid token in no registry group → the authorizer denies → response is `403`
- THEN in every case no catalog data is returned

**AC-57 (R-71, D-21)** — [unit]

- GIVEN the `RegistryAuthorizer` and a valid `writer` access token
- WHEN it evaluates `routeKey` `POST /refresh` vs a read route
- THEN both are Allowed; AND GIVEN a valid `reader`-only token, `POST /refresh` is Denied while read routes are Allowed (per-route group rule, cache disabled)

---

## Web Front-End — R-60…R-64

**AC-60 (R-60)** — [web]

- GIVEN an unauthenticated visitor
- WHEN they open the SPA
- THEN they are redirected to Cognito login AND only reach the app after success, with the access token attached to subsequent API calls

**AC-61 (R-61, R-34)** — [web]

- GIVEN an authenticated reader and a populated catalog
- WHEN the list view renders
- THEN contracts are grouped by entity, each variant shown, AND entities whose variants diverge are visibly flagged, AND the view is toggleable with the by-source view (R-65)

**AC-62 (R-62, D-16)** — [web]

- GIVEN a selected contract
- WHEN its detail renders
- THEN metadata, raw ODCS YAML, and version history are shown, including any `versionNotBumped` flag

**AC-63 (R-63, D-18)** — [web]

- GIVEN a divergent entity
- WHEN its diff view renders
- THEN a per-property publisher-vs-consumer diff is displayed

**AC-64 (R-64, R-71, E-17)** — [web]

- GIVEN an authenticated **writer**
- WHEN the SPA renders
- THEN a Refresh action is available and, when invoked, surfaces the crawl-run summary; AND GIVEN a reader-only user, the Refresh action is hidden/disabled

**AC-65 (R-65, D-22)** — [web]

- GIVEN an authenticated reader and a populated catalog
- WHEN the user switches to the by-source view
- THEN each crawled source is listed with its associated contracts as summary rows (entity, declared version, validation status), AND selecting a contract row opens the same detail panel as AC-62

---

## Identity & Access — R-70…R-72

**AC-70 (R-70, D-17)** — [infra]

- GIVEN the Cognito user pool
- WHEN its settings are inspected
- THEN self-service sign-up is disabled

**AC-71 (R-71)** — [infra/unit]

- GIVEN the user pool
- WHEN groups and endpoint authorisation are inspected
- THEN `reader` and `writer` groups exist; `reader` authorises GET endpoints; `writer` additionally authorises `POST /refresh`

**AC-72 (R-72, D-17)** — [infra]

- GIVEN a fresh deploy
- WHEN users are inspected
- THEN one `reader` and one `writer` demo user exist, each assigned to its group

---

## Test Generation — R-80…R-93

> New tier **[gen-unit]**: pure generator logic (catalog → artifact set) tested offline against catalog fixtures. The _generated_ tests are **not run** here (out of scope, D-29); these ACs assert what the generator **emits** (manifest entries + emitted file structure), not the result of executing them.

**AC-80 (R-80, D-29)** — [unit/infra]

- GIVEN an authenticated **writer** and a populated catalog
- WHEN `POST /generate-tests` is invoked
- THEN it responds `200` with a generation-run summary (run id, timestamps, counts: conformance/compat generated + skipped) AND the artifact set is persisted (S3 + DynamoDB run record, AC-89)

**AC-80a (R-80a, E-24, D-21)** — [unit]

- GIVEN `POST /generate-tests`
- WHEN called with no `Authorization` header / an invalid-or-expired token / a valid non-writer token
- THEN it responds `401` / `403` / `403` respectively AND no generation run occurs

**AC-81 (R-81, E-19)** — [gen-unit]

- GIVEN an **empty** catalog
- WHEN generation runs
- THEN it produces an empty artifact set (empty manifest test list) AND records the run as **success** with zero counts AND does not crawl GitHub

**AC-82 (R-82)** — [gen-unit]

- GIVEN a catalog entry at a known content hash and declared version
- WHEN a test is generated from it
- THEN the manifest entry records that exact content hash (blob SHA) and declared version

**AC-83 (R-83, D-25)** — [gen-unit]

- GIVEN an applicable cataloged contract with a configured API mapping
- WHEN conformance generation runs
- THEN a `conformance/<source>.<entity>.generated.test.ts` is emitted whose body fetches the entity's records from the app's API base URL + path and validates **each** record against a schema derived from the contract's `schema[]`, failing on the first non-conforming record (asserted over the emitted file + its manifest entry)

**AC-83a (R-83a, E-23, D-26)** — [gen-unit]

- GIVEN an emitted conformance test
- WHEN its required env vars (API base URL, Cognito token) are unset
- THEN the test is **skipped** (guarded by the env-var names named in the manifest), not failed

**AC-83b (R-83b, E-27)** — [gen-unit]

- GIVEN a cataloged entity with **no** configured API path/env mapping
- WHEN conformance generation runs
- THEN no conformance test is emitted for it AND a skip entry `{kind: conformance, target, reason}` is recorded

**AC-84 (R-84, R-84a, D-24, E-25, E-26)** — [gen-unit]

- GIVEN an entity present in both `publisher` and `consumer` variants
- WHEN the compatibility check is computed (consumer-can-read-publisher)
- THEN a property the consumer **requires** that is **missing or type-incompatible** in the publisher yields a **fail** assertion (naming entity + property path + reason) AND a property present only as an **extra** in the publisher yields **no** failure

**AC-85 (R-85, E-20, E-21)** — [gen-unit]

- GIVEN a catalog containing one `validation: invalid` contract AND one single-source entity (e.g. consumer-only `class-roster`)
- WHEN generation runs
- THEN conformance is skipped for the invalid contract with a reason AND compat is skipped for the single-source entity with a reason AND every other contract/entity is still generated

**AC-86 (R-86)** — [gen-unit]

- GIVEN a completed generation
- WHEN the manifest is inspected
- THEN it lists every generated test with `{kind, source, entity, contractId, contentHash, version, targetCoordinates, assertion}` and every skip with `{kind, target, reason}`

**AC-87 (R-87, D-28)** — [gen-unit]

- GIVEN the emitted `*.generated.test.ts` files
- WHEN they are parsed/typechecked
- THEN they are valid TypeScript Vitest files, each carrying a "generated — do not edit" header naming its manifest entry

**AC-88 (R-88, E-22, E-28)** — [gen-unit]

- GIVEN the same catalog content
- WHEN generation runs twice
- THEN both runs produce **byte-identical** manifest + files (no timestamps/run-ids/random values in committed artifacts); AND WHEN a previously-generated contract is removed from the catalog, its `*.generated.test.ts` is **absent** after regeneration (tree replaced wholesale)

**AC-89 (R-89)** — [unit/infra]

- GIVEN a generation run
- WHEN persistence is inspected
- THEN the artifact set is stored in S3 (addressed by run id) AND a DynamoDB generation-run record holds run id, timestamps, counts, per-item skip reasons, and catalog commit context

**AC-90 (R-90, R-54)** — [unit]

- GIVEN a reader and at least one generation run
- WHEN `GET /test-artifacts` / `GET /test-artifacts/{runId}` / `GET /test-artifacts/latest` are called
- THEN each responds `200` with the run record + a means to retrieve that run's artifact set; an unknown `runId` responds `404`

**AC-91 (R-91, D-29, OQ-14)** — [unit]

- GIVEN the `npm run generate-tests` CLI and a writer credential
- WHEN it runs
- THEN it triggers (or pulls the latest) generation run, downloads the artifact set, and writes `generated-tests/manifest.json` + `*.generated.test.ts` into the working tree AND does not itself commit or push

**AC-92 (R-92, E-28)** — [gen-unit]

- GIVEN a generation with conformance + compat tests
- WHEN the output layout is inspected
- THEN files are exactly `generated-tests/manifest.json`, `generated-tests/conformance/<source>.<entity>.generated.test.ts`, `generated-tests/compat/<entity>.generated.test.ts`

**AC-93 (R-93)** — [infra/unit]

- GIVEN the registry's Vitest configuration
- WHEN `test:offline` / `test:web` / `test:all` run
- THEN `generated-tests/**` is excluded and none of the generated files are collected or executed

---

## Requirements Catalog — R-100…R-114

> The parser tier is pure/offline ([unit], `packages/core`): `docs/spec.md` text → requirement records. Storage/crawl/read ACs mirror the contract-path tiers.

**AC-100 (R-100, D-44)** — [unit]

- GIVEN a source repo's crawl
- WHEN the tree is enumerated
- THEN `docs/spec.md` on the default branch is discovered and its bytes fetched via the same Trees/Blobs path used for contracts

**AC-101 (R-101, D-44)** — [unit/infra]

- GIVEN an authorised writer
- WHEN `POST /refresh` runs
- THEN in the **same** crawl pass each source's `docs/spec.md` requirements are extracted and cataloged AND there is no separate requirements trigger

**AC-102 (R-102)** — [unit]

- GIVEN a `docs/spec.md` with numbered `- **R-nn** — …` bullets (incl. sub-ids like `R-17a`) under `## 3. Functional Requirements`
- WHEN the parser runs
- THEN each requirement's `id`, full `text`, and enclosing `### 3.x` section heading are extracted; bullets outside the requirements section are ignored

**AC-103 (R-103)** — [unit]

- GIVEN requirement bullets led by WHEN / IF / WHILE / WHERE / none, each with SHALL|SHOULD|MAY
- WHEN parsed
- THEN `earsType` = event / unwanted / state / optional / ubiquitous respectively AND `modality` = the first SHALL|SHOULD|MAY present

**AC-104 (R-104, E-30, D-46)** — [unit]

- GIVEN a requirement bullet with **no** modality keyword
- WHEN parsed
- THEN it is cataloged with `earsConforming: false` (still present) AND a bullet with a modality is `earsConforming: true`

**AC-105 (R-105, E-29, E-36)** — [unit]

- GIVEN a source whose `docs/spec.md` is absent or present-but-has-no-requirements-section (source reachable), OR whose crawl fails
- WHEN the crawl runs
- THEN the reachable-but-empty source has its requirement snapshot **wiped to zero** (`discovered: 0`, `removed` = prior count), recorded as a **success**; BUT IF the crawl **failed**, the source's previously-cataloged requirements are left **unchanged** (no deletion). (An unreadable/unparseable `docs/spec.md` is R-105a — keep prior; see AC-105a.)

**AC-105a (R-105a, E-37)** — [unit]

- GIVEN a source whose contracts catalog fine but whose requirements extraction/storage **throws** (e.g. `putRequirements` errors)
- WHEN the crawl runs
- THEN the failure is **isolated**: the source's contracts stay cataloged AND its `outcome` remains `success` AND its `requirements` block is marked `failed: true` AND `crawl.requirements.failed` is logged AND other sources are unaffected

**AC-106 (R-106, R-114, D-45)** — [unit]

- GIVEN a parsed requirement
- WHEN it is cataloged
- THEN the stored item carries `text`, `earsType`, `modality`, `section`, `earsConforming`, the spec's blob-SHA content hash, and (where present) the declared `Spec version`; the raw `docs/spec.md` bytes are stored in S3 keyed by {source} (latest snapshot, one object per source)

**AC-107 (R-107, E-31, E-32, E-33, D-45)** — [unit]

- GIVEN a source with a previously-stored requirement snapshot
- WHEN it is re-crawled
- THEN the set is replaced wholesale (no history) AND each requirement whose text differs (or is new) is flagged `changedInLastCrawl: true` AND an unchanged re-crawl flags none AND requirements absent from the new document are dropped

**AC-108 (R-108, R-12)** — [unit]

- GIVEN a completed crawl
- WHEN the crawl-run record / `POST /refresh` response is inspected
- THEN it carries per-source requirement counts: discovered / conforming / non-conforming / changed / removed

**AC-109 (R-109)** — [unit]

- GIVEN an authorised reader and a populated requirements catalog
- WHEN `GET /requirements` (optionally `?source=` / `?earsType=` / `?conforming=`) is called
- THEN it responds `200` with one row per {source, id} (source, id, section, earsType, modality, earsConforming, changedInLastCrawl), honouring the filters

**AC-110 (R-110)** — [unit]

- GIVEN a reader
- WHEN `GET /requirements/{source}` is called
- THEN it responds `200` with that source's full requirement set plus its spec version, content hash, and last-crawled timestamp

**AC-111 (R-111)** — [unit]

- GIVEN a reader
- WHEN `GET /requirements/{source}/{id}` is called for an existing requirement
- THEN it responds `200` with that requirement's full detail

**AC-112 (R-112, E-34, E-35, R-56, D-21)** — [unit]

- GIVEN the requirements read endpoints
- WHEN a request targets an unknown source/id → `404`; WHEN it presents no credential → `401`; WHEN invalid/insufficient → `403`
- THEN no requirement data is returned in the error cases

**AC-113 (R-113, D-48)** — [web]

- GIVEN an authenticated user in the SPA
- WHEN the **Requirements** toggle (third, beside By entity / By source) is selected
- THEN each source's requirements are listed grouped by section (id, text, earsType, modality) with non-conforming and changed-since-last-crawl requirements visibly flagged AND selecting one opens its detail panel

**AC-114 (R-114, R-42, D-45)** — [unit/infra]

- GIVEN a requirements crawl
- WHEN items are persisted
- THEN requirement items are written to the single DynamoDB table (new item kind) AND the raw `docs/spec.md` is stored in S3 (one latest object per source, replaced on content change), both encrypted at rest

---

## LLM Functional Test Generator — R-115…R-126

> New tier **[llm-unit]**: the plan-synthesis + render core tested offline with the **LLM behind a stub** (no network). The LLM is never called in the suite; these ACs assert what the generator **emits given a stub plan** and how the cache/skip/async wiring behaves — not the quality of a live model's output.

**AC-115 (R-115, R-115a, D-53)** — [unit/infra]

- GIVEN an authorised **writer** and a populated catalog
- WHEN `POST /generate-functional-tests` is invoked
- THEN it responds **`202`** with a job id + status URL AND does not block on the LLM; WHEN called with no / invalid / non-writer credential it responds `401` / `403` / `403` and no job starts

**AC-116 (R-116, E-39)** — [llm-unit]

- GIVEN a catalog with **no groundable requirement**
- WHEN a job runs
- THEN it produces an **empty** artifact set, records the run **success**, marks each requirement skipped-with-reason, AND does not crawl GitHub

**AC-117 (R-117, R-117a, D-50, D-51)** — [llm-unit]

- GIVEN an applicable requirement + its entity's contract `schema[]` + the api-map entry, and a **stubbed** LLM returning a schema-valid plan
- WHEN plan synthesis runs
- THEN the LLM is invoked with the grounded context AND the returned plan is validated against the test-plan schema (a plan naming an unknown entity/endpoint is rejected, not emitted) AND the plan records the requirement id(s) + the setup / trigger / propagation / assertions

**AC-118 (R-118, NFR-9, NFR-2)** — [llm-unit]

- GIVEN the offline suite
- WHEN the generator core runs
- THEN it uses the **injected LLM stub** with no network call AND Bedrock access is via the worker's IAM role (no stored key) so no credential ever appears in the manifest, logs, or job record

**AC-119 (R-119, E-42, E-43, D-52)** — [llm-unit]

- GIVEN a prior job's cached plans
- WHEN a job re-runs with an **unchanged** `{requirement, contract, api-map, model, prompt-version}` input hash
- THEN each plan is a **cache hit** and the LLM is **not** re-invoked; WHEN one input changes, only the affected plan is re-synthesised (cache miss) and the rest are reused

**AC-119a (R-119a, R-88-scoped)** — [llm-unit]

- GIVEN the same set of cached plans
- WHEN the emit step renders them twice
- THEN the emitted `*.generated.test.ts` are **byte-identical** (stable ordering, no timestamps/random) — a no-op diff

**AC-120 (R-120, E-41)** — [llm-unit]

- GIVEN a stub LLM that returns a **malformed / non-schema-valid** plan for one requirement
- WHEN the job runs
- THEN that requirement is **skipped** with a recorded reason AND the job continues and emits for every other requirement (not aborted, not corrupted)

**AC-121 (R-121, E-40)** — [llm-unit]

- GIVEN requirements that are single-service / reference no cataloged entity / have no API mapping / are infra-only
- WHEN the job runs
- THEN each is **skipped** with a `{requirement, reason}` entry AND groundable requirements are still generated

**AC-122 (R-122)** — [llm-unit]

- GIVEN a completed job
- WHEN the functional-test manifest is inspected
- THEN it lists every generated test `{kind: functional, requirementIds, scenario, inputHash, targets}` and every skip `{requirement, reason}`

**AC-123 (R-123, R-93-analog, D-28)** — [llm-unit/infra]

- GIVEN a completed job
- WHEN the tree is written
- THEN `generated-tests/functional/**` holds the manifest + `*.generated.test.ts` (each with a do-not-edit + requirement-id header), the subtree is replaced wholesale on regeneration, AND these files are excluded from `test:offline`/`test:web`

**AC-124 (R-124)** — [unit/infra]

- GIVEN a job
- WHEN it runs
- THEN a job record (id, status, timestamps, counts + skip reasons, catalog/model/prompt context) is persisted in DynamoDB AND the artifact set (manifest + files + plans) in S3, addressed by job id

**AC-125 (R-125, E-45)** — [unit]

- GIVEN a reader
- WHEN `GET /functional-test-jobs` / `/{jobId}` / `/latest` is called
- THEN it responds `200` with the job record + retrieval means; unknown jobId → `404`; auth failures → `401`/`403`

**AC-126 (R-126, D-34)** — [unit]

- GIVEN the CLI functional-gen mode
- WHEN it runs
- THEN it triggers a job, polls to completion, downloads the artifact set, writes `generated-tests/functional/**` into the working tree, AND does **not** commit or push

**AC-E46/E47 (R-118, R-124, NFR-9)** — [llm-unit]

- GIVEN denied/not-enabled Bedrock model access (E-46) or a mid-run crash/timeout (E-47)
- WHEN a job starts / runs
- THEN E-46: the job fails fast with a directive error on the record, no partial artifacts; E-47: the job record is `failed` and previously-committed `generated-tests/functional/**` are untouched

---

## Non-Functional (verification notes, not unit tests)

- **NFR-1** — read p95 < 300 ms (warm, served from cache); full two-repo crawl p95 < 30 s
- **NFR-2** — secret-scan: `GITHUB_TOKEN` never present in logs or responses (AC-02); IAM least-privilege review; TLS + at-rest encryption (AC-42)
- **NFR-3** — scale check: catalog remains correct with ≥10 sources × ≥25 contracts × full history without structural change
- **NFR-4** — fault-isolation chaos: force one source to fail, one file to be malformed, one contract to be invalid in a single crawl; assert the rest are cataloged and the catalog is never partially corrupt (AC-13, AC-21a/b)
- **NFR-5** — observability: per-source/per-file outcomes logged with offending path/id
- **NFR-6/7** — single-command SST v2 deploy; all code TypeScript

---

## Requirements that could NOT be expressed as GIVEN/WHEN/THEN

None. Every functional requirement (R-01…R-72, R-80…R-93, R-100…R-114, R-115…R-126) maps to at least one AC above. NFRs (incl. NFR-8 §3.9 determinism — see AC-88; NFR-9 §3.11 LLM usage/cost/offline seam — see AC-118/AC-119) are expressed as verification scenarios rather than unit-level GWT, which is expected for performance/scale/reliability/security properties.
