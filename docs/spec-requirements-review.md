# Requirements Review — EARS Compliance Pass

This document is a drop-in replacement for **Section 4 (Functional Requirements)** of `spec.md`,
plus a new **Section 4a (Test Conditions)**. Existing IDs are preserved. New failure-case
requirements use letter suffixes (e.g., `R-06a`). Vague terms that still need a product/tech
decision are flagged inline with **⚠ resolve:** so they can be tightened before implementation.

## Review notes (patterns found across the spec)

1. **Mixed actors.** Some requirements name "THE system", others "THE Orchestrator" / "THE Test
   Generator" / "THE Data Factory". This is fine *if intentional* — but several requirements that
   clearly belong to a named component currently say "THE system" (R-12, R-15, R-22, R-26, R-34,
   R-38, R-41, R-42, R-43, R-49). Rewrites below name the responsible component.
2. **Vague modifiers.** `latest`, `affected`, `relevant`, `realistic`, `appropriate`, `adequate`,
   `support`, `introspect`, `in MVP` appear without operational definitions. Flagged inline.
3. **Compound requirements.** Several requirements pack 2–3 SHALLs into one line (R-14, R-18, R-21,
   R-22, R-25, R-27, R-28, R-29, R-42). Split where the responses are independently testable.
4. **Failure-classification inconsistency.** R-34 enumerates exactly three categories, but R-25
   introduces a fourth (`data-generation`) and R-18 implies a fifth (compile/`test-bug`). Either
   widen R-34 or fold these into the existing three. Below I widen R-34 and add `test-bug` and
   `data-generation` as explicit categories.
5. **Scope statements masquerading as requirements.** R-10 ("In MVP, …support…") is a scope
   statement, not a behavioral requirement. Moved to Section 2 (MVP Scope) — kept here as a
   stub for traceability.
6. **Missing failure paths.** 18 of the 44 requirements have no paired IF/THEN failure clause.
   New `R-XXa` entries below add them.
7. **Numbering gap.** Original spec jumps from R-43 to R-49. Preserved as-is; R-44–R-48 left
   reserved.

---

## 4. Functional Requirements (EARS)

### Contract Registry & Source Introspection

- **R-01** — WHEN a user triggers a generation run, THE Contract Registry Client SHALL fetch the
  latest released ODCS contract for every service in the target flow.
  ⚠ resolve: define "latest released" (registry tag? semver? deployment-pinned?).
  - **Tests:**
    - T-01.1 Trigger a run for flow F containing services {A, B}; verify Contract Registry is
      called exactly once per service.
    - T-01.2 Registry returns versions v1 and v2 for service A; verify the version satisfying the
      resolved definition of "latest released" is selected.
    - T-01.3 A service outside the target flow is *not* fetched.

- **R-02** — WHEN the Test Generator begins generation for a service, THE Test Generator SHALL
  fetch that service's OpenAPI specification from its source repository.
  - **Tests:**
    - T-02.1 Generator started for service A → OpenAPI fetch invoked against service A's repo.
    - T-02.2 OpenAPI fetched is the version on the commit pinned by R-05 (deployed-version
      metadata), not `HEAD`.

- **R-03** — WHERE a service is registered as exposing a Web UI, THE Test Generator SHALL fetch
  that service's UI specification.
  ⚠ resolve: where is "exposes Web UI" declared (contract registry flag? manifest?).
  - **Tests:**
    - T-03.1 Service flagged UI-bearing → UI-spec fetch invoked.
    - T-03.2 Service not flagged UI-bearing → UI-spec fetch *not* invoked.

- **R-04** — WHEN the Test Generator begins generation for a service, THE Test Generator SHALL
  clone or update a working copy of that service's source repository at the deployed commit.
  (Replaces the vague "introspect".)
  - **Tests:**
    - T-04.1 Working copy exists and is on the commit recorded in R-05.

- **R-05** — THE Test Generator SHALL extract the following artifacts from each service
  repository's deployed-version commit:
    (a) existing service-team tests, marked as seed-only;
    (b) OpenAPI files;
    (c) ODCS files;
    (d) repository metadata (CODEOWNERS, README, deploy config);
    (e) source code;
    (f) requirement documents (`*.md` under `docs/`, `spec/`, or `requirements/`).
  ⚠ resolve: previously this requirement also listed "deployed version information" as a repo
  artifact, but deployed version is provided by the deployment system, not the repo. Moved to
  R-05a.
  - **Tests:**
    - T-05.a–f For each artifact class, verify the extractor surfaces the expected file set on a
      fixture repo.
    - T-05.g Service-team tests are tagged `seed-only` and are not executed verbatim.

- **R-05a** — WHEN a generation run starts, THE Test Generator SHALL retrieve the deployed
  release/version label for each participating service from the deployment system.
  ⚠ resolve: per OQ-04, canonical source TBD (Argo, Spinnaker, GH Releases, internal registry).
  - **Tests:**
    - T-05a.1 Deployed version label retrieved for every service in the flow before any hop
      executes.
    - T-05a.2 Label appears verbatim in R-39 result records.

- **R-06** — IF a required contract, OpenAPI spec, UI spec, or service repository is unreachable
  at run start, THEN THE Orchestrator SHALL abort the run and SHALL emit a run-report entry
  identifying the missing artifact and the affected service.
  ⚠ resolve: define "required" — UI spec is only required for UI-bearing services (R-03).
  - **Tests:**
    - T-06.1 Registry returns 404 for a required contract → run aborts with named artifact.
    - T-06.2 Repo unreachable → run aborts with named artifact.
    - T-06.3 UI spec absent for non-UI service → run continues.

### Flow Discovery

- **R-07** — WHEN a generation run starts, THE Flow Discovery component SHALL build a service
  dependency graph from ODCS data lineage in the Contract Registry.
  (Promoted from ubiquitous to event-driven so the trigger is explicit.)
  - **Tests:**
    - T-07.1 Given lineage A → B → C, the resulting graph has edges {(A,B), (B,C)}.
    - T-07.2 Re-running with the same lineage yields the same graph.

- **R-07a** — IF the lineage graph contains a cycle, THEN THE Flow Discovery component SHALL
  abort the run and SHALL report the cycle in the run report.
  (New — fills R-07 failure gap.)
  - **Tests:**
    - T-07a.1 Inject lineage A → B → A → run aborts; report names the cycle.

- **R-08** — THE Flow Discovery component SHALL accept explicit, named business-scenario flow
  definitions, in addition to lineage-derived flows.
  ⚠ resolve: define ingestion path (file in repo? API? dashboard form?).
  - **Tests:**
    - T-08.1 Submit a named flow definition → it appears in the registered-flows list.
    - T-08.2 A named flow may include the same service that lineage-derived flows include without
      collision.

- **R-08a** — IF a submitted business-scenario flow definition references a service not present
  in the Contract Registry, THEN THE Flow Discovery component SHALL reject the definition with a
  structured error and SHALL NOT register it.
  (New — fills R-08 failure gap.)
  - **Tests:**
    - T-08a.1 Submit a flow referencing unknown service Z → rejected with explanation.

- **R-09** — WHEN executing a run, THE Orchestrator SHALL traverse services in a topological
  order derived from the graph produced in R-07.
  ⚠ resolve: when multiple topological orders exist, pick one deterministically (e.g., stable
  sort by service name) — call this out so test fixtures are reproducible.
  - **Tests:**
    - T-09.1 Given graph A → B → C → run visits A, then B, then C.
    - T-09.2 Given graph with two valid orders, the same input yields the same visit order across
      runs (determinism).

- **R-10** — *(Moved to Section 2 — MVP Scope.)* The onboarding → get-ready flow is the sole
  MVP-supported flow. Kept here as a numbering anchor for traceability.

### Test Generation

- **R-11** — WHEN inputs R-01 through R-05 have been gathered for the target flow, THE Test
  Generator SHALL produce at least one TypeScript test file per service hop and per registered
  scenario for that flow.
  ⚠ resolve: previously did not specify granularity ("produce TypeScript test files" was open-
  ended). Confirm "per service hop × per scenario" is the intent.
  - **Tests:**
    - T-11.1 Flow with N hops and M scenarios → ≥ N × M test files produced.
    - T-11.2 No test files are produced before all R-01–R-05 inputs are present.

- **R-11a** — IF the Test Generator fails to produce a test file for a (hop, scenario) pair
  (LLM error, malformed input, etc.), THEN THE Test Generator SHALL emit a run-report entry
  identifying the failed pair and SHALL NOT block generation of the remaining pairs.
  (New — fills R-11 failure gap.)
  - **Tests:**
    - T-11a.1 Force LLM failure on one pair → other pairs still generated; report names the
      failed pair.

- **R-12** — WHEN the Test Generator produces a test file that compiles (per R-18), THE Test
  Generator SHALL commit the file to the dedicated generated-tests repository.
  ⚠ resolve: per OQ-07, repo layout (one repo vs per-domain) and commit mode (PR vs direct
  push) TBD.
  - **Tests:**
    - T-12.1 Successful generation → commit appears in the target repo with the file at the
      expected path.
    - T-12.2 Compile failure (per R-18) → no commit.

- **R-12a** — IF a commit to the generated-tests repository fails (auth, network, permission),
  THEN THE Test Generator SHALL retry up to a bounded count and SHALL emit an
  `infrastructure-failure` run-report entry on exhaustion.
  (New — fills R-12 failure gap.)
  - **Tests:**
    - T-12a.1 Simulate repo 503 → retry occurs; on exhaustion, report shows
      `infrastructure-failure`.

- **R-13** — WHEN the Test Generator emits a test file, THE Test Generator SHALL prepend a
  machine-readable `// @generated` header that includes: generator version, generation timestamp,
  source-contract version, and scenario ID.
  ⚠ resolve: previously only required the header marker; widened to carry traceability fields.
  Confirm field list.
  - **Tests:**
    - T-13.1 Every generated file's first non-empty line is the `// @generated` header.
    - T-13.2 Header contains all four traceability fields.

- **R-14** — WHEN a commit or pull request targets a file whose first non-empty line contains
  `// @generated`, THE generated-tests repository SHALL reject the change.
  (Split from old R-14; this is the human-edit-prevention clause.)
  - **Tests:**
    - T-14.1 PR modifying a generated file → blocked by branch protection / pre-receive hook.
    - T-14.2 Direct push modifying a generated file → blocked.

- **R-14a** — WHEN regeneration occurs, THE Test Generator SHALL overwrite any prior content of
  the `// @generated` file with the freshly generated content.
  (Second clause of old R-14, now its own requirement.)
  - **Tests:**
    - T-14a.1 Hand-edit a generated file via repo admin override → next regeneration restores it.

- **R-15** — WHEN any ODCS, OpenAPI, or UI specification version referenced by a generated test
  changes between runs, THE Test Generator SHALL regenerate that specific test file on the next
  run and SHALL NOT regenerate unaffected files.
  ⚠ resolve: previously said "affected test files" without defining affectedness. Above ties
  affectedness to *referenced spec version*.
  - **Tests:**
    - T-15.1 Bump ODCS version referenced by test T → next run regenerates T only.
    - T-15.2 No spec changes → no regeneration occurs.

- **R-16** — THE Test Generator SHALL emit, for each (hop, scenario) pair, at minimum: one
  happy-path test, one boundary test per bounded numeric/string field in the participating ODCS
  contracts, and one negative test per ODCS quality rule.
  ⚠ resolve: previously this was "covering happy-path, boundary, and edge cases as hypothesized
  by the Data Factory" — too vague to gate. Above gives a concrete minimum.
  - **Tests:**
    - T-16.1 Contract with 3 bounded fields → at least 3 boundary tests emitted.
    - T-16.2 Contract with 2 quality rules → at least 2 negative tests emitted.
    - T-16.3 Every (hop, scenario) pair includes one happy-path test.

- **R-17** — WHEN the Test Generator emits a test file, THE Test Generator SHALL include in its
  header a non-empty, LLM-authored description of the business use case the test covers.
  - **Tests:**
    - T-17.1 Description is present and non-empty for every generated test.
    - T-17.2 Description is included verbatim in the result record (R-39).

- **R-18** — IF a generated test file fails to compile under the configured TypeScript compiler
  options, THEN THE Test Generator SHALL NOT commit it, SHALL log the compile error tagged with
  the file path and (hop, scenario) pair, AND SHALL classify the failure as `test-bug` in the
  run report.
  ⚠ resolve: previously classification was implicit; tied to widened R-34 below.
  - **Tests:**
    - T-18.1 Inject a deliberate type error → no commit, log captured, report shows `test-bug`.

### User-Supplied Scenarios

- **R-19** — WHEN a user submits a natural-language scenario via CLI or dashboard, THE Scenario
  Intake component SHALL accept the submission for translation.
  (Promoted to event-driven; interface made explicit.)
  - **Tests:**
    - T-19.1 Submit via CLI → submission acknowledged with a scenario ID.
    - T-19.2 Submit via dashboard → submission acknowledged with a scenario ID.

- **R-19a** — IF the submitted scenario is empty or exceeds a bounded character limit, THEN THE
  Scenario Intake component SHALL reject the submission with a structured error.
  ⚠ resolve: set bounded character limit.
  (New — fills R-19 failure gap.)
  - **Tests:**
    - T-19a.1 Empty body → rejected.
    - T-19a.2 Body over limit → rejected.

- **R-20** — WHEN a natural-language scenario is accepted, THE Test Generator SHALL invoke the
  configured LLM to translate it into a structured artifact containing executable test steps and
  synthetic data requirements conforming to the participating ODCS contracts.
  - **Tests:**
    - T-20.1 Submitted scenario produces a translation object with non-empty `steps` and
      `data_requirements` fields.
    - T-20.2 Each `data_requirements` entry references a field declared in a participating ODCS
      contract.

- **R-21** — IF an LLM-translated scenario is ambiguous, references entities not in any
  participating contract, or specifies data that would violate an ODCS contract, THEN THE Test
  Generator SHALL reject it with a structured explanation naming the offending fragment and
  SHALL NOT commit a test file for that scenario.
  ⚠ resolve: define "ambiguous" — probably means LLM low-confidence flag or self-reported
  uncertainty. Make the detection rule explicit.
  - **Tests:**
    - T-21.1 Submit scenario referencing nonexistent endpoint → rejected; explanation names it.
    - T-21.2 Submit scenario whose data would violate a contract constraint → rejected.
    - T-21.3 Rejected scenarios produce no commit in the generated-tests repo.

### Data Factory

- **R-22** — THE Data Factory SHALL produce synthetic data only.
- **R-22a** — THE Data Factory SHALL NOT read, copy, or reference any data source containing real
  student or production data.
  (Split from old compound R-22.)
  - **Tests:**
    - T-22.1 Audit data-source allowlist; production sources are absent.
    - T-22.2 Static scan of generated data for known real-PII patterns returns zero hits on a
      fixture corpus.

- **R-23** — WHEN the Data Factory generates a value for an ODCS field, THE Data Factory SHALL
  invoke the configured LLM with the field's type, range, format, and quality rules and SHALL
  validate the returned value against those constraints before emitting it.
  ⚠ resolve: previously said "realistic synthetic values" — "realistic" is undefined. Above
  ties the output to the contract constraints, which are objective.
  - **Tests:**
    - T-23.1 Field with `type=integer, range=[0,100]` → generated value satisfies both.
    - T-23.2 Field with `format=email` → generated value matches RFC 5322.
    - T-23.3 Field with a quality rule → generated value satisfies it.

- **R-24** — WHEN the Data Factory emits a synthetic record, THE Data Factory SHALL embed the
  run's UUID in every identifier field of that record, in a documented format.
  ⚠ resolve: define embedding format (prefix? suffix? sub-field?).
  - **Tests:**
    - T-24.1 Generated record's identifier matches the documented format and contains the
      current run UUID.
    - T-24.2 Two concurrent runs produce records with disjoint identifier sets.

- **R-25** — IF a value produced by the Data Factory fails ODCS validation, THEN THE Data Factory
  SHALL re-invoke the LLM up to N retries (configurable, default 3) and SHALL fail the affected
  test with classification `data-generation` if validation still fails after the Nth retry.
  ⚠ resolve: confirm default retry count (3 used as placeholder).
  - **Tests:**
    - T-25.1 Force one transient invalidation → succeeds on retry 1; test runs.
    - T-25.2 Force persistent invalidation → fails after N retries with `data-generation`.

### Orchestrator & Execution

- **R-26** — WHEN a user issues a run command via CLI or dashboard, THE Orchestrator SHALL
  initiate a new run and SHALL return a run UUID synchronously.
  (Promoted to event-driven; return contract made explicit.)
  - **Tests:**
    - T-26.1 CLI invocation returns a run UUID.
    - T-26.2 Dashboard invocation returns a run UUID.

- **R-27** — THE Orchestrator SHALL support at least N concurrent runs (see NFR-09) such that
  records produced by one run never appear in another run's assertions.
  (Tightened: "isolated" is operationalized as "never appear in another run's assertions".)
  - **Tests:**
    - T-27.1 Launch 10 concurrent runs of the same scenario → each run's assertions reference
      only that run's records.

- **R-28** — WHEN a run starts, THE Orchestrator SHALL exchange credentials with the configured
  IdP exactly once and SHALL reuse the resulting token across all hops in that run.
  - **Tests:**
    - T-28.1 IdP exchange happens once per run.
    - T-28.2 All hops use the same bearer token (verified via header capture).

- **R-28a** — IF the IdP token expires mid-run, THEN THE Orchestrator SHALL refresh it once
  before the next hop; if refresh fails, THE Orchestrator SHALL classify remaining hops as
  `infrastructure-failure`.
  (Promotes E-14 to a numbered requirement.)
  - **Tests:**
    - T-28a.1 Force token expiry between hops → refresh occurs; run continues.
    - T-28a.2 Force refresh failure → remaining hops marked `infrastructure-failure`.

- **R-29** — WHEN a flow hop emits an event consumed by a downstream service, THE Orchestrator
  SHALL subscribe to the SNS/SQS/EventBridge channel declared in that hop's contract before
  publishing the trigger payload.
  ⚠ resolve: confirm "declared in that hop's contract" — i.e., channel name lives in the ODCS
  contract; if not, name the source-of-truth.
  - **Tests:**
    - T-29.1 Subscription is in place before publish; otherwise events may be lost.
    - T-29.2 Subscription is torn down at run end.

- **R-29a** — IF subscription to the declared channel fails, THEN THE Orchestrator SHALL classify
  the hop as `infrastructure-failure` and SHALL skip downstream hops per R-37.
  (New — fills R-29 failure gap.)
  - **Tests:**
    - T-29a.1 Mock SNS subscribe failure → hop classified `infrastructure-failure`.

- **R-30** — THE Orchestrator SHALL apply a per-service maximum-wait timeout to each async hop.
- **R-30a** — THE per-service maximum-wait timeout SHALL be configurable per service via a
  documented configuration source.
  ⚠ resolve: name the config source (Parameter Store? service manifest?). Also set a default.
  - **Tests:**
    - T-30.1 Configure timeout T → hop waits at most T before triggering R-37.
    - T-30a.1 Per-service override is honored over the global default.

- **R-31** — WHEN the Orchestrator sends a request to a service hop, THE Orchestrator SHALL
  validate the outbound payload against the corresponding ODCS contract; WHEN the Orchestrator
  receives a response, THE Orchestrator SHALL validate the inbound payload against the
  corresponding ODCS contract.
  (Split the directions for clarity; same intent.)
  - **Tests:**
    - T-31.1 Outbound payload missing a required field → validation fails per R-35 before send.
    - T-31.2 Inbound payload missing a required field → validation fails per R-35 after receive.

- **R-32** — WHERE a service is registered as exposing a Web UI relevant to the scenario, THE
  Orchestrator SHALL drive that hop via the configured UI-automation client.
  ⚠ resolve: per OQ-08, UI-automation tool TBD (Playwright vs Cypress).
  - **Tests:**
    - T-32.1 UI-bearing hop in flow → UI driver invoked; HTTP client not invoked for that hop.

- **R-33** — WHERE a service exposes only an API, THE Orchestrator SHALL drive that hop via an
  HTTP client.
  - **Tests:**
    - T-33.1 API-only hop → HTTP client invoked; UI driver not invoked.

### Failure Classification

- **R-34** — WHEN a test produces a failure, THE Failure Classifier SHALL assign exactly one of:
  `contract-violation`, `business-rule-violation`, `infrastructure-failure`, `data-generation`,
  or `test-bug`.
  ⚠ resolve: this widens R-34 from three to five categories so R-18 and R-25 fit. Confirm the
  taxonomy.
  - **Tests:**
    - T-34.1 For each category, a fixture failure is classified into that category and no
      other.
    - T-34.2 No failure is left unclassified.

- **R-35** — IF a payload at a hop violates the ODCS schema (type, required field, format),
  THEN THE Failure Classifier SHALL record the failure as `contract-violation`.
  - **Tests:**
    - T-35.1 Missing required field → `contract-violation`.
    - T-35.2 Wrong type → `contract-violation`.
    - T-35.3 Format violation (e.g., bad ISO-8601) → `contract-violation`.

- **R-36** — IF a payload satisfies the ODCS schema but violates an ODCS quality rule or value
  constraint, THEN THE Failure Classifier SHALL record the failure as `business-rule-violation`.
  - **Tests:**
    - T-36.1 Schema-valid payload with out-of-range value → `business-rule-violation`.
    - T-36.2 Schema-valid payload violating cross-field quality rule → `business-rule-violation`.

- **R-37** — IF a service is unreachable, returns 5xx, or an expected async event does not
  arrive within the bound set by R-30, THEN THE Failure Classifier SHALL record the failure as
  `infrastructure-failure` AND THE Orchestrator SHALL mark downstream hops as
  `skipped: upstream-infra-failure` rather than failed.
  - **Tests:**
    - T-37.1 Service returns 503 → `infrastructure-failure`; downstream hops `skipped`.
    - T-37.2 Async event never arrives → `infrastructure-failure`; downstream hops `skipped`.
    - T-37.3 Skipped hops do not contribute to failure counts in the run report.

### Reporting & Telemetry

- **R-38** — WHEN a run starts, THE Orchestrator SHALL allocate a correlation ID; WHEN the
  Orchestrator initiates any hop, THE Orchestrator SHALL propagate that correlation ID via the
  configured trace header.
  ⚠ resolve: name the trace header (`traceparent`? `x-correlation-id`?).
  - **Tests:**
    - T-38.1 Every hop's outbound request carries the correlation ID header.
    - T-38.2 Service logs at every hop contain the correlation ID.

- **R-39** — WHEN a run completes, THE Results Store SHALL persist a result record containing:
  run UUID, run start timestamp (ISO-8601 UTC), run end timestamp (ISO-8601 UTC), scenario name,
  use-case description (R-17), pass/fail, failure classification (R-34) when failed, and the
  deployed release/version label (R-05a) for each participating service.
  - **Tests:**
    - T-39.1 Every field is present in every completed-run record.
    - T-39.2 Timestamps are ISO-8601 UTC.
    - T-39.3 Version label matches the value retrieved by R-05a.

- **R-40** — IF a test fails, THEN THE result record SHALL include a deep-link URL to the log or
  stack trace, scoped by correlation ID and resolved via the per-service template (NFR-14).
  - **Tests:**
    - T-40.1 Failed test record contains a link.
    - T-40.2 Link resolves to logs filtered to the run's correlation ID.

- **R-41** — THE Results Store SHALL persist all run results and SHALL support queries by run
  UUID, scenario name, failure classification, and date range.
  ⚠ resolve: per OQ-09, technology TBD; the *query surface* above is the contract.
  - **Tests:**
    - T-41.1 Persisted record retrievable by run UUID.
    - T-41.2 Records retrievable by scenario name.
    - T-41.3 Records retrievable by failure classification.
    - T-41.4 Records retrievable by date range.

- **R-41a** — IF persistence to the Results Store fails, THEN THE Orchestrator SHALL retry up to
  a bounded count and SHALL emit a critical alert on exhaustion.
  (New — fills R-41 failure gap.)
  - **Tests:**
    - T-41a.1 Force store unavailability → retry occurs; on exhaustion, alert is emitted.

- **R-42** — WHEN a user requests an export from the dashboard, THE Dashboard SHALL generate a
  file in the user-selected format (Excel `.xlsx` or CSV) containing the R-39 columns plus the
  R-40 failure-link column, and SHALL deliver it as a download.
  (Was compound; "Excel (and CSV)" ambiguous — now user-selected.)
  - **Tests:**
    - T-42.1 Export as `.xlsx` → downloaded file opens and contains the expected columns.
    - T-42.2 Export as CSV → downloaded file parses and contains the expected columns.
    - T-42.3 Failed-test rows include a populated failure-link cell.

- **R-42a** — IF export generation exceeds a bounded timeout (default 30s, per NFR-07), THEN
  THE Dashboard SHALL cancel the export and SHALL surface a structured error to the user.
  (New — fills R-42 failure gap.)
  - **Tests:**
    - T-42a.1 Force generation slowness → export cancelled at timeout; user sees error.

- **R-43** — WHILE a run is in progress, THE Dashboard SHALL display per-hop progress (queued /
  in-flight / complete / skipped / failed) and any in-flight ODCS validations.
  - **Tests:**
    - T-43.1 During a run, each hop's state transition is reflected on the dashboard within a
      bounded refresh interval.
    - T-43.2 In-flight validations are visible while running.

- **R-49** — WHEN a run completes, THE Dashboard SHALL render its results showing pass/fail per
  scenario, failure classification (R-34), use-case description (R-17), participating service
  versions (R-05a / R-39), and failure links (R-40).
  - **Tests:**
    - T-49.1 Completed run appears on the dashboard within a bounded refresh interval.
    - T-49.2 All five fields render for every result row.

---

## 4a. Test Conditions — Summary Index

Every `T-XX.Y` above is a candidate test case. Suggested grouping for the generated suite:

| Group | IDs | Notes |
|-------|-----|-------|
| Source ingestion | T-01.* through T-06.* | Mock Contract Registry, repo, deployment system. |
| Flow discovery | T-07.*, T-07a.*, T-08.*, T-08a.*, T-09.* | Pure-function tests over lineage fixtures. |
| Test generation | T-11.* through T-18.* | Snapshot/golden tests over generator output. |
| Scenario intake | T-19.* through T-21.* | LLM mocked with canned good/bad translations. |
| Data factory | T-22.* through T-25.* | Property-based tests against contract fixtures. |
| Orchestration | T-26.* through T-33.* | Integration tests with stub services. |
| Failure classification | T-34.* through T-37.* | Table-driven; one row per (input, expected category). |
| Reporting | T-38.* through T-49.* | End-to-end against a known scenario; assert record + dashboard. |

---

## Cross-reference: requirements with no failure case before this pass

R-07, R-08, R-11, R-12, R-13, R-15, R-17, R-19, R-22, R-26, R-28 (token expiry),
R-29, R-31 (validator unavailability), R-34, R-38, R-39, R-41, R-42, R-43.

Failure cases added above: R-07a, R-08a, R-11a, R-12a, R-19a, R-28a, R-29a, R-41a, R-42a.
Remaining gaps deliberately *not* added (judgment calls — confirm before adding):

- **R-13** (header missing): treat as a generator bug; would be caught by T-13.1 and surfaced as
  `test-bug`. Probably does not need its own runtime requirement.
- **R-15** (regeneration fails): subsumed by R-11a once regeneration is just "generation on the
  next run".
- **R-17** (empty description): subsumed by R-11a (a missing description is a generation failure
  for that pair).
- **R-22** (PII leak detection): worth a dedicated security control rather than a behavioral
  requirement — propose adding to NFRs as **NFR-15**: "THE Data Factory SHALL fail-closed if a
  static-pattern PII scan flags any generated value."
- **R-26** (concurrent run cap exceeded): NFR-09 sets the cap; add a soft-fail behavior only if
  exceeding it is realistic in MVP.
- **R-31** (ODCS validator itself unavailable): treat as R-06 (required artifact unreachable).
- **R-34** (unclassifiable failure): the widened taxonomy plus the `SHALL assign exactly one`
  clause prevents this — but add a guardrail test (T-34.2 above).
- **R-38** (correlation ID missing): same kind as R-13 — generator/orchestrator bug, not a
  runtime branch.
- **R-39, R-43, R-49** (missing field / dashboard offline): captured by R-41a (persistence) and
  general dashboard availability monitoring; not a behavioral requirement of the test system.
