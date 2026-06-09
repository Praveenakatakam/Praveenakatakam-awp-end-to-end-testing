# Test Case Skeletons — GIVEN / WHEN / THEN

One skeleton per requirement in `spec.md`. Each becomes one or more concrete tests at
implementation time. Requirements that **cannot** be expressed as G/W/T are flagged at the top of
this file and inline.

## Requirements flagged for rewrite before implementation

These cannot be expressed as a single, testable G/W/T as currently worded:

- **R-05** — Compound enumeration (six artifact classes in one requirement). The G/W/T below
  collapses them into one assertion, but each class has its own failure mode (e.g., what if
  CODEOWNERS is absent? what if `docs/` doesn't exist?). **Recommend splitting** into R-05.a
  through R-05.f before generating concrete tests.
- **R-10** — Stub pointer to §2 MVP Scope, not a behavioral requirement. **Do not generate
  tests** — kept only for traceability.
- **R-22 / R-22a** — Pure invariants ("synthetic data only", "no production data references")
  with no detection mechanism named. Testable only if we add a concrete check (allowlist audit
  + PII-pattern scan). **Recommend pairing with proposed NFR-15** (fail-closed PII scan) so the
  THEN clause has something observable to assert on.
- **NFR-01** — Same shape as R-22. Policy-level statement; needs an audit mechanism to be
  G/W/T-able.
- **NFR-03** — "LLM calls run on infrastructure that does not retain prompts/completions" is
  an attribute of the deployment, not a runtime behavior. **Re-express as an architectural
  acceptance gate** (e.g., "deployment SHALL use Bedrock with model invocation logging
  disabled") so it can be checked at deploy time, not runtime.

All other requirements have skeletons below.

---

## Functional Requirements

### Contract Registry & Source Introspection

**R-01** — Latest ODCS contract per service in target flow

```
GIVEN  a target flow F containing services {A, B, C} registered in the Contract Registry
WHEN   a user triggers a generation run for F
THEN   the Contract Registry Client fetches the latest released ODCS contract for A, B, and C
       exactly once each
AND    no contract is fetched for services outside F
```

**R-02** — OpenAPI fetched at deployed-version commit

```
GIVEN  service A with deployed-version commit SHA `abc123` and an OpenAPI spec at that commit
WHEN   the Test Generator begins generation for service A
THEN   the OpenAPI spec is fetched from A's repository at commit `abc123`
AND    not from `HEAD`
```

**R-03** — UI spec fetched only for UI-bearing services

```
GIVEN  service A registered with `exposes_ui = true` and service B with `exposes_ui = false`
WHEN   the Test Generator begins generation for flow {A, B}
THEN   a UI-spec fetch is invoked for A
AND    no UI-spec fetch is invoked for B
```

**R-04** — Working copy at deployed-version commit

```
GIVEN  service A with deployed-version commit SHA `abc123`
WHEN   the Test Generator begins generation for service A
THEN   a working copy of A's repository exists at commit `abc123`
```

**R-05** — Six-artifact extraction (⚠ flagged for split)

```
GIVEN  service A's repository at its deployed-version commit, containing all six artifact
       classes (seed tests, OpenAPI, ODCS, repo metadata, source, requirement docs)
WHEN   the Test Generator runs extraction on service A
THEN   the extraction manifest contains one entry per artifact class (a)–(f)
AND    service-team tests in the manifest are tagged `seed-only`
```

**R-05a** — Deployed version label retrieved before any hop

```
GIVEN  a flow F with services {A, B}, and the deployment system reporting versions
       vA=1.4.2 and vB=2.0.1
WHEN   a generation run for F starts
THEN   the Test Generator retrieves "1.4.2" for A and "2.0.1" for B before any hop executes
AND    those labels appear verbatim in the result record (R-39)
```

**R-06** — Abort on unreachable required artifact

```
GIVEN  a generation run for flow F where service A's required ODCS contract returns 404
WHEN   the run starts
THEN   the Orchestrator aborts the run
AND    emits a run-report entry naming "ODCS contract for service A" as the missing artifact
```

### Flow Discovery

**R-07** — Dependency graph from ODCS lineage

```
GIVEN  ODCS lineage A → B → C registered in the Contract Registry
WHEN   a generation run starts for the flow rooted at A
THEN   the Flow Discovery component produces a graph with edges {(A,B), (B,C)}
```

**R-07a** — Abort on cycle

```
GIVEN  ODCS lineage that contains a cycle A → B → A
WHEN   a generation run starts
THEN   the Flow Discovery component aborts the run
AND    the run report names the cycle (A → B → A)
```

**R-08** — Accept named business-scenario flow definitions

```
GIVEN  a named business-scenario flow definition "happy-path-onboarding"
WHEN   the definition is submitted via the registered ingestion path
THEN   "happy-path-onboarding" appears in the registered-flows list
AND    can be selected for a run
```

**R-08a** — Reject flow referencing unknown service

```
GIVEN  a business-scenario flow definition referencing service Z not in the Contract Registry
WHEN   the definition is submitted
THEN   the Flow Discovery component rejects it with a structured error naming Z
AND    does not register the flow
```

**R-09** — Deterministic topological traversal

```
GIVEN  a service graph A → B → C → D with valid topological order [A, B, C, D]
WHEN   the Orchestrator executes a run on the graph
THEN   it visits services in the order A, B, C, D
AND    for graphs with multiple valid orders, the same input produces the same visit order
       across runs
```

**R-10** — *(stub — no test, see flag above)*

### Test Generation

**R-11** — Produce ≥ N×M test files

```
GIVEN  a flow F with N hops, M registered scenarios, and all R-01–R-05 inputs gathered
WHEN   the Test Generator runs for F
THEN   it produces at least one TypeScript test file per (hop, scenario) pair
       (≥ N × M files total)
```

**R-11a** — One failed pair doesn't block others

```
GIVEN  a flow with (hop, scenario) pairs {p1, p2, p3} and an LLM that fails for p2
WHEN   the Test Generator runs
THEN   it produces tests for p1 and p3
AND    emits a run-report entry naming p2 as the failed pair
```

**R-12** — Commit on compile success

```
GIVEN  a generated test file that compiles per R-18
WHEN   the Test Generator finishes generation
THEN   the file is committed to the generated-tests repository at the expected path
AND    a compile-failed file from the same run is NOT committed
```

**R-12a** — Commit retry then infra-fail

```
GIVEN  the generated-tests repository returns 503 for commit operations
WHEN   the Test Generator attempts to commit a file
THEN   it retries up to the configured bound
AND    on exhaustion emits an `infrastructure-failure` run-report entry
```

**R-13** — `@generated` header with traceability fields

```
GIVEN  the Test Generator emits a test file
WHEN   the file is inspected
THEN   its first non-empty line is `// @generated`
AND    that header contains generator version, generation timestamp, source-contract version,
       and scenario ID
```

**R-14** — Repo rejects edits to `@generated` files

```
GIVEN  a generated-tests repository where file `foo.test.ts` has `// @generated` as its first
       non-empty line
WHEN   a commit or PR modifies `foo.test.ts`
THEN   the repository rejects the change (branch protection / pre-receive hook)
```

**R-14a** — Regeneration overwrites local edits

```
GIVEN  a generated file `foo.test.ts` that has been hand-edited via admin override
WHEN   regeneration runs
THEN   the freshly generated content overwrites the hand edits entirely
```

**R-15** — Regenerate only files referencing changed specs

```
GIVEN  generated test T1 referencing ODCS v1.2, and test T2 referencing ODCS v1.3
WHEN   ODCS v1.2 is bumped to v1.4 between runs
THEN   the next run regenerates T1
AND    does not regenerate T2
```

**R-16** — Minimum coverage per (hop, scenario)

```
GIVEN  an ODCS contract with 3 bounded numeric fields and 2 quality rules
WHEN   the Test Generator runs for a (hop, scenario) pair using that contract
THEN   it emits ≥ 1 happy-path test, 3 boundary tests, and 2 negative tests for that pair
```

**R-17** — Non-empty use-case description in header

```
GIVEN  the Test Generator emits a test file
WHEN   the file is inspected
THEN   its `// @generated` header contains a non-empty business-use-case description
AND    that description appears verbatim in the result record (R-39)
```

**R-18** — Compile failure → no commit, log, classify `test-bug`

```
GIVEN  a generated test file that fails to compile under the configured tsconfig
WHEN   the Test Generator attempts to commit
THEN   no commit occurs
AND    the compile error is logged tagged with file path and (hop, scenario)
AND    the run report records the failure as `test-bug`
```

### User-Supplied Scenarios

**R-19** — Accept scenario via CLI or dashboard

```
GIVEN  a user with valid credentials
WHEN   the user submits a natural-language scenario via CLI (or dashboard)
THEN   the Scenario Intake component accepts the submission
AND    returns a scenario ID
```

**R-19a** — Reject empty or oversized scenario

```
GIVEN  the configured scenario character limit L
WHEN   a user submits a scenario with length 0 or > L
THEN   the Scenario Intake component rejects the submission with a structured error
```

**R-20** — LLM produces valid translation artifact

```
GIVEN  an accepted natural-language scenario S and participating ODCS contracts C
WHEN   the Test Generator invokes the configured LLM with S and C
THEN   a structured translation is produced with non-empty `steps` and `data_requirements`
AND    each `data_requirements` entry references a field declared in C
```

**R-21** — Reject ambiguous / contract-violating translation

```
GIVEN  an LLM-translated scenario that references endpoint `/unknown` not in any ODCS contract
WHEN   the Test Generator validates the translation
THEN   the scenario is rejected with a structured explanation naming `/unknown`
AND    no test file is committed
```

### Data Factory

**R-22 / R-22a** — *(⚠ flagged — invariants need a detection criterion)*

Provisional skeleton, pending a defined audit mechanism:

```
GIVEN  the Data Factory's configured data-source allowlist
WHEN   the Data Factory runs any generation
THEN   it sources values only from allowlisted synthetic generators
AND    a PII-pattern scan on the output corpus returns zero hits
```

**R-23** — Generated value conforms to ODCS constraints

```
GIVEN  an ODCS field with type=integer, range=[0,100], format=none, no quality rules
WHEN   the Data Factory invokes the LLM to generate a value for that field
THEN   the returned value passes type, range, and format checks before being emitted
```

**R-24** — Run UUID embedded in every identifier

```
GIVEN  run UUID `r-7f3a` and a synthetic record with identifier fields {id, external_ref}
WHEN   the Data Factory emits the record
THEN   every identifier field contains `r-7f3a` per the documented embedding format
```

**R-25** — Retry-then-`data-generation` failure

```
GIVEN  a Data Factory configured for N=3 retries and an LLM returning persistently invalid
       values for a field
WHEN   the Data Factory attempts to produce a value
THEN   it retries up to 3 times
AND    on retry exhaustion fails the affected test with classification `data-generation`
```

### Orchestrator & Execution

**R-26** — Trigger run via CLI or dashboard

```
GIVEN  a user with permission to trigger runs
WHEN   the user issues a run command via CLI (or dashboard)
THEN   the Orchestrator initiates a new run synchronously
AND    returns a run UUID to the caller
```

**R-27** — Concurrent run isolation

```
GIVEN  10 concurrent runs of the same scenario launched simultaneously
WHEN   all runs execute to completion
THEN   no run's assertions reference records produced by any other run
```

**R-28** — Single IdP exchange, token reused

```
GIVEN  a run for flow F with hops {h1, h2, h3} authenticating via the configured IdP
WHEN   the run executes
THEN   exactly one IdP token exchange occurs at run start
AND    the same bearer token is presented at h1, h2, and h3 (verified via header capture)
```

**R-28a** — Token refresh on expiry; infra-fail on refresh failure

```
GIVEN  an IdP token whose lifetime is shorter than the run's duration
WHEN   the token expires between two hops
THEN   the Orchestrator refreshes the token exactly once before the next hop
AND    IF refresh fails, remaining hops are classified as `infrastructure-failure`
```

**R-29** — Subscribe before publish

```
GIVEN  a flow hop h1 declared in its ODCS contract to emit events on channel `c1` consumed by h2
WHEN   h1 is about to publish its trigger payload
THEN   the Orchestrator's subscription to `c1` is already active
AND    the subscription is torn down at run end
```

**R-29a** — Subscribe failure → infra-fail + skip downstream

```
GIVEN  a flow where subscription to channel `c1` fails
WHEN   the Orchestrator attempts to subscribe
THEN   the hop is classified as `infrastructure-failure`
AND    downstream hops are marked `skipped: upstream-infra-failure` per R-37
```

**R-30** — Bounded async wait

```
GIVEN  service A configured with maximum-wait timeout T_A and an async event that never arrives
WHEN   the Orchestrator waits for the event on a hop into A
THEN   it waits at most T_A
AND    on timeout triggers R-37
```

**R-30a** — Per-service timeout override honored

```
GIVEN  a per-service timeout override O_A configured for service A via the documented config
       source, and a global default D where O_A ≠ D
WHEN   a run executes a hop into A
THEN   the Orchestrator uses O_A, not D
```

**R-31** — Validate outbound and inbound payloads

```
GIVEN  an ODCS contract C governing a hop into service A
WHEN   the Orchestrator sends a request to A
THEN   the outbound payload is validated against C before send (failures per R-35)
AND    the response is validated against C after receive
```

**R-32** — UI driver for UI-bearing services

```
GIVEN  service A registered as exposing a Web UI relevant to scenario S
WHEN   the Orchestrator executes the hop into A for scenario S
THEN   it drives the hop via the configured UI-automation client
AND    does not invoke the HTTP client for that hop
```

**R-33** — HTTP client for API-only services

```
GIVEN  service A registered as API-only
WHEN   the Orchestrator executes the hop into A
THEN   it drives the hop via the HTTP client
AND    does not invoke the UI driver for that hop
```

### Failure Classification

**R-34** — Exactly one of five categories

```
GIVEN  a test failure produced during a run
WHEN   the Failure Classifier processes it
THEN   it assigns exactly one of {contract-violation, business-rule-violation,
       infrastructure-failure, data-generation, test-bug}
AND    no failure is left unclassified
```

**R-35** — Schema violation → `contract-violation`

```
GIVEN  a payload missing a field declared required in the corresponding ODCS contract
WHEN   the Orchestrator validates the payload at the hop
THEN   the Failure Classifier records the failure as `contract-violation`
```

**R-36** — Quality-rule violation → `business-rule-violation`

```
GIVEN  a payload that satisfies the ODCS schema but violates a declared quality rule
WHEN   the Orchestrator validates the payload at the hop
THEN   the Failure Classifier records the failure as `business-rule-violation`
```

**R-37** — Infra failure + downstream skip

```
GIVEN  service A is unreachable, returns 5xx, or an expected async event does not arrive
       within R-30's bound
WHEN   the Orchestrator executes a hop into A
THEN   the Failure Classifier records the failure as `infrastructure-failure`
AND    downstream hops are marked `skipped: upstream-infra-failure`
AND    skipped hops are excluded from failure counts in the run report
```

### Reporting & Telemetry

**R-38** — Correlation ID propagation

```
GIVEN  a run with allocated correlation ID `cid-9b2`
WHEN   the Orchestrator initiates each hop in the run
THEN   each outbound request carries `cid-9b2` in the configured trace header
AND    each service's logs at that hop contain `cid-9b2`
```

**R-39** — Result record schema

```
GIVEN  a run that completes (pass or fail)
WHEN   the Results Store persists the result record
THEN   the record contains: run UUID, ISO-8601 UTC start, ISO-8601 UTC end, scenario name,
       R-17 description, pass/fail, R-34 classification (if failed), and R-05a version label
       per participating service
```

**R-40** — Failure-link on failed test

```
GIVEN  a test that fails during a run with correlation ID `cid-9b2`
WHEN   the Results Store persists the failure
THEN   the record contains a deep-link URL resolved via the per-service NFR-14 template
AND    the URL filters logs to `cid-9b2`
```

**R-41** — Queryable results store

```
GIVEN  a Results Store containing records for runs over the last 90 days
WHEN   a caller queries by (run UUID | scenario name | failure classification | date range)
THEN   the matching records are returned
```

**R-41a** — Persist retry then critical alert

```
GIVEN  a Results Store that returns errors on write
WHEN   the Orchestrator attempts to persist a result record
THEN   it retries up to the configured bound
AND    on exhaustion emits a critical alert
```

**R-42** — Excel / CSV export

```
GIVEN  a completed run visible on the dashboard
WHEN   a user requests an export in format `.xlsx` (or `.csv`)
THEN   the Dashboard generates a file containing the R-39 columns plus the R-40 failure-link
       column
AND    delivers the file as a download
AND    failed-test rows include a populated failure-link cell
```

**R-42a** — Export timeout cancels with error

```
GIVEN  export generation that exceeds the configured timeout (default 30s)
WHEN   the timeout is reached
THEN   the Dashboard cancels the export
AND    surfaces a structured error to the user
```

**R-43** — In-flight run progress

```
GIVEN  a run with hops {h1, h2, h3} currently executing
WHEN   a user opens the dashboard
THEN   the Dashboard shows each hop's state (queued | in-flight | complete | skipped | failed)
AND    any in-flight ODCS validations are visible
AND    state transitions are reflected within a bounded refresh interval
```

**R-49** — Completed-run rendering

```
GIVEN  a completed run persisted in the Results Store
WHEN   a user opens the dashboard
THEN   the run appears within a bounded refresh interval
AND    each result row shows: pass/fail, R-34 classification, R-17 description,
       R-05a/R-39 service versions, R-40 failure links
```

---

## Non-Functional Requirements

**NFR-01** — *(⚠ flagged — policy invariant, needs audit mechanism)*

```
GIVEN  any staging environment touched by this system
WHEN   the configured PII/PHI-pattern audit runs
THEN   no record matches real-data patterns
```

**NFR-02** — No secrets in code/config/logs

```
GIVEN  the deployed system's code, configs, and logs
WHEN   scanned for secret patterns (IdP creds, repo tokens, LLM keys)
THEN   zero matches are found
AND    every runtime secret resolves to a managed-secrets-store reference
```

**NFR-03** — *(⚠ flagged — deployment attribute, not runtime behavior)*

Re-express as a deploy-time check:

```
GIVEN  the deployed LLM integration
WHEN   its configuration is inspected
THEN   it uses an endpoint that does not retain prompts or completions outside the configured
       AWS account boundary (e.g., Bedrock with invocation logging disabled)
```

**NFR-04** — Least-privilege IAM, staging only

```
GIVEN  the system's deployed IAM roles
WHEN   the role policies are inspected
THEN   every role grants the minimum permissions required for its task
AND    every role is scoped to staging accounts and resources only
```

**NFR-05** — No hard-coded credentials/URLs in generated tests

```
GIVEN  any generated test file in the generated-tests repo
WHEN   the file is scanned
THEN   no hard-coded credentials, tokens, or environment-specific URLs appear
```

**NFR-06** — NL translation ≤ 60s (target)

```
GIVEN  an accepted natural-language scenario in MVP scope
WHEN   the Test Generator translates it
THEN   translation completes within 60 seconds (target metric, not gating)
```

**NFR-07** — Excel export ≤ 30s for ≤ 10k rows

```
GIVEN  a completed run with up to 10,000 result rows
WHEN   a user requests Excel export
THEN   export completes within 30 seconds
```

**NFR-08** — Per-hop ODCS validation ≤ 100ms

```
GIVEN  a hop with payload validation enabled
WHEN   the Orchestrator validates against the ODCS contract
THEN   validation adds at most 100ms to the hop's wall-clock time
```

**NFR-09** — ≥ 10 concurrent runs without cross-contamination
*(Covered by R-27 skeleton.)*

**NFR-10** — Flows of ≥ 10 services

```
GIVEN  a flow of 10 services in topological order
WHEN   a run executes end-to-end
THEN   the run completes (pass or fail) without architectural breakage (timeout, dependency
       resolution failure, memory exhaustion)
```

**NFR-11** — ≥ 90-day results retention

```
GIVEN  a result record persisted ≥ 89 days ago
WHEN   queried
THEN   it is still returned by the Results Store
```

**NFR-12** — Structured logs tagged with run UUID / scenario / correlation ID

```
GIVEN  any log line emitted during a run
WHEN   the log is parsed
THEN   it includes run UUID, scenario name, and correlation ID as structured fields
```

**NFR-13** — Run-level metrics exposed

```
GIVEN  a completed run
WHEN   the metrics endpoint is scraped
THEN   it exposes count, duration, pass rate, and failure-class breakdown
```

**NFR-14** — Failure-link template configurable per service

```
GIVEN  service A configured with failure-link template `https://logs.foo/{correlation_id}`
WHEN   R-40 resolves a failure link for a hop into A
THEN   the resolved URL is produced from A's template, not from a hard-coded value
```
