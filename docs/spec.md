# E2E Test Generator for ODCS-Bound Services — Spec

## 1. Purpose and Context

This system automatically generates and maintains end-to-end functional tests for services across the onboarding, get-ready, create, deliver, and scoring/reporting domains, using ODCS data contracts, OpenAPI specs, UI specs, and service source repositories as input. Tests evolve as contracts change, are augmented by user-supplied natural-language scenarios, and produce auditable pass/fail reports linking failures back to logs. The MVP scope is a single cross-domain flow (onboarding → get-ready) with tests that compile, run, and produce a downloadable Excel report.

## 2. Out of Scope

- **Near-neighbor / single-service integration tests.** Owned by service teams.
- **Human-authored test suites.** Will live in a separate repository; not invoked, ingested, or reported on by this system.
- **Third-party vendor integration testing.** Vendor boundaries are open; flow stops at the vendor edge in v1.
- **SLA / latency / performance assertions.** Reserved for a later phase.
- **Production execution.** System runs against staging only in MVP.
- **Real or anonymized PII.** Only synthetic data, ever.
- **Scheduled or deploy-triggered runs.** MVP is on-demand only.
- **Notifications (Slack / PagerDuty / tickets).** Crossed out in the source diagram; explicitly deferred.
- **Editing of generated tests by humans.** Generated tests are immutable to humans.
- **Multi-environment promotion** (pre-prod, prod-shadow).

## 3. Functional Requirements (EARS)

### Contract Registry & Source Introspection

- **R-01** — WHEN a user triggers a generation run, THE system SHALL fetch the latest ODCS contracts for all services in the target flow from the contract registry.
- **R-02** — WHEN generating tests for a service, THE system SHALL fetch the service's OpenAPI specification.
- **R-03** — WHERE a service has a Web interface, THE system SHALL fetch the service's UI specification.
- **R-04** — WHEN generating tests for a service, THE system SHALL introspect the service's source repository.
- **R-05** — THE system SHALL extract the following from each service repository: existing service-team tests (as input seed only), OpenAPI/ODCS files, repository metadata (CODEOWNERS, README, deploy config), source code, requirement documents and markdown, and deployed version information.
- **R-06** — IF a required contract, spec, or repository is unreachable, THEN THE system SHALL abort the run for the affected flow and report the missing source.

### Flow Discovery

- **R-07** — THE system SHALL derive cross-domain service dependency graphs from ODCS data lineage in the Contract Registry.
- **R-08** — THE system SHALL accept explicit, named business-scenario flow definitions in addition to lineage-derived flows.
- **R-09** — WHEN executing a run, THE Orchestrator SHALL traverse services in topological order derived from R-07.
- **R-10** — In MVP, THE system SHALL support the onboarding → get-ready flow end-to-end.

### Test Generation

- **R-11** — WHEN inputs (R-01 through R-05) are gathered, THE Test Generator SHALL produce TypeScript test files.
- **R-12** — THE system SHALL commit generated TypeScript test files to a dedicated, version-controlled repository.
- **R-13** — Every generated test file SHALL carry a machine-readable `// @generated` header identifying it as tool-owned.
- **R-14** — THE system SHALL NOT accept human edits to files marked `// @generated`; on regeneration any local modifications SHALL be overwritten.
- **R-15** — WHEN any ODCS, OpenAPI, or UI specification changes, THE Test Generator SHALL regenerate affected test files on the next run.
- **R-16** — THE Test Generator SHALL produce tests covering happy-path, boundary, and edge cases as hypothesized by the Data Factory.
- **R-17** — Each generated test SHALL include a free-text, LLM-authored description of the business use case it covers.
- **R-18** — IF a generated test file fails to compile, THEN THE system SHALL NOT commit it, SHALL log the compile error, and SHALL surface the failure in the run report.

### User-Supplied Scenarios

- **R-19** — THE system SHALL accept user-supplied scenarios in natural language.
- **R-20** — WHEN a natural-language scenario is submitted, THE Test Generator SHALL use an LLM to translate it into executable test steps and synthetic data requirements.
- **R-21** — IF an LLM-translated scenario is ambiguous, unsupported, or violates an ODCS contract, THEN THE system SHALL reject it with a structured explanation and SHALL NOT commit a test file.

### Data Factory

- **R-22** — THE Data Factory SHALL produce only synthetic data; it SHALL NOT load, copy, or reference real student or production data at any time.
- **R-23** — THE Data Factory SHALL use an LLM to generate realistic synthetic values conforming to ODCS field constraints (type, range, format, quality rules).
- **R-24** — Each run SHALL namespace every synthetic record with a unique run UUID embedded in identifiers.
- **R-25** — IF LLM-generated data violates an ODCS constraint at validation, THEN THE Data Factory SHALL regenerate it up to a bounded retry count and SHALL fail the test with a `data-generation` error if retries are exhausted.

### Orchestrator & Execution

- **R-26** — THE system SHALL allow users to trigger runs on demand via CLI and UI.
- **R-27** — THE system SHALL support concurrent runs initiated by multiple users; per-run UUID namespacing (R-24) SHALL keep run data isolated.
- **R-28** — THE Orchestrator SHALL authenticate to all services using a single IdP and SHALL reuse the resulting token across the flow.
- **R-29** — WHEN a flow hop emits an event consumed by a downstream service, THE Orchestrator SHALL subscribe to the relevant SNS/SQS/EventBridge channel and SHALL resume on event receipt.
- **R-30** — THE Orchestrator SHALL apply a bounded maximum wait per async hop; the bound SHALL be configurable per service.
- **R-31** — At every service hop, THE Orchestrator SHALL validate the inbound and outbound payload against the corresponding ODCS contract.
- **R-32** — WHERE a service exposes a Web UI relevant to the scenario, THE Orchestrator SHALL drive the hop via a UI-automation client.
- **R-33** — WHERE a service exposes only an API, THE Orchestrator SHALL drive the hop via an HTTP client.

### Failure Classification

- **R-34** — THE system SHALL classify every failure as one of: `contract-violation`, `business-rule-violation`, or `infrastructure-failure`.
- **R-35** — IF a payload at a hop violates the ODCS schema (type, required field, format), THEN THE system SHALL record the failure as `contract-violation`.
- **R-36** — IF a payload satisfies the schema but violates an ODCS quality rule or value constraint, THEN THE system SHALL record the failure as `business-rule-violation`.
- **R-37** — IF a service is unreachable, returns 5xx, or an expected async event does not arrive within the bounded wait (R-30), THEN THE system SHALL record the failure as `infrastructure-failure` and SHALL NOT cascade it as a test bug to downstream hops.

### Reporting & Telemetry

- **R-38** — THE system SHALL propagate a correlation ID through every hop of a test run.
- **R-39** — Every test result record SHALL include: run UUID, run start date/time, run end date/time, scenario name, use-case description (R-17), pass/fail, failure classification (R-34) when failed, and the deployed release/version label for each service that participated.
- **R-40** — IF a test fails, THEN THE result record SHALL include a link to the relevant log or stack trace, scoped by correlation ID.
- **R-41** — THE system SHALL persist all run results in a queryable results store.
- **R-42** — WHEN a user requests an export from the UI, THE system SHALL generate an Excel (and CSV) file containing the columns in R-39 plus failure-link columns from R-40, and SHALL deliver it as a download.
- **R-43** — WHILE a run is in progress, THE UI SHALL display the per-hop progress and any in-flight validations.

### Data Lifecycle

- **R-44** — Individual runs SHALL NOT clean up the synthetic data they produce.
- **R-45** — THE system SHALL execute a cross-domain wipe job on a configurable cadence; the default cadence SHALL be weekly.
- **R-46** — WHEN the wipe job runs, IT SHALL remove every record created by the system across all participating domains such that no residual artifact remains.
- **R-47** — IF the wipe job fails for any domain, THEN THE system SHALL halt subsequent test runs, raise a visible failure state in the UI, and require operator acknowledgement before resuming.
- **R-48** — WHILE the wipe job is running, new test-run triggers SHALL be queued and SHALL begin only after the wipe completes successfully.

## 4. Non-Functional Requirements

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
- **NFR-15** — The wipe-job cadence (R-45) SHALL be operator-configurable without code changes.

## 5. Edge Cases

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
| E-09 | Wipe job partially succeeds (some domains clean, others not) | Halt new runs per R-47; report which domains are dirty; require operator ack. |
| E-10 | User triggers a run during a wipe | Queue per R-48; UI shows expected start time. |
| E-11 | Generated test file compiles but throws at runtime due to an environment misconfiguration | Classify as `infrastructure-failure` (R-37), not a bug in the test or the service. |
| E-12 | Service repo contains no OpenAPI/ODCS files | Abort generation for that service per R-06; report names the missing artifact. |
| E-13 | UI spec exists but UI is unreachable during run | Hop fails as `infrastructure-failure`; downstream hops skipped (E-06 pattern). |
| E-14 | Contract changes between scenario submission and run start | Use the contract version current at run start; report records the version used. |
| E-15 | IdP token expires mid-run | Orchestrator refreshes via the single IdP (R-28); if refresh fails, classify remaining hops as `infrastructure-failure`. |

## 6. Open Questions

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
- **OQ-10 — Wipe-job mechanism per domain.** Does every participating service expose a delete/purge endpoint scoped by run-UUID tag? If not, what is the fallback for R-46?
- **OQ-11 — Idempotency expectations within a wipe period.** If the same scenario is re-run within a week, do we expect identical results? What if state from prior runs influences the system under test?
- **OQ-12 — Operator-acknowledgement mechanism for R-47.** UI button? CLI command? Who is the authorized operator?
- **OQ-13 — Versioning of the test-generator itself.** When the generator changes, must we record which generator version produced each test, alongside contract version?
- **OQ-14 — Quarantine / flaky-test handling.** Out of MVP, but worth deciding before users start trusting the suite.
- **OQ-15 — UI scope for MVP.** R-26, R-42, R-43, and R-47 all imply a UI. Is the MVP UI a thin internal tool, or does it have its own design pass?
