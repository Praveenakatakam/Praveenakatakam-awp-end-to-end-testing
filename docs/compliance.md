# ODCS Contract Registry — Compliance Audit

> **Phase 4 — Step 9 (Prompt 12); re-audited 2026-07-15 at the periodic health check (recipe Step 11); Requirements Catalog component added 2026-07-15 (spec v0.5.0), health-checked through 2026-07-16 (spec v0.5.4); LLM Functional Test Generator added 2026-07-16 (spec v0.6.0); five-vector health check 2026-07-17 closed minor drift → spec now **v0.6.1**.** Requirement-by-requirement audit of the implementation against `docs/spec.md` (v0.6.1). Implemented = code exists and matches; Tested = a passing test asserts it. Offline suite: **194 offline + 18 web = 212 passing**; `tsc` clean; full CFN synth passes. (v0.4.2 was 116; the Requirements Catalog added 40, incl. the v0.5.1 / v0.5.2 / v0.5.3 / v0.5.4 health-check remediations; the LLM Functional Test Generator added 51 offline at v0.6.0.) (v0.2.1 baseline was 64; the 2026-07-15 health check added structured logging, a real crawl end time, contract-detail metadata, compat declared-version + catalog-commit provenance, and a credential-non-leak guard — see the health-check note at the end.)

| Req | Summary | Implemented | Tested | Where |
|-----|---------|-------------|--------|-------|
| R-01 | Two fixed sources (publisher/consumer) | ✅ | ✅ | `core/sources.ts` · github.test |
| R-02 | GitHub credential from SST Secret | ✅ | ✅ | `AuthStack` GITHUB_TOKEN · createOctokitApi; credential-non-leak guarded in refresh.test (logs + summary never carry a token) |
| R-03 | Discover `contract/*.odcs.yaml` | ✅ | ✅ | `core/github.ts` · github.test (AC-03) |
| R-10 | `POST /refresh` crawls all sources | ✅ | ✅ | `refresh.ts` · refresh.test (AC-10/12) |
| R-11 | Record source/path/blobSha/commitSha | ✅ | ✅ | `github.ts` · github.test |
| R-12 | Crawl-run summary | ✅ | ✅ | `refresh.ts` · refresh.test (AC-12) |
| R-13 | Fault-isolate a failing source | ✅ | ✅ | `refresh.ts` · refresh.test (AC-13) |
| R-14 | Empty source = success/0 | ✅ | ✅ | refresh.test (AC-14) |
| R-15 | Single-flight lock → 409 | ✅ | ✅ | `repository.ts`/`refresh.ts` · repo+refresh tests (AC-15) |
| R-16 | 401 no-cred / 403 rejected | ✅ | ✅ | `authorizer.ts` · authorizer.test; ApiStack.test |
| R-20/21 | Validate ODCS; invalid cataloged not dropped | ✅ | ✅ | `core/odcs-validator.ts` · odcs-validator.test |
| R-22 | Extract metadata; entity resolution | ✅ | ✅ | `core/metadata.ts` · metadata.test (AC-22a/b) |
| R-23 | Ignore non-contract files | ✅ | ✅ | github.test + refresh.test (AC-23) |
| R-30/30a | Key {source,id}; collision flagged | ✅ | ✅ | `repository.ts`/`refresh.ts` (AC-30/30a) |
| R-31/32/33 | new / unchanged / new-version | ✅ | ✅ | `decideIngest` · repository.test |
| R-33a | `versionNotBumped` flag | ✅ | ✅ | repository.test (AC-33a) |
| R-34 | Entity divergence by hash | ✅ | ✅ | `getEntityVariants` · repository.test (AC-34) |
| R-40/41/42 | DynamoDB + S3, SSE, block public | ✅ | ✅ | `StorageStack` · StorageStack.test |
| R-50..55 | Read endpoints + 404s | ✅ | ✅ | `read.ts` · read.test |
| R-53 | Semantic per-property diff | ✅ | ✅ | `core/diff.ts` · diff.test; read.test |
| R-56 | Reads authenticated | ✅ | ✅ | `authorizer.ts` · ApiStack.test |
| R-60..64 | SPA login/browse/detail/diff/refresh | ✅ | ✅ | `web/App.tsx` · App.test (AC-60..64) |
| R-70/71 | Self-signup off; reader/writer groups | ✅ | ✅ | `AuthStack` · AuthStack.test |
| R-72 | Seed reader + writer demo users | ✅ | ✅ | `seed.ts` · seed.test (AC-72) |

**NFRs:** NFR-1 (cache-served reads) / NFR-3 (single-table + GSIs) — design properties, exercised at deploy (T-16). NFR-2 — GitHub token in SST Secret, bound only to the crawl Lambda; never logged (guarded in refresh.test). NFR-4 — fault isolation tested (AC-13/21). NFR-5 — ✅ structured logging via `functions/log.ts`: the crawl emits per-source and per-file (invalid/collision) events with the offending path/id, the authorizer logs each decision, the seed logs each user (never the password); asserted in refresh.test. NFR-6/7 — SST v2, all TypeScript, `tsc` clean.

## Test Generator component (spec v0.4.0 · R-80…R-93)

| Req | Summary | Implemented | Tested | Where |
|-----|---------|-------------|--------|-------|
| R-80/80a | `POST /generate-tests` (writer) → run summary; 401/403 | ✅ | ✅ | `functions/generate.ts` · generate.test (AC-80); authorizer/ApiStack tests (AC-80a) |
| R-81 | Reads catalog only, never crawls; empty → success | ✅ | ✅ | `generate.ts` · generate.test (AC-81/E-19) |
| R-82 | Records contentHash + declaredVersion per test | ✅ | ✅ | `testgen/generate.ts` · generate.test (AC-82) — conformance **and** both compat variants now carry `declaredVersion` |
| R-83/83a/83b | Conformance: live API + Ajv; env-guard skip; unmapped→skip; failure **names the offending record** + rule | ✅ | ✅ | `testgen/{derive-schema,emit,generate}.ts` · generate.test (AC-83/83b, record-naming R-83); behaviorally skips (env unset) |
| R-84/84a | Compat: consumer-can-read-publisher over shared prop model | ✅ | ✅ | `testgen/compat.ts` (reuses `core/schema-model.ts`) · generate.test (AC-84) |
| R-85 | Fault-isolating skips w/ reasons (invalid / single-source / unmapped) | ✅ | ✅ | `testgen/generate.ts` · generate.test (AC-85) |
| R-86/87 | Manifest (source of truth) + emitted Vitest TS | ✅ | ✅ | `testgen/{manifest,emit}.ts` · generate.test (AC-86/87, ts.transpile syntax check) |
| R-88 | Deterministic, byte-identical re-run | ✅ | ✅ | `testgen/generate.ts` · generate.test (AC-88) |
| R-89 | Persist artifacts (S3) + generation-run (DDB) | ✅ | ✅ | `repository.ts` genrun methods · repository.genrun.test (AC-89); run record's `catalogContext` now carries per-contract `{contentHash, commitSha, declaredVersion}` (the commit context generated from), asserted in generate.test |
| R-90 | `GET /test-artifacts[/{runId}|/latest]` inline; 404 | ✅ | ✅ | `read.ts` · read.artifacts.test (AC-90) |
| R-91 | `generate-tests` CLI (default/--pull/--local); no commit | ✅ | ✅ | `scripts/generate-tests.ts` · generate-tests.test (AC-91) |
| R-92 | Fixed `generated-tests/` layout; wholesale replace | ✅ | ✅ | `writeArtifactTree` + `testgen` paths · CLI+gen tests (AC-92/E-28) |
| R-93 | Generated tests excluded from unit suites | ✅ | ✅ | `vitest.config.ts` exclude · generated-exclusion.test; behaviorally 92 tests with tree populated (AC-93) |

**NFR-8** (generation determinism + pure offline core) — proven in generate.test (AC-88) and by the pure `@registry/testgen` signature. **Verified end-to-end locally:** a real `--local`-equivalent run over the 9 sibling contracts produced 6 tests (2 conformance, 4 compat) + 8 recorded skips; the emitted conformance tests **skip** with live-env unset and the compat tests **run and pass** (publisher satisfies every consumer-required property → the catalogued divergence does not break consumer-can-read-publisher).

## Requirements Catalog component (spec v0.5.0 · R-100…R-114)

> **✅ Implemented + tested** (2026-07-15; health-check remediations 2026-07-16 → spec **v0.5.4**). Specified spec v0.5.0 (§3.10, D-44…D-48); built tests-first via **T-27…T-31** (design §10). v0.5.1 added the absent-spec wipe (R-105) + requirements-failure isolation (R-105a); **v0.5.2** (fresh-eyes 2nd pass) extended the isolation to the `docs/spec.md` fetch (M2), added BatchWrite `UnprocessedItems` retry (R-107/NFR-4), kept the section-heading number (R-102), and corrected R-114/D-43/R-105 text; **v0.5.3** (fresh-eyes 3rd pass) de-dups a repeated `R-nn` (R-106), tested the present-but-no-section wipe, and dropped "unreadable" from R-105/E-29's wipe branch; **v0.5.4** (fresh-eyes 4th pass) records `crawl.requirements.collision` for a repeated id (D-49/E-38), sorts `GET /requirements` by natural id (R-109), adds BatchWrite backoff, and fixes doc drift (buildManifest, §10.3, CLI instruction, version stamps). Adds **40 tests** (36 offline + 4 web): suite now **138 offline + 18 web = 156**, `typecheck` clean.

| Req | Summary | Impl | Test | Notes |
|-----|---------|------|------|-------|
| R-100/R-101 | Crawl each source's `docs/spec.md` in the same `POST /refresh` | ✅ | ✅ | `github.crawlSourceFull` + `refresh.ts`; github.test + refresh.test (T-29) |
| R-102/R-103/R-104 | Parse id/text/section + EARS type/modality; flag non-conforming | ✅ | ✅ | `packages/core/src/requirements.ts`; requirements.test (T-27) |
| R-105 | Reachable-but-absent spec → **wipe** snapshot to zero; fetch-fail → prior kept (E-36) | ✅ | ✅ | `repository.wipeRequirements`; refresh.test + requirements.repo.test (v0.5.1) |
| R-105a | Requirements parse/store failure isolated → `crawl.requirements.failed`, contracts unaffected (E-37) | ✅ | ✅ | `refresh.ts` inner try/catch; refresh.test isolation case (v0.5.1) |
| R-106/R-107 | Latest-snapshot + `changedInLastCrawl`; wholesale replace, no history | ✅ | ✅ | `repository.putRequirements`; requirements.repo.test (T-28) |
| R-108 | Per-source requirement counts in the crawl-run summary | ✅ | ✅ | `SourceOutcome.requirements`; refresh.test |
| R-109/R-110/R-111/R-112 | `GET /requirements*` reader endpoints + 404/401/403 | ✅ | ✅ | `read.ts` + ApiStack; read.requirements.test + ApiStack.test (T-30) |
| R-113 | SPA Requirements view (third toggle) | ✅ | ✅ | `App.tsx` `RequirementsView` + `lib.groupRequirementsBySection`; lib.test + App.test (T-31) |
| R-114 | DynamoDB item kind + raw `docs/spec.md` in S3 | ✅ | ✅ | `repository.putRequirements` (S3 `requirements/{source}/spec.md`); requirements.repo.test |

## LLM Functional Test Generator component (spec v0.6.0 · R-115…R-126)

> **✅ IMPLEMENTED + DEPLOYED — 2026-07-16.** Specified then built same day (spec v0.6.0, §3.11, D-50…D-56), tests-first through tasks **T-33…T-39**. New pure package `@registry/functest`, the Bedrock `LlmClient` (`@aws-sdk/client-bedrock-runtime` `InvokeModel`, structured output via forced tool use, default `us.anthropic.claude-sonnet-4-6`; **IAM-role auth, no secret** — D-55), repository job/plan-cache methods, the async job + worker, read handlers + routes, and the CLI `--functional` mode. **207 tests green** (189 offline + 18 web), CDK synth clean, **deployed + live-verified** (34 grounded plans synthesised by Sonnet 4.6 on 2026-07-16). Opus 4.8 is a one-env-var upgrade pending its Bedrock access grant; running the emitted tests stays out of scope (D-56).

| Req | Summary | Impl | Test | Notes |
|-----|---------|------|------|-------|
| R-115/R-115a/R-116 | Async `POST /generate-functional-tests` job (202); writer-auth; empty-catalog success | ✅ `functional-gen.ts`, `ApiStack.ts`, `authorizer.ts` | ✅ `functional-gen.test.ts`, `read.functional.test.ts` | T-36/T-37 |
| R-117/R-117a/R-118 | LLM synthesises a schema-validated cross-service plan behind an injectable seam | ✅ `functest/plan.ts,ground.ts,generate.ts`, `functions/llm.ts` | ✅ `functest/generate.test.ts` | T-33/T-34 (D-50/D-51) |
| R-119/R-119a | Input-hash plan cache; deterministic re-render (R-88 scoped out of synthesis) | ✅ `ground.ts` (sha256), `repository.ts` (S3 cache), `emit.ts` | ✅ `functest/generate.test.ts`, `repository.functional.test.ts` | T-33/T-35 (D-52) |
| R-120/R-121 | Skip-with-reason: malformed plan / ungroundable requirement | ✅ `plan.validatePlan`, `ground.ts` | ✅ `functest/generate.test.ts` | T-33 |
| R-122/R-123 | Functional manifest + emitted Vitest; wholesale subtree replace; suite-excluded | ✅ `emit.ts`, `generate-tests.ts` (`writeFunctionalArtifactTree`) | ✅ `functest/generate.test.ts`, `generate-tests.functional.test.ts`, `generated-exclusion.test.ts` | T-33/T-38 |
| R-124/R-125 | Job record (DDB, incl. **catalog context + per-skip reasons**) + artifacts (S3); `GET /functional-test-jobs*` + 404 | ✅ `repository.ts` (`catalogContext`/`skips`), `read.ts` | ✅ `repository.functional.test.ts`, `functional-gen.test.ts`, `read.functional.test.ts` | T-35/T-37 |
| R-126 | CLI `--functional` mode: trigger → poll → write tree, no commit | ✅ `generate-tests.ts` | ✅ `generate-tests.functional.test.ts` | T-38 (D-34) |

## Outstanding

- **T-16 (registry-core real-AWS deploy + e2e smoke)** — not run here: requires AWS credentials and the two secrets. Everything up to deploy is implemented, typechecked, and green offline (unit + mocked-AWS + offline CloudFormation synth). Run `npm run deploy` after setting `GITHUB_TOKEN` and `REGISTRY_DEMO_PASSWORD` to complete NFR-1/NFR-3 verification against live infrastructure.
- **T-26 (test-generator deploy/verify)** — the `POST /generate-tests` endpoint + `GET /test-artifacts` + the default/`--pull` CLI modes need a live deploy to exercise end-to-end; the pure core, `--local` path, determinism, skip behavior, and suite-exclusion are all verified offline. After deploy: run `npm run generate-tests` — `sst bind` resolves the API URL (from the `sst/node/api` binding) and the writer secret from SSM; the operator supplies nothing but AWS credentials (D-35/D-36/R-91a).

## Health-check remediation (2026-07-15, recipe Step 11)

The periodic health check found the prior version of this table over-claimed: five requirements were marked ✅ implemented but were only partially met, and one was missing. All were fixed and are now genuinely implemented + tested:

- **NFR-5 (was MISSING)** — added `packages/functions/src/log.ts`; structured logs now emitted by the crawl (per-source + per-file, with offending path/id), the authorizer (per decision), the seed, and the generator.
- **R-12** — the crawl-run `endedAt` was a copy of `startedAt`; it now captures a real end timestamp.
- **R-62** — the contract-detail view now renders the entry's metadata (entity, name, declared/current version, validation, commit, path, last-crawled), not just the `source/id` heading.
- **R-82 / R-86** — compat manifest entries now carry each variant's `declaredVersion` (previously only the content hash), so compat-test staleness is assessable.
- **R-89** — the generation-run record now stores the exact catalog commit context (per-contract `contentHash`/`commitSha`/`declaredVersion`), not a bare entry count.
- **R-02 / NFR-2** — added a regression guard asserting the crawl's logs and run summary never contain a GitHub-token-shaped string.

Scope correction (D-42): a `vitest.conformance.config.ts` + `npm run test:conformance` runner that **executed** generated tests was removed — running the generated tests remains out of scope (§2, D-29). Doc drift closed: `docs/design.md` §2.1/§2.3/§9.3/§9.6 refreshed to match the code; `docs/spec.md` promoted five previously-undocumented decisions (D-37…D-41).

### Pass 2 (2026-07-15) — deeper re-audit findings, all fixed

A second health-check pass caught issues the first missed, plus two the first remediation itself introduced:

- **R-15 (was ◑ — response contract unmet)** — the `409` for a concurrent `POST /refresh` now includes the **in-flight run id** (`E-11`). `acquireLock` reads the held lock's `runId` on conflict; `LockHeldError` carries it; the AC-15 tests (`refresh.test.ts`, `repository.test.ts`) now assert it.
- **Entity-diff A/B direction (was a latent production bug)** — the `byEntity` GSI returns variants source-ascending (consumer first), so the diff shown in the SPA was mislabeled (consumer-only props under "Only in publisher"). `read.ts` now orders variants **publisher-first** before diffing (A=publisher, B=consumer), matching the SPA labels and D-24; guarded by a new `read.test.ts` case that mocks the real consumer-first order.
- **Credential-non-leak test (was tautological)** — the guard now injects a `ghp_…`-shaped token through a failing-source error and asserts it is **redacted** from both the logs and the run summary; `log.ts` gained a `redact()` boundary applied to the crawl source-failure reason (NFR-2 defense-in-depth).
- **Logging decision (was undocumented)** — the `log.ts` contract (JSON-line, no timestamp, non-scrubbing-by-default, event taxonomy, single redaction boundary) is now **D-43**.
- Doc nits: `design.md` §2.1 GSI SK (`source`, not `SRC#{source}`), §2.3 `physicalType` compared field + publisher-first ordering, §9.6 `--local` uses the writer credential; `spec.md` R-91a prose aligned to D-36 (API URL from the Api binding); `StorageStack.ts` byKind comment now names GENERATION. `LOCK_TTL_SECONDS = 300` gained a rationale comment.

## Health check (2026-07-17, recipe Step 11 — full five-vector HC-1…HC-5)

Ran the recipe's periodic health check properly this time: four parallel fresh-eyes auditors over the whole spec (R-01…R-126) — HC-1 spec↔code, HC-2 spec↔tests, HC-3 design↔reality, HC-4 decisions↔reality — then a synthesis. Verified `tsc` clean and the suite green. **Result: healthy — 0 MISSING, 0 CONTRADICTED requirements; no blockers.** The drift found was minor and all remediated (spec bumped v0.6.0 → **v0.6.1**).

**Pass A — stale bookkeeping (fixed first).** An earlier ad-hoc pass corrected doc front-matter that never updated when v0.6.0 landed:
- Compliance intro (was `v0.5.4` / `156 passing`) → **v0.6.0** and the verified total; deploy status (was "offline; deploy pending" here and in `tasks.md`) → **deployed + live-verified 2026-07-16**; `tasks.md` new-test count "28" → **51** (offline 138→189); model-gate wording clarified (Sonnet 4.6 is the deployed default, Opus 4.8 the pending upgrade).

**Pass B — real (minor) drift the full recipe surfaced, all fixed:**
- **R-124 (was PARTIAL)** — the functional **job record** stored only counts; the catalog context + per-skip **reasons** the spec enumerates lived only in the S3 manifest. Now persisted on the DDB record (`functional-gen.ts` `done`, `repository.ts` `FunctionalJobRecord.catalogContext`/`skips`), mirroring R-89. Guarded by `functional-gen.test.ts`.
- **R-83 (was PARTIAL)** — the emitted conformance assertion surfaced the failing rule but not the **offending record**; `testgen/src/emit.ts` now names `record #i {contents}` + the Ajv rule. Guarded by `testgen/tests/generate.test.ts`.
- **AC-118 / NFR-2 test gap** — nothing asserted the `bedrock:InvokeModel` **IAM grant / no-stored-key**. Added to `stacks/tests/ApiStack.test.ts` (+ functional route-wiring, AC-115 infra half).
- **Test-quality** — `functional-gen.test.ts` "redacted reason" case now actually injects a `ghp_`-shaped token and asserts it is scrubbed; added an **E-47** test (a failed job leaves the committed `generated-tests/functional/` untouched).
- **Design §11.1 doc-lag** — the illustrative TS sketch showed pre-ship shapes; refreshed to the shipped `trigger.method`+`path`, `PlanAssertion.assertion`, and `FunctionalArtifactSet`.
- **Decisions log (HC-4)** — six choices made in code during the Bedrock/functest work had no D-entry; promoted to **D-57…D-62** (worker sizing; `bedrock:InvokeModel` IAM scope incl. the account-wide inference-profile ARN; `max_tokens: 8192`; publisher canonical-variant; entity-match heuristic; Scan-vs-GSI listing).

**Accepted as-is (documented, not changed):** the `Scan`-based list endpoints (R-50/R-109) are correct at target scale — recorded as **D-62** with a revisit trigger rather than adding a GSI; an empty requirements source returning 404 is consistent with R-112 spirit; emitted functional tests are deliberate `it.todo` scaffolds (D-56).

After remediation: **212 tests green** (194 offline + 18 web), `tsc` clean. Spec is the oracle at **v0.6.1**.
