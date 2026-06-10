# Technical Design — E2E Test Generator for ODCS-Bound Services

**Status:** Draft for review. No code has been written. Approve before implementation begins.

This document is a proposed implementation of the requirements in `spec.md`. It reflects the
six resolved requirements-side OQs and the six technical OQ recommendations from prior triage
(OQ-02, OQ-03, OQ-04, OQ-06, OQ-07, OQ-08, OQ-09). Where a recommendation is not yet
confirmed, it is called out in **§8 Decisions still needed**.

---

## 1. Architecture Overview

### 1.1 Two run types

The system has two distinct run modes triggered through the same entrypoint:

- **Generation run** — pulls inputs, calls the LLM, produces TypeScript test files, commits
  them. No SUTs are touched.
- **Execution run** — runs already-generated test files against SUTs in topological order,
  validates payloads against ODCS, records results.

A generation run does not imply an execution run. CI for the generated repo runs execution
runs on a separate trigger.

### 1.2 Component map

```
                    ┌──────────┐       ┌───────────────┐
                    │   CLI    │       │   Dashboard   │
                    └────┬─────┘       └───────┬───────┘
                         │                     │
                         ▼                     ▼
                    ┌──────────────────────────────────┐
                    │      API Gateway (REST + WSS)    │
                    └─────────────┬────────────────────┘
                                  │
              ┌───────────────────┼──────────────────────┐
              ▼                   ▼                      ▼
        ┌──────────┐       ┌──────────────┐       ┌──────────────┐
        │   Run    │       │   Scenario   │       │    Export    │
        │ Service  │       │    Intake    │       │   Service    │
        │ (Lambda) │       │   (Lambda)   │       │   (Lambda)   │
        └────┬─────┘       └──────┬───────┘       └──────┬───────┘
             │                    │                      │
             │                    ▼                      ▼
             │             ┌─────────────┐         ┌──────────┐
             │             │  Bedrock    │         │ DynamoDB │
             │             │  Sonnet 4.6 │◀────────┤(read API)│
             │             └─────────────┘         └──────────┘
             ▼
   ┌───────────────────────┐
   │   Step Functions      │
   │   (state machine)     │──────────────────────────────┐
   └──┬─────────────────┬──┘                              │
      │                 │                                  │
      │ generation run  │ execution run                    │
      ▼                 ▼                                  │
┌──────────────┐  ┌──────────────────┐                    │
│ Test         │  │  Orchestrator    │                    │
│ Generator    │  │   (Fargate task) │                    │
│ (Fargate)    │  │  + Playwright    │                    │
└──┬───────────┘  └────┬─────────────┘                    │
   │                   │                                   │
   ├─► Bedrock         ├─► IdP (OIDC)                      │
   ├─► Contract Reg.   ├─► SUT API (HTTP)                  │
   ├─► Service repos   ├─► SUT UI (Playwright)             │
   ├─► Deployment sys. ├─► SNS/SQS/EventBridge             │
   ├─► Data Factory    ├─► Data Factory ◄──────┐           │
   ├─► Gen-tests repo  └─► Failure Classifier  │           │
   │     (Git push)         (in-process)       │           │
   │                                            │           │
   ▼                                            │           │
┌──────────────┐                                │           │
│ Gen-tests    │  ◄─── (CI runs tests) ─────────┘           │
│ repo (GH)    │                                            │
└──────────────┘                                            │
                                                             │
   All components ──► CloudWatch Logs + X-Ray + Metrics      │
   All write paths ─► DynamoDB Results Store ────────────────┘
```

### 1.3 Component responsibilities

| Component | Responsibility | Runtime | Maps to |
|-----------|----------------|---------|---------|
| **CLI** | Trigger runs from terminal/CI; show progress | Local Node bin | R-26 |
| **Dashboard** | Trigger runs; show in-flight + completed; export | React (S3+CF) | R-26, R-42, R-43, R-49 |
| **Run Service** | Accept `POST /runs`, allocate UUID, start Step Function | Lambda | R-26, R-38 |
| **Scenario Intake** | Accept NL scenarios, persist, hand to Generator | Lambda | R-19, R-19a |
| **Export Service** | Generate xlsx/csv exports, return presigned URL | Lambda | R-42, R-42a |
| **Step Functions** | Top-level state machine for each run | Step Functions | R-09, R-27 |
| **Test Generator** | Fetch inputs, call LLM, produce TS files, commit | Fargate task | R-01–R-18 |
| **Orchestrator** | Drive hops, validate payloads, classify failures, write results | Fargate task | R-09, R-28–R-37 |
| **Data Factory** | Synthesize ODCS-conformant values on demand at test runtime | Lambda | R-22–R-25 |
| **Failure Classifier** | Pure function: failure → category | In-process lib | R-34–R-37 |
| **Results Store** | Persist + query results | DynamoDB | R-39–R-41 |

### 1.4 Communication patterns

- **Synchronous HTTPS (JSON):** CLI/Dashboard → API Gateway → Lambdas. Generator/Orchestrator → external services (Contract Registry, IdP, SUT APIs, Bedrock, GitHub).
- **Asynchronous (Step Functions task tokens):** Step Functions waits on Fargate task completion via `WAIT_FOR_TASK_TOKEN`.
- **Asynchronous (events):** Orchestrator subscribes to SNS/SQS/EventBridge via SDK; receives via Lambda fan-out or direct SDK poll.
- **Real-time push to Dashboard:** API Gateway WebSocket. Orchestrator publishes hop state transitions; Dashboard subscribes per `run_uuid`. (Satisfies R-43.)
- **Logs/Traces:** every component emits structured JSON to CloudWatch Logs; X-Ray captures spans via OTel auto-instrumentation.

---

## 2. Data Models

### 2.1 DynamoDB tables

Single-region, on-demand capacity, TTL on `expires_at` (90 days per NFR-11).

**Table `runs`**
| Attribute | Type | Notes |
|-----------|------|-------|
| `run_uuid` (PK) | string | UUIDv7 (sortable by time) |
| `run_type` | string | `generation` \| `execution` |
| `status` | string | `pending` \| `running` \| `passed` \| `failed` \| `aborted` |
| `start_ts` | string | ISO-8601 UTC |
| `end_ts` | string | ISO-8601 UTC, absent until done |
| `flow_id` | string | FK to Flows |
| `scenario_id` | string | FK to Scenarios (null if all scenarios) |
| `correlation_id` | string | Allocated per R-38 |
| `service_versions` | map<string,string> | service_id → version label (R-05a) |
| `expires_at` | number | epoch sec; TTL field |

- GSI `by_status`: PK = `status`, SK = `start_ts`. For "what's running now" queries.
- GSI `by_scenario`: PK = `scenario_id`, SK = `start_ts`.

**Table `hops`**
| Attribute | Type | Notes |
|-----------|------|-------|
| `run_uuid` (PK) | string | |
| `hop_seq` (SK) | number | 0-indexed position in topological order |
| `service_id` | string | |
| `status` | string | `queued` \| `in_flight` \| `complete` \| `skipped` \| `failed` |
| `classification` | string? | one of the five R-34 categories, when failed |
| `start_ts`, `end_ts` | string | |
| `inbound_payload_ref` | string | S3 key (payloads can be large) |
| `outbound_payload_ref` | string | S3 key |
| `failure_link` | string? | per R-40 / NFR-14 |
| `expires_at` | number | TTL |

**Table `results`** *(denormalized for fast read on the dashboard)*
| Attribute | Type | Notes |
|-----------|------|-------|
| `run_uuid` (PK) | string | |
| `scenario_name` (SK) | string | |
| `pass_fail` | string | `pass` \| `fail` |
| `classification` | string? | |
| `use_case_description` | string | R-17 |
| `service_versions` | map | R-39 |
| `failure_link` | string? | R-40 |
| `expires_at` | number | TTL |

- GSI `by_classification`: PK = `classification`, SK = `start_ts`. For R-41 query-by-classification.
- GSI `by_scenario_name`: PK = `scenario_name`, SK = `start_ts`. For R-41 query-by-scenario.

**Table `scenarios`**
| Attribute | Type | Notes |
|-----------|------|-------|
| `scenario_id` (PK) | string | |
| `source` | string | `lineage` \| `named` \| `user` |
| `nl_text` | string? | for `user` source |
| `translated_artifact` | map | { steps[], data_requirements[] } |
| `status` | string | `pending` \| `translated` \| `rejected` \| `committed` |
| `rejection_reason` | string? | structured explanation per R-21 |
| `flow_id` | string | FK |

**Table `flows`**
| Attribute | Type | Notes |
|-----------|------|-------|
| `flow_id` (PK) | string | |
| `source` | string | `lineage` \| `named` |
| `services` | list<string> | service IDs in topological order |
| `definition_ref` | string? | for `named` flows, where the def was submitted from |

**Table `service_config`** *(small static table)*
| Attribute | Type | Notes |
|-----------|------|-------|
| `service_id` (PK) | string | |
| `repo_url` | string | |
| `deployment_system_ref` | map | how to look up deployed version |
| `failure_link_template` | string | per NFR-14 |
| `async_timeout_ms` | number | per R-30a (default 60_000) |
| `ui_base_url` | string? | for R-32 (Playwright nav target) |

### 2.2 S3 layout

```
s3://awp-e2e-{env}/
  runs/{run_uuid}/
    inputs/                  -- snapshot of all artifacts (R-01..R-05)
      contracts/{svc}.odcs.json
      openapi/{svc}.openapi.yaml
      ui-spec/{svc}.yaml
      repo-extract/{svc}/    -- subset of repo files
    payloads/
      {hop_seq}/in.json
      {hop_seq}/out.json
    logs/                    -- structured run logs (mirror of CW Logs)
  exports/
    {export_id}.xlsx
    {export_id}.csv
```

### 2.3 Generated-tests repo layout

```
awp-generated-tests/
  README.md
  .github/workflows/test.yml
  flows/
    onboarding-to-get-ready/
      scenarios/
        happy-path/
          {hop-seq}-{service}.test.ts
        named-{scenario-name}/
          ...
```

Every `.test.ts` file begins with the `// @generated` header (R-13) carrying generator
version, generation timestamp, source-contract version, and scenario ID.

---

## 3. API Surface

REST API behind API Gateway with IdP-issued JWT auth.

### 3.1 Runs

```
POST /runs
  body: { type: "generation"|"execution", flow_id: string, scenario_id?: string }
  201:  { run_uuid: string, status: "pending" }
  401:  { error: "unauthenticated" }
  400:  { error: "validation", detail: { ... } }

GET /runs/{run_uuid}
  200:  Run + hops[] (latest known state)
  404:  { error: "not_found" }

GET /runs?status=&scenario=&from=&to=&limit=&cursor=
  200:  { runs: Run[], next_cursor?: string }

GET /runs/{run_uuid}/export?format=xlsx|csv
  302:  Location: presigned S3 URL (15-min expiry)
  408:  { error: "export_timeout" }              -- per R-42a
```

### 3.2 Scenarios

```
POST /scenarios
  body: { nl_text: string, flow_id: string }
  201:  { scenario_id, status: "pending" }
  400:  { error: "empty"|"too_long", limit: 4000 }   -- per R-19a

GET /scenarios/{scenario_id}
  200:  Scenario (status, translated_artifact|rejection_reason)
```

### 3.3 Flows

```
GET  /flows                       200: Flow[]
POST /flows  body: NamedFlowDef   201: Flow  | 400: { error: "unknown_service", svc }
```

### 3.4 WebSocket — Dashboard live updates

```
wss://.../live
  client → server: { action: "subscribe", run_uuid }
  server → client: { run_uuid, hop_seq, status, ts } on every transition
```

### 3.5 Internal: Data Factory (called from generated test code at runtime)

```
POST /internal/data-factory/values
  body: { run_uuid, contract_ref, fields: FieldSpec[] }
  200:  { values: Record<string, any> }
  422:  { error: "data_generation", retries_exhausted: true }   -- per R-25
```

This endpoint is reachable only from within the run's network (Fargate task's VPC).

---

## 4. Tech Stack with NFR Justification

| Choice | Why |
|--------|-----|
| **TypeScript everywhere** | Generated tests are TS (R-11). One language across system + tests reduces context-switching for the team that owns both. |
| **AWS CDK (TS)** | Repo is already a CDK TS template. Honors NFR-04 (least-privilege IAM) by composing scoped role constructs. |
| **API Gateway REST + WebSocket** | REST for CRUD; WSS for R-43 in-flight progress. Native IAM/JWT integration honors NFR-02 (secrets stay in Secrets Manager and IAM, not in app code). |
| **Step Functions** | Hop-by-hop topological execution (R-09) maps directly to a state machine. Built-in observability satisfies NFR-12/NFR-13 with no extra code. |
| **Fargate for long-running work** | Generator and Orchestrator both exceed Lambda's 15-minute ceiling and need a persistent file system for repo clones + Playwright. Configurable concurrency satisfies NFR-09 (10 concurrent runs) without per-Lambda quota pressure. |
| **Lambda for short-lived work** | Run Service, Scenario Intake, Export Service, Data Factory — all bounded latency, stateless. NFR-07 export ≤30s fits comfortably. |
| **Bedrock + Claude Sonnet 4.6 (translation) + Haiku 4.5 (per-field data)** | Bedrock keeps data inside AWS account (NFR-03 — no external retention). Sonnet handles R-20 translation ambiguity. Haiku handles R-23 high-volume per-field generation cheaply. Prompt caching of contract context cuts both cost and latency, supporting NFR-06 (≤60s translation). |
| **DynamoDB** | R-41 query surface (4 dimensions) maps exactly to PK + 3 GSIs. TTL satisfies NFR-11 (90-day retention) with no scheduled job. Single-digit-ms reads support R-43 dashboard refresh. |
| **S3 for payloads + exports** | DynamoDB item-size limit (400KB) is below realistic ODCS payload sizes. Hop payloads live in S3 keyed by run_uuid + hop_seq. |
| **Playwright Test** | R-32 UI driving. Native TS, multi-browser, parallel-by-default, robust cross-origin handling. |
| **GitHub for generated-tests repo** | Existing infra. Pre-receive hook (deployed as a GitHub App or branch-protection check) enforces R-14 by rejecting any push whose touched files contain `// @generated` and whose author is not the generator service account. |
| **CloudWatch Logs + X-Ray** | NFR-12 (structured logs), NFR-13 (metrics), R-38 (correlation ID propagation via W3C `traceparent`). Failure-link templates per NFR-14 emit CloudWatch Logs Insights URLs filtered by correlation ID. |
| **Okta/Ping (existing IdP) via OIDC** | R-28. Single token exchange at run start; reused across hops via the Orchestrator's in-memory token cache. |
| **AWS Secrets Manager** | NFR-02. IdP client secret, GitHub PAT, Bedrock not-required (uses IAM), Contract Registry creds. |

### NFR-by-NFR mapping

- **NFR-01** No real PII — enforced by R-22/R-22a (data sources allowlist) + proposed NFR-15 (PII scan).
- **NFR-02** No secrets in code/logs — Secrets Manager + structured logger that redacts known-key fields.
- **NFR-03** No prompt retention outside AWS — Bedrock with model invocation logging *disabled*.
- **NFR-04** Least privilege — separate IAM roles per Lambda/Fargate task, scoped resources.
- **NFR-05** No hard-coded creds in generated tests — code-review on the generator's templates; static scan in CI.
- **NFR-06** Translation ≤60s — Sonnet + cached contract context. Budgeted with timeout.
- **NFR-07** Export ≤30s for 10k rows — parallel scan on `results` table, in-memory aggregation.
- **NFR-08** Validation ≤100ms — Ajv compiled validators cached per ODCS version.
- **NFR-09** 10 concurrent runs — Step Functions standard workflows; Fargate task concurrency cap configurable.
- **NFR-10** 10-service flows — Step Functions Map state.
- **NFR-11** 90-day retention — DynamoDB TTL.
- **NFR-12** Structured logs — JSON logger with mandatory fields (run_uuid, scenario, correlation_id).
- **NFR-13** Run-level metrics — CloudWatch Metrics emitted from Orchestrator on every run completion.
- **NFR-14** Per-service failure-link template — `service_config` table column.

---

## 5. Integration Boundaries (each becomes an integration test)

Numbered IB-XX for traceability. Each is a test target.

| ID | Boundary | Protocol | Test focus |
|----|----------|----------|------------|
| IB-01 | CLI ↔ API Gateway | HTTPS REST | Auth flow, error mapping |
| IB-02 | Dashboard ↔ API Gateway (REST) | HTTPS REST | CORS, auth, payload shape |
| IB-03 | Dashboard ↔ API Gateway (WSS) | WebSocket | Subscribe, receive transitions, reconnect |
| IB-04 | API Gateway ↔ Run Service Lambda | Lambda proxy | Run start happy + error paths |
| IB-05 | Run Service ↔ Step Functions | SDK | `StartExecution` with run input shape |
| IB-06 | Step Functions ↔ Test Generator (Fargate) | `RunTask` + task token | Task launch, success, failure, timeout |
| IB-07 | Step Functions ↔ Orchestrator (Fargate) | `RunTask` + task token | Same as above |
| IB-08 | Test Generator ↔ Bedrock | HTTPS SDK | Throttling retry, model timeout, response parsing |
| IB-09 | Test Generator ↔ Contract Registry | HTTPS | Latest-semver-tag selection, 404 → R-06 abort |
| IB-10 | Test Generator ↔ Service repos (GitHub) | Git over HTTPS | Clone at deployed commit, missing-repo → R-06 |
| IB-11 | Test Generator ↔ Deployment system | HTTPS *(OQ-04 pending)* | Version-label retrieval, 404 → R-06 |
| IB-12 | Test Generator ↔ Generated-tests repo | Git push | Push success, conflict → R-12a retry, hook reject → log |
| IB-13 | Orchestrator ↔ IdP | OIDC HTTPS | Single token exchange (R-28), refresh on expiry (R-28a) |
| IB-14 | Orchestrator ↔ SUT API | HTTPS | 2xx, 5xx → R-37, schema validation per R-31 |
| IB-15 | Orchestrator ↔ SUT UI | Playwright | Selector stability, navigation success, timeout → R-37 |
| IB-16 | Orchestrator ↔ SNS/SQS/EventBridge | AWS SDK | Subscribe before publish (R-29), subscribe failure (R-29a), event arrives, event times out (R-37) |
| IB-17 | Orchestrator ↔ Failure Classifier | In-process | Table-driven over all five categories |
| IB-18 | Orchestrator ↔ Results Store | DynamoDB SDK | Write success, throttle retry (R-41a), eventual consistency on read |
| IB-19 | Generated test code ↔ Data Factory | HTTPS REST (in-VPC) | Field generation, retry on validation (R-25), exhaustion → R-25 fail |
| IB-20 | Dashboard ↔ Read API ↔ DynamoDB | HTTPS + SDK | List/filter/paginate, GSI hit ratios |
| IB-21 | Export Service ↔ S3 (presigned URL) | SDK | URL expiry, large file streaming, NFR-07 timeout |
| IB-22 | All components ↔ CloudWatch Logs | SDK / OTel | Mandatory fields present (NFR-12), correlation ID propagation (R-38) |

---

## 6. Failure Modes per Boundary

For each IB, what can fail and the configured response. (Reference R-XX = matches an existing
spec requirement; *no req* = handled here, propose adding to spec if you agree.)

| IB | Failure | Response |
|----|---------|----------|
| IB-01/02 | API GW 5xx, throttling | Client exponential backoff; surface to user after N retries (*no req — propose UI policy*) |
| IB-04 | Run Service Lambda timeout (29s ceiling) | Should be impossible — Run Service only validates + kicks off Step Function. If hit: 504 to client. |
| IB-05 | Step Functions `StartExecution` throttled | Retry with backoff inside Run Service Lambda; on exhaustion, 503 to client. |
| IB-06/07 | Fargate task fails to start | Step Functions catches, classifies `infrastructure-failure` (R-37 generalized). Records run as aborted. |
| IB-08 | Bedrock throttle | SDK exponential backoff; on exhaustion (per scenario) classify `data-generation` (R-25) or, for translation, reject scenario with reason `llm_unavailable` (extends R-21). |
| IB-08 | Bedrock returns malformed JSON | Retry up to N=3 with reformulated prompt; on exhaustion treat as R-21 rejection (translation) or R-25 fail (data). |
| IB-09 | Contract Registry 404 | R-06 abort. |
| IB-09 | Contract Registry returns no semver tags for a service | R-06 abort with reason `no_semver_tags`. *(Sub-question from SF-01.)* |
| IB-10 | Service repo unreachable / commit not found | R-06 abort. |
| IB-11 | Deployment system unreachable | R-06 abort. *(Depends on OQ-04.)* |
| IB-12 | Git push 5xx / network | R-12a retry + `infrastructure-failure`. |
| IB-12 | Pre-receive hook rejects push (human attempted to modify generated file in same PR) | Log + emit run-report entry; do not retry. *(Edge case — propose adding as R-12b.)* |
| IB-13 | IdP token request 5xx | Retry up to 3; on exhaustion abort run as `infrastructure-failure`. |
| IB-13 | Token expires mid-run | R-28a refresh; on refresh failure cascade to remaining hops. |
| IB-14 | SUT 5xx, network error | R-37 `infrastructure-failure`; downstream hops `skipped`. |
| IB-14 | SUT 4xx with valid schema | R-36 `business-rule-violation`. |
| IB-14 | SUT response fails schema | R-35 `contract-violation`. |
| IB-15 | Playwright cannot reach base URL | R-37 `infrastructure-failure`. |
| IB-15 | Selector not found / unexpected page state | R-37 `infrastructure-failure` (treat as environment misconfig per E-10). |
| IB-16 | SNS subscribe fails | R-29a `infrastructure-failure`; skip downstream. |
| IB-16 | Event never arrives within R-30 bound | R-37 `infrastructure-failure`. |
| IB-18 | DynamoDB throttle / 5xx | R-41a retry + critical alert on exhaustion. |
| IB-19 | Data Factory exhausts retries | R-25 fail test with `data-generation`. |
| IB-21 | Export takes >30s | R-42a cancel + structured error. |
| IB-22 | CloudWatch Logs write fails | Best-effort; do not fail the run. Emit fallback to stderr. *(Propose adding as NFR-16.)* |

---

## 7. Spec issues I cannot implement cleanly

These are conflicts or under-specifications that need a decision before I can build. Each
maps to a specific requirement or pair.

### 7.1 ODCS-vs-OpenAPI version skew (R-01 ↔ R-02/R-04)

**Problem:** R-01 fetches the **latest semver-tagged** ODCS contract from the registry. R-02
and R-04 fetch OpenAPI specs and source from the **deployed-version commit** in each service's
repo. These can diverge.

**Concrete failure case:** Service A has ODCS v1.5 in the registry, deployed code is at v1.3.
A generated test exercises a field that v1.5 added but v1.3 doesn't return. R-31 will fire
`contract-violation` on every run — not because the SUT is broken, but because the contract is
ahead of the code.

**Possible resolutions:**
- **(a)** Accept the divergence and treat persistent `contract-violation` as the system telling
  service teams "your deployed code lags your contract." This is the strongest interpretation
  of R-01 Option 2 ("ahead of deployed is intentional, catches drift early").
- **(b)** Add a tolerance: if a deployed service responds successfully under the *deployed*
  ODCS version, treat it as a pass with an informational note. Adds complexity.
- **(c)** Reverse R-01: fetch ODCS at the deployed-version commit instead. Removes the drift
  signal but eliminates the false-positive class.

**My recommendation:** (a) plus a new requirement — when a service's deployed ODCS version is
behind the registry's latest, surface that in the run report as a non-fatal annotation
("service A deployed at v1.3, contract latest v1.5") so users see the drift explicitly rather
than just seeing repeated `contract-violation`s.

### 7.2 R-22 / R-22a invariants without a detection mechanism

**Problem:** Already flagged in `spec-test-skeletons.md`. "Data Factory produces only synthetic
data" has no observable THEN clause. Without a detection mechanism, the requirement is
unenforceable at test time.

**Recommendation:** Add **NFR-15** — "THE Data Factory SHALL fail-closed if a static-pattern
PII scan flags any generated value. The scan SHALL run on every generated record before it
leaves the Data Factory." Implementation: a small regex/dictionary check (SSN patterns, names
from a curated College Board real-data corpus shouldn't appear, etc.) — fail the test with
`data-generation` and a distinct sub-code `pii_pattern_detected`. Needs your approval.

### 7.3 R-05 compound — six artifact classes in one requirement

**Problem:** Already flagged. Each of the six (seed tests, OpenAPI, ODCS, repo metadata,
source, requirement docs) has its own absence behavior. Currently R-05 treats them as a single
extraction; failure modes are smeared.

**Recommendation:** Split into R-05.a–f. Each gets its own pair: required-presence assertion +
absence behavior. The absence behavior for some (e.g., CODEOWNERS missing) is *not* a R-06
abort — generation can proceed. Others (OpenAPI missing) *are* R-06 aborts. Today the spec
doesn't distinguish.

### 7.4 R-29 depends on SF-03 not yet confirmed

**Problem:** R-29 reads channel names from the ODCS contract's `events` section. SF-03 notes
we haven't confirmed whether the ODCS schema supports `events`. Until confirmed, async hops in
the MVP flow (onboarding → get-ready) are blocked.

**Recommendation:** Drive SF-03 first action item — confirm with the ODCS schema owner before
the implementation milestone for R-29 begins.

### 7.5 R-32 hop semantics — service-driver or interaction-driver?

**Problem:** R-32 says "WHERE a service is registered as exposing a Web UI…drive the hop via
UI-automation." R-33 says "WHERE a service exposes only an API…drive via HTTP." But a hop is
*an interaction between two services*. If service A is API-only and triggers service B (which
has a UI), the hop "A → B" needs the HTTP client for the call into A and the UI driver for B's
post-conditions. The spec implicitly assumes one driver per hop.

**Recommendation:** Reinterpret R-32/R-33 as **per-interaction** rather than per-service. Each
hop has an inbound interaction (how we send to it) and an outbound observation (how we verify
its side-effects on the next service). The choice of driver depends on the *direction-and-
target*, not on a global service property. I can rewrite R-32/R-33 if you confirm this read.

### 7.6 R-43 needs a real-time push channel — not in spec

**Problem:** R-43 says "WHILE a run is in progress, THE Dashboard SHALL display per-hop
progress." That implies near-real-time updates. The spec doesn't say *how* (polling? push?).
Polling would mean a "what's running" query every few seconds per active run; push needs a
WebSocket or SSE channel.

**Recommendation:** Add to spec — "Orchestrator SHALL publish hop state transitions to a
WebSocket channel keyed by run_uuid; Dashboard SHALL subscribe to the channel for each open
run." Or, if cheaper is preferred, "Dashboard SHALL poll `GET /runs/{run_uuid}` at most every
3s while a run is in `running` state." Need your call. (My design assumes WebSocket.)

### 7.7 Generated test runtime model — implicit in spec

**Problem:** The spec says the Test Generator produces TypeScript test files (R-11). It also
says the Orchestrator traverses services in topological order (R-09). It does *not* say
whether the Orchestrator imports and invokes the generated test files in order, or whether
each generated test file runs independently and the Orchestrator just coordinates timing.

**Recommendation:** Each generated `.test.ts` file is a Playwright Test spec. The Orchestrator
launches Playwright with a custom reporter that emits hop transitions to the Results Store + WSS,
and with a `topological-order` runner config that gates hop N on hop N-1's pass. This keeps
the generated tests human-runnable (a developer can `npx playwright test` the generated repo
locally) while satisfying R-09's "in topological order" mandate. Worth adding as a sentence
in the spec.

### 7.8 Data Factory: design-time or run-time?

**Problem:** R-23 says "WHEN the Data Factory generates a value…" — but *when* does that
happen? At test-generation time (values baked into the .test.ts files) or at test-run time
(values fetched by the test from the Data Factory API)? Both are defensible:

- **Design-time baking** — simpler runtime, but R-24 requires the *run* UUID embedded; the
  generator doesn't know the future run UUID. Forces post-fetch substitution.
- **Run-time fetching** — naturally satisfies R-24 (run UUID known when the call is made),
  but the Data Factory must be on the critical path of every test run.

**Recommendation:** Run-time fetching. The generator emits placeholder calls in the test
files (`const customerId = await dataFactory.value('customer.id')`), and the Data Factory
Lambda materializes the value at test runtime with the current run UUID baked in. This is the
shape I designed in §3.5. Worth making explicit in the spec (could be R-23 or a new R-23a).

---

## 8. Decisions still needed before implementation begins

Carried forward from prior open-question triage:

| OQ | Question | My recommendation | Confirmed? |
|----|----------|-------------------|------------|
| OQ-02 | LLM provider/model | Bedrock + Sonnet 4.6 (translation) + Haiku 4.5 (per-field data) | No |
| OQ-03 | Observability backend | CloudWatch Logs + X-Ray; `traceparent` for R-38 | No |
| OQ-04 | Deployed-version source | **Need AWP-specific answer — what does AWP use?** | No |
| OQ-06 | Where the system runs in AWS | Step Functions + Lambda (short) + Fargate (Generator/Orchestrator) | No |
| OQ-07 | Generated-tests repo governance | Direct push to one repo with pre-receive hook | No |
| OQ-08 | UI automation | Playwright Test | No |
| OQ-09 | Results store | DynamoDB with the table design in §2.1 | No |

New decisions surfaced by this design pass:

| ID | Question | My recommendation |
|----|----------|-------------------|
| D-01 | Resolution of §7.1 ODCS-vs-OpenAPI skew | Accept divergence; add drift annotation to run reports |
| D-02 | Approve NFR-15 (PII scan) per §7.2 | Yes — fail-closed `pii_pattern_detected` |
| D-03 | Split R-05 per §7.3 | Yes — R-05.a–f with per-class absence behavior |
| D-04 | Drive SF-03 (ODCS `events`) first per §7.4 | Yes — week-1 task |
| D-05 | R-32/R-33 per-interaction reinterpretation (§7.5) | Yes — rewrite R-32/R-33 |
| D-06 | R-43 push vs poll (§7.6) | WebSocket push |
| D-07 | Generated-test runtime model (§7.7) | Playwright Test + topological-order reporter |
| D-08 | Data Factory at run-time, not design-time (§7.8) | Run-time; add R-23a |

Plus the **9 default-table items** from the prior triage (OQ-01, OQ-05, OQ-10, OQ-11, OQ-12,
R-06, R-19a=4000, R-25 retries=3, R-34 five-category taxonomy) — still awaiting accept/override.

---

## Approval checklist for next step

Before any code is written, please confirm or override:

1. The seven OQs in §8 (technical OQs from prior triage).
2. The eight D-01..D-08 design decisions in §8.
3. The 9 defaults from the prior triage.
4. The architecture in §1 (two run types, component map, Step Functions + Fargate split).
5. The DynamoDB schema in §2.1.
6. The API surface in §3.

Once approved, I'll update `spec.md` to absorb the new requirements (NFR-15, R-05.a–f,
R-23a, R-32/R-33 rewrite, R-43 transport clause) and then begin implementation in milestones
to be agreed.
