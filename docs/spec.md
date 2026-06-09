# E2E Test Generator for ODCS-Bound Services — Spec

## 1. Purpose and Context

This system automatically generates and maintains end-to-end functional tests for multiple cross-domain flows spanning the onboarding, get-ready, create, deliver, and scoring/reporting domains, using ODCS data contracts, OpenAPI specs, UI specs, and service source repositories as input. Tests evolve as contracts change, are augmented by user-supplied natural-language scenarios, and produce auditable pass/fail results rendered on a dashboard, with on-demand Excel download from the dashboard and links from failures back to logs.

## 2. MVP Scope

The first release proves the pipeline end-to-end on a narrow slice before expanding coverage. The "Out of Scope" section that follows covers items permanently excluded from the system; the "Deferred to later phases" list here covers items that are out of MVP but expected in later releases.

**In for MVP:**

- A single cross-domain flow: onboarding → get-ready (R-10).
- Lineage-derived flow discovery for that pair only (R-07, R-09).
- One named, explicit business-scenario flow as the golden-path scenario (R-08).
- Generation of TypeScript test files that compile and run (R-11 through R-18).
- LLM-translated user scenarios for that flow (R-19 through R-21).
- LLM-assisted synthetic data conforming to the participating contracts (R-22 through R-25).
- On-demand triggering via CLI and dashboard (R-26).
- Concurrent runs with per-run UUID namespacing (R-24, R-27).
- ODCS payload validation at every hop (R-31).
- Event-driven async handling for the flow's async boundaries (R-29, R-30).
- Failure classification across the three categories (R-34 through R-37).
- Dashboard displaying run results and Excel/CSV export from the dashboard (R-39 through R-43, R-49).
- Each test run operates on a newly generated, uniquely namespaced data set (R-24). No automated cleanup in MVP; data accumulates in non-prod and is accepted as a known limitation until the wipe feature ships.

**Deferred to later phases:**

- Additional cross-domain flows beyond onboarding → get-ready.
- Scheduled or deploy-triggered runs.
- SLA / latency / performance assertions.
- Vendor integration coverage.
- Integration with the human-authored test suite (lives in a separate repo).
- Notifications (Slack, PagerDuty, tickets).
- Multi-environment promotion (pre-prod, prod-shadow).
- Automated cross-domain wipe job (with per-namespace failure isolation, dashboard visibility, and owner alerts) — captured in a separate future spec.

## 3. Out of Scope

- **Near-neighbor / single-service integration tests.** Owned by service teams.
- **Production execution.** System runs against non-production environments only.
- **Real or anonymized PII.** Only synthetic data, ever.
- **Editing of generated tests by humans.** Generated tests are immutable to humans; human-authored tests live in a separate repository.

## 4. Functional Requirements (EARS)

> EARS-compliance pass applied. New failure-case requirements use letter suffixes (e.g., `R-06a`).
> Vague terms still awaiting a product/tech decision are flagged inline with **⚠ resolve:**.
> R-44–R-48 remain reserved (numbering gap preserved from original spec).

### Contract Registry & Source Introspection

- **R-01** — WHEN a user triggers a generation run, THE Contract Registry Client SHALL fetch the latest released ODCS contract for every service in the target flow.
  - ⚠ resolve: define "latest released" (registry tag? semver? deployment-pinned?).
- **R-02** — WHEN the Test Generator begins generation for a service, THE Test Generator SHALL fetch that service's OpenAPI specification from its source repository at the deployed-version commit.
- **R-03** — WHERE a service is registered as exposing a Web UI, THE Test Generator SHALL fetch that service's UI specification.
  - ⚠ resolve: where is "exposes Web UI" declared (contract registry flag? manifest?).
- **R-04** — WHEN the Test Generator begins generation for a service, THE Test Generator SHALL clone or update a working copy of that service's source repository at the deployed-version commit.
- **R-05** — THE Test Generator SHALL extract the following artifacts from each service repository's deployed-version commit: (a) existing service-team tests, marked seed-only; (b) OpenAPI files; (c) ODCS files; (d) repository metadata (CODEOWNERS, README, deploy config); (e) source code; (f) requirement documents (`*.md` under `docs/`, `spec/`, or `requirements/`).
- **R-05a** — WHEN a generation run starts, THE Test Generator SHALL retrieve the deployed release/version label for each participating service from the deployment system.
  - ⚠ resolve: per OQ-04, canonical source TBD (Argo, Spinnaker, GH Releases, internal registry).
- **R-06** — IF a required contract, OpenAPI spec, UI spec, or service repository is unreachable at run start, THEN THE Orchestrator SHALL abort the run and SHALL emit a run-report entry identifying the missing artifact and the affected service.
  - ⚠ resolve: define "required" — UI spec is only required for UI-bearing services (R-03).

### Flow Discovery

- **R-07** — WHEN a generation run starts, THE Flow Discovery component SHALL build a service dependency graph from ODCS data lineage in the Contract Registry.
- **R-07a** — IF the lineage graph contains a cycle, THEN THE Flow Discovery component SHALL abort the run and SHALL report the cycle in the run report.
- **R-08** — THE Flow Discovery component SHALL accept explicit, named business-scenario flow definitions, in addition to lineage-derived flows.
  - ⚠ resolve: define ingestion path (file in repo? API? dashboard form?).
- **R-08a** — IF a submitted business-scenario flow definition references a service not present in the Contract Registry, THEN THE Flow Discovery component SHALL reject the definition with a structured error and SHALL NOT register it.
- **R-09** — WHEN executing a run, THE Orchestrator SHALL traverse services in a topological order derived from the graph produced in R-07. When multiple valid orders exist, the Orchestrator SHALL pick one deterministically (stable sort by service name).
- **R-10** — *(Moved to §2 MVP Scope.)* The onboarding → get-ready flow is the sole MVP-supported flow. Stub retained here for traceability.

### Test Generation

- **R-11** — WHEN inputs R-01 through R-05 have been gathered for the target flow, THE Test Generator SHALL produce at least one TypeScript test file per service hop and per registered scenario for that flow.
- **R-11a** — IF the Test Generator fails to produce a test file for a (hop, scenario) pair (LLM error, malformed input, etc.), THEN THE Test Generator SHALL emit a run-report entry identifying the failed pair and SHALL NOT block generation of the remaining pairs.
- **R-12** — WHEN the Test Generator produces a test file that compiles (per R-18), THE Test Generator SHALL commit the file to the dedicated generated-tests repository.
  - ⚠ resolve: per OQ-07, repo layout (one repo vs per-domain) and commit mode (PR vs direct push) TBD.
- **R-12a** — IF a commit to the generated-tests repository fails (auth, network, permission), THEN THE Test Generator SHALL retry up to a bounded count and SHALL emit an `infrastructure-failure` run-report entry on exhaustion.
- **R-13** — WHEN the Test Generator emits a test file, THE Test Generator SHALL prepend a machine-readable `// @generated` header that includes: generator version, generation timestamp, source-contract version, and scenario ID.
- **R-14** — WHEN a commit or pull request targets a file whose first non-empty line contains `// @generated`, THE generated-tests repository SHALL reject the change.
- **R-14a** — WHEN regeneration occurs, THE Test Generator SHALL overwrite any prior content of the `// @generated` file with the freshly generated content.
- **R-15** — WHEN any ODCS, OpenAPI, or UI specification version referenced by a generated test changes between runs, THE Test Generator SHALL regenerate that specific test file on the next run and SHALL NOT regenerate unaffected files.
- **R-16** — THE Test Generator SHALL emit, for each (hop, scenario) pair, at minimum: one happy-path test, one boundary test per bounded numeric/string field in the participating ODCS contracts, and one negative test per ODCS quality rule.
- **R-17** — WHEN the Test Generator emits a test file, THE Test Generator SHALL include in its header a non-empty, LLM-authored description of the business use case the test covers.
- **R-18** — IF a generated test file fails to compile under the configured TypeScript compiler options, THEN THE Test Generator SHALL NOT commit it, SHALL log the compile error tagged with the file path and (hop, scenario) pair, AND SHALL classify the failure as `test-bug` in the run report.

### User-Supplied Scenarios

- **R-19** — WHEN a user submits a natural-language scenario via CLI or dashboard, THE Scenario Intake component SHALL accept the submission for translation and SHALL return a scenario ID.
- **R-19a** — IF the submitted scenario is empty or exceeds a bounded character limit, THEN THE Scenario Intake component SHALL reject the submission with a structured error.
  - ⚠ resolve: set bounded character limit.
- **R-20** — WHEN a natural-language scenario is accepted, THE Test Generator SHALL invoke the configured LLM to translate it into a structured artifact containing executable test steps and synthetic data requirements conforming to the participating ODCS contracts.
- **R-21** — IF an LLM-translated scenario is ambiguous, references entities not in any participating contract, or specifies data that would violate an ODCS contract, THEN THE Test Generator SHALL reject it with a structured explanation naming the offending fragment and SHALL NOT commit a test file for that scenario.
  - ⚠ resolve: define "ambiguous" — likely LLM low-confidence flag or self-reported uncertainty. Make the detection rule explicit.

### Data Factory

- **R-22** — THE Data Factory SHALL produce synthetic data only.
- **R-22a** — THE Data Factory SHALL NOT read, copy, or reference any data source containing real student or production data.
- **R-23** — WHEN the Data Factory generates a value for an ODCS field, THE Data Factory SHALL invoke the configured LLM with the field's type, range, format, and quality rules and SHALL validate the returned value against those constraints before emitting it.
- **R-24** — WHEN the Data Factory emits a synthetic record, THE Data Factory SHALL embed the run's UUID in every identifier field of that record, in a documented format.
  - ⚠ resolve: define embedding format (prefix? suffix? sub-field?).
- **R-25** — IF a value produced by the Data Factory fails ODCS validation, THEN THE Data Factory SHALL re-invoke the LLM up to N retries (configurable, default 3) and SHALL fail the affected test with classification `data-generation` if validation still fails after the Nth retry.

### Orchestrator & Execution

- **R-26** — WHEN a user issues a run command via CLI or dashboard, THE Orchestrator SHALL initiate a new run and SHALL return a run UUID synchronously.
- **R-27** — THE Orchestrator SHALL support at least N concurrent runs (see NFR-09) such that records produced by one run never appear in another run's assertions.
- **R-28** — WHEN a run starts, THE Orchestrator SHALL exchange credentials with the configured IdP exactly once and SHALL reuse the resulting token across all hops in that run.
- **R-28a** — IF the IdP token expires mid-run, THEN THE Orchestrator SHALL refresh it once before the next hop; if refresh fails, THE Orchestrator SHALL classify remaining hops as `infrastructure-failure`.
- **R-29** — WHEN a flow hop emits an event consumed by a downstream service, THE Orchestrator SHALL subscribe to the SNS/SQS/EventBridge channel declared in that hop's contract before publishing the trigger payload.
  - ⚠ resolve: confirm "declared in that hop's contract" — i.e., channel name lives in the ODCS contract; if not, name the source-of-truth.
- **R-29a** — IF subscription to the declared channel fails, THEN THE Orchestrator SHALL classify the hop as `infrastructure-failure` and SHALL skip downstream hops per R-37.
- **R-30** — THE Orchestrator SHALL apply a per-service maximum-wait timeout to each async hop.
- **R-30a** — THE per-service maximum-wait timeout SHALL be configurable per service via a documented configuration source.
  - ⚠ resolve: name the config source (Parameter Store? service manifest?). Also set a default.
- **R-31** — WHEN the Orchestrator sends a request to a service hop, THE Orchestrator SHALL validate the outbound payload against the corresponding ODCS contract; WHEN the Orchestrator receives a response, THE Orchestrator SHALL validate the inbound payload against the corresponding ODCS contract.
- **R-32** — WHERE a service is registered as exposing a Web UI relevant to the scenario, THE Orchestrator SHALL drive that hop via the configured UI-automation client.
  - ⚠ resolve: per OQ-08, UI-automation tool TBD (Playwright vs Cypress).
- **R-33** — WHERE a service exposes only an API, THE Orchestrator SHALL drive that hop via an HTTP client.

### Failure Classification

- **R-34** — WHEN a test produces a failure, THE Failure Classifier SHALL assign exactly one of: `contract-violation`, `business-rule-violation`, `infrastructure-failure`, `data-generation`, or `test-bug`.
  - ⚠ resolve: this widens the taxonomy from three to five categories so R-18 and R-25 fit consistently. Confirm.
- **R-35** — IF a payload at a hop violates the ODCS schema (type, required field, format), THEN THE Failure Classifier SHALL record the failure as `contract-violation`.
- **R-36** — IF a payload satisfies the ODCS schema but violates an ODCS quality rule or value constraint, THEN THE Failure Classifier SHALL record the failure as `business-rule-violation`.
- **R-37** — IF a service is unreachable, returns 5xx, or an expected async event does not arrive within the bound set by R-30, THEN THE Failure Classifier SHALL record the failure as `infrastructure-failure` AND THE Orchestrator SHALL mark downstream hops as `skipped: upstream-infra-failure` rather than failed.

### Reporting & Telemetry

- **R-38** — WHEN a run starts, THE Orchestrator SHALL allocate a correlation ID; WHEN the Orchestrator initiates any hop, THE Orchestrator SHALL propagate that correlation ID via the configured trace header.
  - ⚠ resolve: name the trace header (`traceparent`? `x-correlation-id`?).
- **R-39** — WHEN a run completes, THE Results Store SHALL persist a result record containing: run UUID, run start timestamp (ISO-8601 UTC), run end timestamp (ISO-8601 UTC), scenario name, use-case description (R-17), pass/fail, failure classification (R-34) when failed, and the deployed release/version label (R-05a) for each participating service.
- **R-40** — IF a test fails, THEN THE result record SHALL include a deep-link URL to the log or stack trace, scoped by correlation ID and resolved via the per-service template (NFR-14).
- **R-41** — THE Results Store SHALL persist all run results and SHALL support queries by run UUID, scenario name, failure classification, and date range.
  - ⚠ resolve: per OQ-09, technology TBD; the *query surface* above is the contract.
- **R-41a** — IF persistence to the Results Store fails, THEN THE Orchestrator SHALL retry up to a bounded count and SHALL emit a critical alert on exhaustion.
- **R-42** — WHEN a user requests an export from the dashboard, THE Dashboard SHALL generate a file in the user-selected format (Excel `.xlsx` or CSV) containing the R-39 columns plus the R-40 failure-link column, and SHALL deliver it as a download.
- **R-42a** — IF export generation exceeds a bounded timeout (default 30s, per NFR-07), THEN THE Dashboard SHALL cancel the export and SHALL surface a structured error to the user.
- **R-43** — WHILE a run is in progress, THE Dashboard SHALL display per-hop progress (queued / in-flight / complete / skipped / failed) and any in-flight ODCS validations.
- **R-49** — WHEN a run completes, THE Dashboard SHALL render its results showing pass/fail per scenario, failure classification (R-34), use-case description (R-17), participating service versions (R-05a / R-39), and failure links (R-40).

## 4a. Test Conditions

Test cases implied by each requirement. These become the seed test list for the generated suite and for the generator's own self-tests.

### Source ingestion (R-01 – R-06)

- **T-01.1** Trigger a run for flow F containing services {A, B}; verify Contract Registry is called exactly once per service.
- **T-01.2** Registry returns versions v1 and v2 for service A; verify the version satisfying the resolved definition of "latest released" is selected.
- **T-01.3** A service outside the target flow is *not* fetched.
- **T-02.1** Generator started for service A → OpenAPI fetch invoked against service A's repo.
- **T-02.2** OpenAPI fetched is the version on the deployed-version commit, not `HEAD`.
- **T-03.1** Service flagged UI-bearing → UI-spec fetch invoked.
- **T-03.2** Service not flagged UI-bearing → UI-spec fetch *not* invoked.
- **T-04.1** Working copy exists and is on the deployed-version commit recorded in R-05a.
- **T-05.a–f** For each artifact class, verify the extractor surfaces the expected file set on a fixture repo.
- **T-05.g** Service-team tests are tagged `seed-only` and are not executed verbatim.
- **T-05a.1** Deployed version label retrieved for every service in the flow before any hop executes.
- **T-05a.2** Label appears verbatim in R-39 result records.
- **T-06.1** Registry returns 404 for a required contract → run aborts; report names the artifact.
- **T-06.2** Repo unreachable → run aborts; report names the artifact.
- **T-06.3** UI spec absent for non-UI service → run continues.

### Flow discovery (R-07 – R-10)

- **T-07.1** Given lineage A → B → C, the resulting graph has edges {(A,B), (B,C)}.
- **T-07.2** Re-running with the same lineage yields the same graph.
- **T-07a.1** Inject lineage A → B → A → run aborts; report names the cycle.
- **T-08.1** Submit a named flow definition → it appears in the registered-flows list.
- **T-08.2** A named flow may share services with lineage-derived flows without collision.
- **T-08a.1** Submit a flow referencing unknown service Z → rejected with explanation.
- **T-09.1** Given graph A → B → C → execution order is A, B, C.
- **T-09.2** Two valid topological orders → same input yields the same visit order across runs (determinism).

### Test generation (R-11 – R-18)

- **T-11.1** Flow with N hops and M scenarios → ≥ N × M test files produced.
- **T-11.2** No test files are produced before all R-01–R-05 inputs are present.
- **T-11a.1** Force LLM failure on one (hop, scenario) pair → other pairs still generated; report names the failed pair.
- **T-12.1** Successful generation → commit appears in the target repo at the expected path.
- **T-12.2** Compile failure (per R-18) → no commit.
- **T-12a.1** Simulate repo 503 → retry occurs; on exhaustion, report shows `infrastructure-failure`.
- **T-13.1** Every generated file's first non-empty line is the `// @generated` header.
- **T-13.2** Header contains all four traceability fields (generator version, generation timestamp, source-contract version, scenario ID).
- **T-14.1** PR modifying a generated file → blocked by branch protection / pre-receive hook.
- **T-14.2** Direct push modifying a generated file → blocked.
- **T-14a.1** Hand-edit a generated file via repo admin override → next regeneration restores it.
- **T-15.1** Bump ODCS version referenced by test T → next run regenerates T only.
- **T-15.2** No spec changes → no regeneration occurs.
- **T-16.1** Contract with 3 bounded fields → at least 3 boundary tests emitted.
- **T-16.2** Contract with 2 quality rules → at least 2 negative tests emitted.
- **T-16.3** Every (hop, scenario) pair includes one happy-path test.
- **T-17.1** Description present and non-empty for every generated test.
- **T-17.2** Description appears verbatim in the result record (R-39).
- **T-18.1** Inject a deliberate type error → no commit, log captured, report shows `test-bug`.

### User-supplied scenarios (R-19 – R-21)

- **T-19.1** Submit via CLI → submission acknowledged with a scenario ID.
- **T-19.2** Submit via dashboard → submission acknowledged with a scenario ID.
- **T-19a.1** Empty body → rejected.
- **T-19a.2** Body over limit → rejected.
- **T-20.1** Submitted scenario produces a translation object with non-empty `steps` and `data_requirements`.
- **T-20.2** Each `data_requirements` entry references a field declared in a participating ODCS contract.
- **T-21.1** Submit scenario referencing a nonexistent endpoint → rejected; explanation names it.
- **T-21.2** Submit scenario whose data would violate a contract constraint → rejected.
- **T-21.3** Rejected scenarios produce no commit in the generated-tests repo.

### Data factory (R-22 – R-25)

- **T-22.1** Audit the data-source allowlist; production sources are absent.
- **T-22.2** Static scan of generated data for known real-PII patterns returns zero hits on a fixture corpus.
- **T-23.1** Field with `type=integer, range=[0,100]` → generated value satisfies both.
- **T-23.2** Field with `format=email` → generated value matches RFC 5322.
- **T-23.3** Field with a quality rule → generated value satisfies it.
- **T-24.1** Generated record's identifier matches the documented format and contains the current run UUID.
- **T-24.2** Two concurrent runs produce records with disjoint identifier sets.
- **T-25.1** Force one transient invalidation → succeeds on retry 1; test runs.
- **T-25.2** Force persistent invalidation → fails after N retries with `data-generation`.

### Orchestration (R-26 – R-33)

- **T-26.1** CLI invocation returns a run UUID.
- **T-26.2** Dashboard invocation returns a run UUID.
- **T-27.1** Launch 10 concurrent runs of the same scenario → each run's assertions reference only that run's records.
- **T-28.1** IdP exchange happens once per run.
- **T-28.2** All hops use the same bearer token (verified via header capture).
- **T-28a.1** Force token expiry between hops → refresh occurs; run continues.
- **T-28a.2** Force refresh failure → remaining hops marked `infrastructure-failure`.
- **T-29.1** Subscription is in place before publish; otherwise events may be lost.
- **T-29.2** Subscription is torn down at run end.
- **T-29a.1** Mock SNS subscribe failure → hop classified `infrastructure-failure`.
- **T-30.1** Configure timeout T → hop waits at most T before triggering R-37.
- **T-30a.1** Per-service override is honored over the global default.
- **T-31.1** Outbound payload missing a required field → validation fails per R-35 before send.
- **T-31.2** Inbound payload missing a required field → validation fails per R-35 after receive.
- **T-32.1** UI-bearing hop in flow → UI driver invoked; HTTP client not invoked for that hop.
- **T-33.1** API-only hop → HTTP client invoked; UI driver not invoked.

### Failure classification (R-34 – R-37)

- **T-34.1** For each category, a fixture failure is classified into that category and no other.
- **T-34.2** No failure is left unclassified.
- **T-35.1** Missing required field → `contract-violation`.
- **T-35.2** Wrong type → `contract-violation`.
- **T-35.3** Format violation (e.g., bad ISO-8601) → `contract-violation`.
- **T-36.1** Schema-valid payload with out-of-range value → `business-rule-violation`.
- **T-36.2** Schema-valid payload violating cross-field quality rule → `business-rule-violation`.
- **T-37.1** Service returns 503 → `infrastructure-failure`; downstream hops `skipped`.
- **T-37.2** Async event never arrives → `infrastructure-failure`; downstream hops `skipped`.
- **T-37.3** Skipped hops do not contribute to failure counts in the run report.

### Reporting & telemetry (R-38 – R-49)

- **T-38.1** Every hop's outbound request carries the correlation ID header.
- **T-38.2** Service logs at every hop contain the correlation ID.
- **T-39.1** Every field listed in R-39 is present in every completed-run record.
- **T-39.2** Timestamps are ISO-8601 UTC.
- **T-39.3** Version label matches the value retrieved by R-05a.
- **T-40.1** Failed test record contains a link.
- **T-40.2** Link resolves to logs filtered to the run's correlation ID.
- **T-41.1** Persisted record retrievable by run UUID.
- **T-41.2** Records retrievable by scenario name.
- **T-41.3** Records retrievable by failure classification.
- **T-41.4** Records retrievable by date range.
- **T-41a.1** Force store unavailability → retry occurs; on exhaustion, alert is emitted.
- **T-42.1** Export as `.xlsx` → downloaded file opens and contains the expected columns.
- **T-42.2** Export as CSV → downloaded file parses and contains the expected columns.
- **T-42.3** Failed-test rows include a populated failure-link cell.
- **T-42a.1** Force generation slowness → export cancelled at timeout; user sees error.
- **T-43.1** During a run, each hop's state transition is reflected on the dashboard within a bounded refresh interval.
- **T-43.2** In-flight validations are visible while running.
- **T-49.1** Completed run appears on the dashboard within a bounded refresh interval.
- **T-49.2** All five required fields render for every result row.

## 5. Non-Functional Requirements

### Security
- **NFR-01** — No real PII, PHI, or production data SHALL exist in any staging environment touched by this system. (FERPA-aligned default.)
- **NFR-02** — All secrets (IdP credentials, repo tokens, LLM keys) SHALL be retrieved from a managed secrets store; no secrets in code, config, or logs.
- **NFR-03** — LLM calls used for data and scenario generation SHALL run on infrastructure that does not retain prompts or completions outside the configured AWS account boundary.
- **NFR-04** — The system SHALL operate under least-privilege IAM, scoped to staging accounts and resources only.
- **NFR-05** — Generated test code SHALL NOT contain hard-coded credentials, tokens, or environment-specific URLs.

### Performance
- **NFR-06** — Natural-language scenario translation (R-20) SHOULD return generated test artifacts within 60 seconds for a single scenario in the MVP scope.
- **NFR-07** — Excel export (R-42) SHOULD complete within 30 seconds for runs containing up to 10,000 result rows.
- **NFR-08** — Per-hop ODCS validation (R-31) SHOULD add no more than 100ms of overhead per hop.

### Scale (MVP targets)
- **NFR-09** — The system SHALL support at least 10 concurrent runs without cross-contamination of data or reports.
- **NFR-10** — The system SHALL support flows of at least 10 services in topological order.
- **NFR-11** — The results store SHALL retain at least 90 days of run history at MVP scale.

### Observability
- **NFR-12** — Every run SHALL emit structured logs tagged with run UUID, scenario name, and correlation ID.
- **NFR-13** — The system SHALL expose run-level metrics (count, duration, pass rate, failure-class breakdown) suitable for downstream dashboarding.

### Maintainability
- **NFR-14** — The mapping from observability backend to failure-link URL (R-40) SHALL be configurable per service, not hard-coded.

## 6. Edge Cases

| # | Condition | Expected Behaviour |
|---|-----------|--------------------|
| E-01 | ODCS contract adds a new optional field | Regenerate affected tests on next run; previous run results remain valid; report annotates which contract version was used. |
| E-02 | ODCS contract removes a required field (breaking change) | Regenerate tests; old assertions referencing the removed field are dropped; report flags the breaking change in run header. |
| E-03 | A service is deployed mid-run | Run completes against the version captured at run start (R-39); report records the captured version, not the new one. |
| E-04 | LLM returns a scenario translation that references a service or endpoint that does not exist | Reject per R-21 with a structured explanation; no test file committed. |
| E-05 | LLM-generated synthetic data violates an ODCS constraint | Retry per R-25; on exhaustion, fail with `data-generation` error and surface in report. |
| E-06 | Expected async event never arrives within configured wait | Mark hop as `infrastructure-failure` per R-37; downstream hops are skipped and recorded as `skipped: upstream-infra-failure`, not failed. |
| E-07 | Two concurrent runs generate overlapping synthetic IDs by collision | Cannot occur — every record is tagged with a unique run UUID per R-24; collision is structurally prevented. |
| E-08 | Service-team unit test in a repo (read as seed per R-05) contains realistic-looking but synthetic data | Treat as seed only; never replay verbatim against staging; LLM uses it as a pattern hint for new synthetic data. |
| E-09 | Residual data from a prior run is encountered by a later run (no MVP wipe) | Per-run UUID namespacing (R-24) keeps the new run's data isolated; residual data is ignored by assertions. Accumulation is a known MVP limitation. |
| E-10 | Generated test file compiles but throws at runtime due to an environment misconfiguration | Classify as `infrastructure-failure` (R-37), not a bug in the test or the service. |
| E-11 | Service repo contains no OpenAPI/ODCS files | Abort generation for that service per R-06; report names the missing artifact. |
| E-12 | UI spec exists but UI is unreachable during run | Hop fails as `infrastructure-failure`; downstream hops skipped (E-06 pattern). |
| E-13 | Contract changes between scenario submission and run start | Use the contract version current at run start; report records the version used. |
| E-14 | IdP token expires mid-run | Orchestrator refreshes via the single IdP (R-28); if refresh fails, classify remaining hops as `infrastructure-failure`. |

## 7. Open Questions

These need decisions before implementation begins.

- **OQ-01 — Vendor integration strategy.** Out of scope for MVP, but a placeholder is needed: do tests stop at the vendor boundary and mark downstream hops as `skipped`, or do they fail? (Diagram and prior answers leave this unresolved.)
- **OQ-02 — LLM provider and model selection.** Bedrock vs external Anthropic API; specific model; cost ceiling per scenario; prompt-caching strategy.
- **OQ-03 — Observability backend.** What system holds the logs/traces that R-40 links into (CloudWatch + X-Ray, Datadog, Splunk, mixed)? Required to make the failure-link template (NFR-14) concrete.
- **OQ-04 — Source of "deployed release/version labels" (R-39).** Which deployment system or registry is canonical (Argo, Spinnaker, GitHub Releases, internal)?
- **OQ-05 — Coverage definition.** What counts as "adequate" contract coverage for a generated suite? Required to decide when generation is "done" for a contract.
- **OQ-06 — Where the system itself runs in AWS.** Step Functions + Lambda + Fargate? CodeBuild? Long-running ECS service? Deferred to technical design but blocks cost and ops planning.
- **OQ-07 — Generated-tests repository governance.** One repo for all generated tests vs one per domain; PR-based commits vs direct push; CODEOWNERS for the generated repo.
- **OQ-08 — UI-automation tool choice** (Playwright, Cypress, other) — needed before R-32 can be implemented.
- **OQ-09 — Results store technology.** DynamoDB, RDS, S3+Athena — affects R-41, R-42, and NFR-11.
- **OQ-10 — Idempotency expectations across runs.** Since MVP has no cleanup, residual data from prior runs persists in non-prod. Per-run namespacing (R-24) isolates new data, but if a SUT's behavior depends on accumulated state (counts, aggregates, search indexes), re-running the same scenario may not produce identical results. What guarantees, if any, do we make?
- **OQ-11 — Versioning of the test-generator itself.** When the generator changes, must we record which generator version produced each test, alongside contract version?
- **OQ-12 — Quarantine / flaky-test handling.** Out of MVP, but worth deciding before users start trusting the suite.
- **OQ-13 — Dashboard scope for MVP.** R-26, R-42, R-43, and R-49 all imply a dashboard. Is the MVP dashboard a thin internal tool, or does it get its own design pass?
