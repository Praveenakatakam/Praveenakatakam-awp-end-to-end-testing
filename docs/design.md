# Technical Design: E2E Test Generator for ODCS-Bound Services

Companion to `spec.md`. **Status: draft for review. No code written yet.** Approve §0 decisions and §7 conflicts before implementation begins.

## 0. Decisions baked into this design

Resolved during the design-review pass. Flag any to revisit.

| Ref | Decision |
|-----|----------|
| R-01 | "Latest released" = ODCS registry `released` tag (decoupled from deployment) |
| R-05a / OQ-04 | Deployed version labels sourced from an internal deployment registry |
| R-12 / OQ-07 | One generated-tests repo, direct push from generator bot identity |
| R-24 | Run-UUID embedded as **prefix**: `e2e-<run-uuid>-<originalId>` |
| R-29 | Event channel name declared in ODCS contract via custom extension property |
| R-32 / OQ-08 | **Playwright Test** for UI automation (also chosen as the generated-test framework) |
| R-41 / OQ-09 | **DynamoDB** for the Results Store |
| OQ-02 | **Amazon Bedrock + Claude** (Sonnet 4.6 default; Opus 4.7 for scenario translation R-20) |
| OQ-03 | **CloudWatch Logs + X-Ray** as observability backend; per-service NFR-14 template still parameterized |
| OQ-06 | **Serverless, event-driven**: Lambda + SQS + SNS + EventBridge; Fargate only for Playwright runtime |

Default-accepted answers (R-03, R-06, R-08, R-19a, R-21, R-25, R-30a, R-34, R-38, OQ-01, OQ-05, OQ-10, OQ-11, OQ-13) carry forward from the open-questions review and surface in the relevant sections below.

---

## 1. Architecture Overview

### 1.1 Two lifecycles

The system has two distinct lifecycles, coupled only by the generated-tests repo and the EventBridge bus:

- **Generation lifecycle** — produces synthetic data + Playwright Test specs for a (flow, scenario) pair. Triggered by contract changes, scenario submissions, or explicit regeneration. Output: committed test files in the generated-tests repo + a `tests.ready` event.
- **Execution lifecycle** — runs previously-generated tests against staging services hop by hop, validates ODCS contracts, classifies failures. Triggered by a user-initiated run. Output: a Results Store record + dashboard updates.

A generation run does not auto-trigger execution. An execution run uses whatever generation is current in the repo at run-start.

### 1.2 Component map (event-driven)

```
   CLI ──┐
         ├──► API Gateway (REST + WSS) ──► API Lambda ──► EventBridge bus
Dashboard┘                                                       │
                                                                 │
+────────────────────────────────────────────────────────────────┼───────────────+
│  Generation lifecycle (event choreography)                     │               │
│                                                                ▼               │
│   run.requested ──► Resolver λ ─► run.inputs.ready ─► FlowDiscovery λ          │
│                                                       │                        │
│                                            flow.ready ▼                        │
│                                            ScenarioTranslator λ (Bedrock Opus) │
│                                                       │                        │
│                                       scenario.ready  ▼                        │
│                                            DataFactory λ (Bedrock Sonnet)      │
│                                                       │                        │
│                                              data.ready ▼                      │
│                                            TestGenerator λ (Bedrock + tsc)     │
│                                                       │                        │
│                                            tests.ready ▼                       │
+────────────────────────────────────────────────────────┼──────────────────────+
                                                         │
+────────────────────────────────────────────────────────┼──────────────────────+
│  Execution lifecycle (event choreography)              ▼                       │
│                                                                                │
│   run.start ─► HopExecutor (API hop) λ ──┐                                     │
│                                          ├─► hop.completed ─► next HopExecutor │
│       HopExecutor (UI hop) → Fargate ────┘                                     │
│                                                                                │
│   SUT SNS/SQS/EventBridge ─► EventBridgeBridge λ ─► hop.event-received         │
│   EventBridge Scheduler ──► hop.timeout (per R-30/R-30a)                       │
│                                                                                │
│   FailureClassifier λ (R-34–R-37) ─► writes classification + skip cascade      │
+────────────────────────────────────────────────────────────────────────────────+

Cross-cutting:
  DynamoDB (Runs / HopResults / TestResults / Scenarios / Flows / TestArtifacts / Contracts / ServiceConfig)
  S3 (payload archive, exports)
  Secrets Manager (NFR-02)
  CloudWatch Logs + X-Ray (NFR-12, NFR-14)
  API Gateway WSS for R-43 live dashboard push
```

### 1.3 Component responsibilities

| Component | Runtime | Responsibility | Reqs |
|-----------|---------|----------------|------|
| **API Lambda** | Lambda | Accept REST requests; emit events; return run UUIDs synchronously | R-19, R-26 |
| **Resolver Lambda** | Lambda | Fetch ODCS contracts (registry `released` tag), OpenAPI, UI specs, source repos, deploy versions; persist `RunInputs` | R-01–R-06, R-05a |
| **FlowDiscovery Lambda** | Lambda | Build dependency graph from ODCS lineage; accept named-flow definitions; detect cycles; deterministic topological sort by service name | R-07–R-09 |
| **ScenarioTranslator Lambda** | Lambda + Bedrock (Opus 4.7) | Translate NL scenarios to structured artifact; reject low-confidence or contract-violating | R-19–R-21 |
| **DataFactory Lambda** | Lambda + Bedrock (Sonnet 4.6) | Generate ODCS-valid synthetic records on-demand at test runtime; embed `e2e-<run-uuid>-` prefix on every identifier | R-22–R-25 |
| **TestGenerator Lambda** | Lambda + Bedrock (Sonnet 4.6) | Emit `@generated` Playwright Test spec files per (hop, scenario); run `tsc --noEmit`; commit to tests repo | R-11–R-18, R-20 |
| **HopExecutor (API)** | Lambda | Load + invoke the Playwright Test spec for one hop using `--grep <hop-id>`; validate outbound + inbound ODCS; record `HopResult`; publish hop event | R-29–R-33 |
| **HopExecutor (UI)** | Fargate task | Same as API HopExecutor but with Playwright browser runtime; spawned by a HopExecutor Lambda dispatcher | R-32 |
| **EventBridgeBridge Lambda** | Lambda | Subscribe (BEFORE publishing hop runs) to SUT-declared channels per ODCS extension; bridge SUT events to internal `hop.event-received` events | R-29 |
| **Watchdog** | EventBridge Scheduler + Lambda | Fire `hop.timeout` after the per-service maximum-wait elapses without an event | R-30, R-30a |
| **FailureClassifier Lambda** | Lambda | Subscribe to `hop.failed`; assign exactly one of 5 categories; persist; emit skip cascade | R-34–R-37 |
| **Results Store** | DynamoDB | Persist runs, hops, scenarios, test artifacts; GSIs cover R-41 query dimensions | R-39, R-41 |
| **Dashboard** | React SPA (S3 + CloudFront) | Live progress via WSS (R-43); completed runs (R-49); export (R-42) | R-26, R-42, R-43, R-49 |

### 1.4 Communication patterns

- **Synchronous HTTPS** only at the API edge. `POST /runs` returns in milliseconds; the actual work is event-driven.
- **Event choreography** for all internal flow. EventBridge bus is the spine. No Step Functions in MVP — each Lambda subscribes to its trigger event and publishes the next event itself, with DLQ on failure.
- **Subscribe-before-publish (R-29)** enforced structurally: when hop N's setup runs, it invokes EventBridgeBridge to create subscriptions for hop N+1's expected SUT events *before* hop N publishes its trigger payload.
- **WebSocket push for R-43**: API Gateway WSS endpoint. HopExecutors emit hop state transitions to a per-runUuid WSS channel. Dashboard subscribes per open run. No polling on the dashboard path.
- **Fargate carve-out**: UI hops use Fargate because Playwright + Chromium is heavyweight (10 GB ephemeral ceiling on Lambda is brittle for full browser runs). HopExecutor Lambda detects `webUi: true` on the target service and dispatches to Fargate via ECS RunTask; the Fargate task publishes the `hop.completed` event itself.

---

## 2. Data Models

DynamoDB. On-demand billing, PITR enabled, TTL on closed-run records at 90 days (NFR-11).

### 2.1 Tables

#### `Runs`
- **PK**: `runUuid` (UUIDv7, time-sortable).
- Attributes: `status` (`pending`|`generating`|`executing`|`passed`|`failed`|`aborted`), `flowId`, `scenarioId`, `correlationId` (= `runUuid`), `startedAt`, `completedAt`, `serviceVersions` (`{serviceName: deployedVersionLabel}`), `failureClassification`, `summary` (counts), `dateBucket` (`YYYY-MM` for GSI partitioning), `expiresAt`.
- **GSI-1** `byScenario`: PK = `scenarioId`, SK = `startedAt`. (R-41 query-by-scenario.)
- **GSI-2** `byClassification`: PK = `failureClassification`, SK = `startedAt`. (R-41 query-by-classification.)
- **GSI-3** `byDateBucket`: PK = `dateBucket`, SK = `startedAt`. (R-41 query-by-date-range, hot-key safe.)

#### `HopResults`
- **PK**: `runUuid`, **SK**: `hopSeq` (zero-padded).
- Attributes: `serviceName`, `state` (`queued`|`in_flight`|`complete`|`skipped`|`failed`), `outboundValidation`, `inboundValidation`, `startedAt`, `completedAt`, `failureLink`, `payloadInRef` (S3 key), `payloadOutRef`, `expiresAt`.

#### `TestResults`
- **PK**: `runUuid`, **SK**: `testCaseId` = `<scenarioId>#<hopSeq>#<caseType>` (caseType ∈ `happy`|`boundary:<field>`|`negative:<rule>`).
- Attributes: `passFail`, `classification`, `useCaseDescription` (R-17), `failureLink` (R-40), `assertionDetails`, `expiresAt`.

#### `Scenarios`
- **PK**: `scenarioId`.
- Attributes: `sourceText`, `status` (`pending`|`translated`|`rejected`|`registered`), `translation` (steps + dataRequirements), `confidence`, `unresolvedReferences`, `rejectionReason`, `createdAt`, `submitter`.

#### `Flows`
- **PK**: `flowId`.
- Attributes: `name`, `source` (`lineage`|`named`), `services` (ordered topo list, stable-sorted by name), `definitionRef`, `registeredAt`.

#### `TestArtifacts`
- **PK**: `artifactPath` (e.g., `flows/onboarding-getready/scenario-001/hop-02--happy.test.ts`).
- Attributes: `generatorVersion`, `generationTimestamp`, `sourceContractVersions` (`{serviceName: contractVersion}`), `scenarioId`, `hopSeq`, `compileStatus`, `lastRunUuid`.

#### `Contracts`
- **PK**: `serviceName`, **SK**: `contractVersion`.
- Attributes: `odcsBody`, `openApiBody`, `uiSpecBody`, `fetchedAt`, `releasedTagAtFetch`.

#### `ServiceConfig`
- **PK**: `serviceName`.
- Attributes: `webUi` (bool, satisfies R-03 default D1), `failureLinkTemplate` (NFR-14), `asyncTimeoutMs` (R-30a, default 60 000), `uiBaseUrl`, `deployRegistryRef`.

### 2.2 S3 layout

```
s3://awp-e2e-{env}/
  runs/{runUuid}/
    inputs/
      contracts/{svc}.odcs.json
      openapi/{svc}.openapi.yaml
      ui-spec/{svc}.yaml
      repo-extract/{svc}/...
    payloads/{hopSeq}/in.json
    payloads/{hopSeq}/out.json
  exports/{exportId}.{xlsx|csv}
```

### 2.3 Identifier conventions

- **Run UUID** — RFC-4122 v7 (time-sortable; preferred over v4 for DynamoDB partitioning).
- **Synthetic identifier (R-24)** — `e2e-<runUuid>-<originalIdFromContract>`. Wipe predicate: `begins_with('e2e-')`.
- **Correlation ID (R-38)** — equals `runUuid`; propagated via the W3C `traceparent` header.
- **Artifact path (R-14a)** — `flows/<flowId>/scenario-<scenarioId>/hop-<paddedHopSeq>--<caseType>.test.ts`. Deterministic; regeneration overwrites the same path.

### 2.4 Relationships

```
Run (1) ── (1) Flow
Run (1) ── (1) Scenario      (scenarios are reusable across runs)
Run (1) ── (N) HopResult
Run (1) ── (N) TestResult
TestResult (N) ── (1) TestArtifact     (by artifactPath)
TestArtifact (1) ── (N) Contract       (one per participating service version)
```

---

## 3. API Surface

REST behind API Gateway with IAM/JWT auth. WebSocket endpoint for R-43.

### 3.1 REST endpoints

| Method | Path | Purpose | Returns |
|--------|------|---------|---------|
| `POST` | `/runs` | Trigger a run (R-26) | `{ runUuid, status: "pending" }` |
| `GET` | `/runs/{runUuid}` | Run summary (R-49) | Run + latest HopResults |
| `GET` | `/runs?status=&scenario=&classification=&from=&to=&cursor=` | Query (R-41) | `{ runs, nextCursor }` |
| `GET` | `/runs/{runUuid}/export?format=xlsx\|csv` | Download (R-42) | 302 → pre-signed S3 URL |
| `POST` | `/scenarios` | Submit NL scenario (R-19) | `{ scenarioId, status: "pending" }` |
| `GET` | `/scenarios/{scenarioId}` | Translation status | Scenario record |
| `POST` | `/flows` | Register a named flow (R-08) | `{ flowId }` or 400 `{ error: "unknown_service", svc }` (R-08a) |
| `GET` | `/flows` | List registered flows | Flow[] |

### 3.2 WebSocket — live dashboard (R-43)

```
wss://.../live
  client → server: { action: "subscribe", runUuid }
  server → client: { runUuid, hopSeq, state, ts } on every transition
```

### 3.3 Internal: Data Factory (called from generated test code at runtime)

```
POST /internal/data-factory/values
  body: { runUuid, contractRef, fields: FieldSpec[] }
  200:  { values: Record<string, unknown> }
  422:  { error: "data_generation", retriesExhausted: true }   -- per R-25
```

VPC-internal only; reachable from HopExecutors and Fargate tasks.

### 3.4 Selected payload shapes

```ts
type RunRequest = { type: "generation" | "execution"; flowId: string; scenarioId?: string };
type RunResponse = { runUuid: string; status: "pending"; correlationId: string };

type ScenarioRequest = { text: string; flowId: string };  // text ≤ 4000 chars (D4)
type ScenarioResponse = { scenarioId: string; status: "pending" };

type NamedFlowDef = { name: string; services: string[]; definitionRef?: string };
```

### 3.5 Internal event envelopes

EventBridge bus `e2e-test-generator`. Envelope shape:

```ts
type Envelope<T> = {
  eventId: string;
  eventType: string;             // e.g., "run.requested"
  occurredAt: string;            // ISO-8601 UTC
  runUuid?: string;
  correlationId: string;
  payload: T;
};
```

Event vocabulary: `run.requested`, `run.inputs.ready`, `run.aborted`, `flow.ready`, `flow.cycle-detected`, `scenario.ready`, `scenario.rejected`, `data.ready`, `tests.ready`, `tests.compile-failed`, `run.start`, `hop.started`, `hop.completed`, `hop.failed`, `hop.timeout`, `hop.event-received`, `run.completed`.

### 3.6 CLI

Thin wrapper over the REST API. Commands: `run`, `scenario submit`, `flow register`, `runs list`, `run show <uuid>`, `export <uuid>`. Auth via `aws sso` profile, SigV4-signed.

---

## 4. Tech Stack & NFR Mapping

| Layer | Choice | Why |
|-------|--------|-----|
| Language | TypeScript on Node 20 | Aligns with R-11 generated tests; one runtime for generator + tests; mature Playwright/AWS SDK support |
| IaC | AWS CDK (TypeScript) | Same language as application; native Lambda/EventBridge/DynamoDB constructs; NFR-04 IAM scoping via composable roles |
| Compute (short-lived) | AWS Lambda (Node 20) | All event handlers, API edge, Data Factory, classifier. NFR-09: account default concurrency far exceeds 10 |
| Compute (UI hops) | AWS Fargate | Playwright + Chromium needs persistent FS and >Lambda memory; one task per UI hop |
| Eventing | EventBridge bus + SQS DLQs | NFR-09 scale; SQS DLQs give visibility for R-12a/R-41a exhausted retries |
| Scheduling | EventBridge Scheduler | Per-service Watchdog timers (R-30) without a custom scheduler |
| Persistence | DynamoDB on-demand | NFR-11 TTL retention; GSIs cover R-41's four query dimensions; ms-latency reads for R-43 |
| Object storage | S3 | Payloads exceeding DynamoDB 400 KB item limit; export artifacts |
| LLM | Bedrock + Claude — Sonnet 4.6 (data + generation) + Opus 4.7 (R-20 scenario translation) | NFR-03 in-AWS retention boundary; prompt caching reduces cost on repeated contract-shaped prompts |
| Secrets | AWS Secrets Manager | NFR-02; rotation built-in |
| Observability | CloudWatch Logs + X-Ray; NFR-14 templates in SSM Parameter Store | NFR-12/13 satisfied; `traceparent` propagated via X-Ray (R-38) |
| UI automation + test framework | Playwright Test | OQ-08; doubles as the generated-test framework (see §7.7) |
| Tests repo | One private GitHub repo, generator-bot identity has write, humans read-only | Branch protection allows pushes only from the bot principal — enforces R-14 without a separate pre-receive hook |
| IdP | Existing OIDC IdP (Okta/Ping) | R-28 single token exchange + R-28a refresh |
| Dashboard | React SPA on S3 + CloudFront | Static hosting; SigV4-signed REST + WSS |

### NFR-by-NFR

- **NFR-01 / R-22a** — Bedrock prompts never receive real data. Static PII-pattern scan in CI on the seed-test extraction step blocks accidental prod data from reaching the LLM context (see §7.5 below).
- **NFR-02** — Secrets Manager + structured logger that redacts known-key fields. Banned-symbol lint pass rejects literals.
- **NFR-03** — Bedrock-only LLM path; no egress; verified via VPC endpoint policy. Model invocation logging *disabled*.
- **NFR-04** — One IAM role per Lambda/Fargate task, scoped to staging account + scoped resources. Tests-repo write is a separate role.
- **NFR-05** — Generated code reads endpoint URLs and tokens from env; tsc + lint rules reject literals.
- **NFR-06** — Bedrock Opus with prompt caching of contract context expected ≤ 30 s typical; 60 s timeout.
- **NFR-07** — Export Lambda renders xlsx/csv in background, pre-signs S3 URL; 30 s timeout.
- **NFR-08** — Ajv-compiled ODCS validators cached per contract version; expected single-digit-ms per hop.
- **NFR-09** — Lambda concurrency at default account limits supports ≫10 concurrent runs; DynamoDB on-demand auto-scales.
- **NFR-10** — Flow depth bounded by event-chain length, not runtime.
- **NFR-11** — DynamoDB TTL on Runs/HopResults/TestResults at 90 days.
- **NFR-12 / 13** — Structured JSON logs include runUuid + scenarioId + correlationId; CloudWatch Metrics emitted by classifier and run-end Lambdas.
- **NFR-14** — Per-service `failureLinkTemplate` in `ServiceConfig` table; CloudWatch Logs Insights URL filtered by correlation ID by default.

---

## 5. Integration Boundaries (each becomes an integration test)

| ID | Boundary | Protocol | Integration-test focus |
|----|----------|----------|------------------------|
| IB-01 | CLI ↔ API Gateway (REST) | HTTPS | Auth, error mapping |
| IB-02 | Dashboard ↔ API Gateway (REST) | HTTPS + CORS | List/query/export shapes |
| IB-03 | Dashboard ↔ API Gateway (WSS) | WebSocket | Subscribe, receive transitions, reconnect |
| IB-04 | API Lambda ↔ EventBridge | SDK | `run.requested` lands with correct envelope |
| IB-05 | Resolver ↔ Contract Registry | HTTPS | `released` tag resolves to a concrete version; 404 → R-06 abort |
| IB-06 | Resolver ↔ Internal Deployment Registry | HTTPS | Returns deployed version label per service (R-05a) |
| IB-07 | Resolver ↔ Service repos | Git over HTTPS | Clones at deployed-version commit (R-04) |
| IB-08 | Resolver ↔ UI-spec source | HTTPS | UI spec fetched only when `webUi: true` (R-03, D1) |
| IB-09 | FlowDiscovery ↔ Contract Registry lineage | HTTPS | Builds graph; rejects cycle (R-07a) |
| IB-10 | ScenarioTranslator ↔ Bedrock (Opus) | SDK | Translates NL; emits confidence + unresolvedReferences (D5) |
| IB-11 | DataFactory ↔ Bedrock (Sonnet) | SDK | Field validates against ODCS; retries on invalid (R-25) |
| IB-12 | TestGenerator ↔ Bedrock (Sonnet) | SDK | Emits compilable Playwright specs for happy/boundary/negative (R-16) |
| IB-13 | TestGenerator ↔ `tsc --noEmit` | Subprocess | Rejects non-compiling output before commit (R-18) |
| IB-14 | TestGenerator ↔ generated-tests repo | HTTPS Git | Direct push as bot identity (R-12); branch protection rejects non-bot pushes (R-14); retry on 5xx (R-12a) |
| IB-15 | HopExecutor ↔ IdP | OIDC | Single token per run (R-28); refresh-on-expiry (R-28a) |
| IB-16 | HopExecutor ↔ SUT API | HTTPS | ODCS outbound + inbound validation (R-31); 5xx → R-37 |
| IB-17 | HopExecutor (UI dispatcher) ↔ Fargate | ECS RunTask | Task launches; emits `hop.completed` |
| IB-18 | Fargate Playwright ↔ SUT UI | HTTPS browser | UI selector stability, navigation, timeout → R-37 |
| IB-19 | EventBridgeBridge ↔ SUT SNS/SQS/EventBridge | SDK subscribe | Subscription created BEFORE publishing hop (R-29); subscribe fail → R-29a |
| IB-20 | Watchdog ↔ EventBridge Scheduler | SDK | Timer fires at per-service timeout (R-30a) |
| IB-21 | HopExecutor ↔ FailureClassifier | EventBridge | All five categories classified; downstream skip cascade (R-37) |
| IB-22 | All Lambdas ↔ DynamoDB | SDK | Idempotent writes on `(runUuid, hopSeq)`; retry on throttle (R-41a) |
| IB-23 | Generated test ↔ Data Factory (run-time) | HTTPS REST in-VPC | Field generation with run-UUID embedding; retry exhaustion (R-25) |
| IB-24 | Export Lambda ↔ S3 | SDK | Pre-signed URL; 30 s render bound (R-42a, NFR-07) |
| IB-25 | All Lambdas ↔ CloudWatch Logs | SDK / OTel | Mandatory fields (NFR-12); `traceparent` propagation (R-38) |
| IB-26 | FailureLink resolver ↔ SSM | SDK | Per-service template resolves to a URL (NFR-14) |
| IB-27 | All secrets-consuming code ↔ Secrets Manager | SDK | No literal secrets in logs or generated code (NFR-02, NFR-05) |

---

## 6. Failure Modes per Boundary

| IB | Failure | Classification | Response |
|----|---------|----------------|----------|
| IB-05 | Contract Registry 404 / unreachable | n/a (pre-run) | Abort run; `run.aborted` event names artifact (R-06) |
| IB-05 | Registry returns no `released` tag for a service | n/a (pre-run) | Abort run with reason `no_released_tag` (R-06) |
| IB-06 | Deployment registry missing version | n/a (pre-run) | Abort (R-06) |
| IB-07 | Clone failure / commit not found | n/a (pre-run) | Abort (R-06) |
| IB-08 | UI spec 404 on UI-bearing service | n/a (pre-run) | Abort (R-06) |
| IB-08 | UI spec 404 on non-UI service | n/a | Continue (D2) |
| IB-09 | Lineage cycle | n/a (pre-run) | Abort; cycle path in report (R-07a) |
| IB-10 | Bedrock throttle | n/a | SDK backoff; on exhaustion reject scenario with `llm_unavailable` |
| IB-10 | Translation low-confidence or unresolved refs | n/a | Reject scenario; structured explanation (R-21, D5) |
| IB-11 | Bedrock value fails ODCS | `data-generation` after 3 retries | R-25 |
| IB-12 | TestGenerator Bedrock error / malformed output | `test-bug` on (hop, scenario); other pairs continue | R-11a |
| IB-13 | Compile error | `test-bug` | R-18; no commit |
| IB-14 | Git push 5xx / network | `infrastructure-failure` after bounded retry | R-12a |
| IB-14 | Branch protection rejects (human attempted modification) | n/a | Log + run-report entry; no retry (see §7.1) |
| IB-15 | IdP exchange fails | `infrastructure-failure` for all hops | R-28 |
| IB-15 | Refresh fails mid-run | `infrastructure-failure` on remaining hops | R-28a |
| IB-16 | SUT 5xx / unreachable | `infrastructure-failure`; downstream `skipped` | R-37 |
| IB-16 | Outbound payload invalid | `contract-violation`; not sent | R-31, R-35 |
| IB-16 | Inbound schema-invalid | `contract-violation` | R-35 |
| IB-16 | Inbound schema-valid but rule-invalid | `business-rule-violation` | R-36 |
| IB-17 | Fargate `RunTask` fails | `infrastructure-failure` | R-37 |
| IB-18 | Playwright cannot reach base URL | `infrastructure-failure` | R-37 |
| IB-18 | Selector not found / unexpected page state | `infrastructure-failure` | R-37 (treat as env misconfig per E-10) |
| IB-19 | Subscribe fails | `infrastructure-failure`; downstream `skipped` | R-29a |
| IB-19 | Event arrives after Watchdog fires | Treated as not-arrived | R-37; discarded by run-correlation filter |
| IB-20 | Watchdog fires before event | `infrastructure-failure` on hop; downstream `skipped` | R-37 |
| IB-22 | DynamoDB throttle / 5xx | Bounded retry; critical alert on exhaustion | R-41a |
| IB-23 | Data Factory retries exhausted | `data-generation` | R-25 |
| IB-24 | Export render > 30 s | n/a | Cancel + structured error | R-42a, NFR-07 |
| IB-25 | CloudWatch Logs write fails | n/a | Best-effort; fallback to stderr; do not fail run |
| All | Unhandled Lambda exception | `infrastructure-failure` | DLQ + CloudWatch alarm; run marked `aborted` |

**Skip cascade (R-37)**: when FailureClassifier marks a hop as `infrastructure-failure`, it publishes `hop.failed` with `cascadeSkip: true`. Downstream HopExecutors observe the flag via the runUuid event-history index and write `state: skipped, reason: upstream-infra-failure` without invoking the SUT.

---

## 7. Spec items I cannot implement cleanly — surfacing now

These are real tensions hit during design. Each needs a tiebreaker before code.

### 7.1 R-14 conflicts with R-12's own commits

R-14 says the repo SHALL reject changes to `@generated` files. R-12 is the generator pushing to those files.

**Resolution**: scope R-14 by identity. Branch protection allows pushes to `main` only from the generator-bot's IAM-mapped principal (e.g., a GitHub App ID). Humans, including admins, cannot bypass. Effective wording: *"…SHALL reject the change unless authored by the generator's bot identity."* Recommend a spec edit.

### 7.2 R-15 regeneration scope is under-specified when scenarios span hops

R-15 says regenerate "that specific test file" when "any ODCS, OpenAPI, or UI specification version referenced by a generated test changes." Each scenario produces files per (hop, caseType). If service B's OpenAPI changes:
- Strict reading: regenerate only the hop-B files for every scenario.
- Loose reading: regenerate every file referencing service B.

**Resolution**: strict. `TestArtifacts.sourceContractVersions` is the authoritative dependency map; regenerate exactly the artifacts whose map mentions a changed version. Document as the canonical R-15 interpretation.

### 7.3 ODCS-vs-OpenAPI version skew (R-01 ↔ R-02/R-04)

R-01 fetches the **`released`-tagged** ODCS from the registry. R-02 and R-04 fetch OpenAPI and source from the **deployed-version commit**. These can diverge.

Concrete failure: service A's ODCS is at v1.5 (released), deployed code is v1.3. A generated test exercises a v1.5-only field. R-31 fires `contract-violation` every run — not because the SUT is broken, but because the contract is ahead of the code.

**Options**:
- **(a)** Accept the divergence as a feature: persistent `contract-violation` is the system telling teams "your deployed code lags your contract." Strong interpretation of R-01.
- **(b)** Tolerate it: if the deployed service responds successfully under its deployed ODCS version, treat as pass with informational note. Adds complexity.
- **(c)** Reverse R-01: fetch ODCS at deployed commit. Removes the drift signal but eliminates false-positive class.

**Recommendation**: (a) plus a new requirement — when a service's deployed ODCS version is behind the registry's latest, surface that in the run report as a non-fatal annotation, so users see drift explicitly rather than just repeated `contract-violation`s.

### 7.4 R-43 needs a real-time push channel; spec doesn't say push or poll

R-43 implies near-real-time updates. The spec is silent on transport.

**Resolution**: WebSocket push. HopExecutors publish state transitions to API Gateway WSS keyed by runUuid. Already in the design (§1.4, §3.2). Recommend a spec sentence to make this explicit; if you prefer cheaper, polling at ≥3 s intervals also works but loses live feel.

### 7.5 R-22a "no production data" vs R-05 seed-test extraction

R-05 extracts service-team tests as "seed-only" pattern hints (E-08 flags they may contain realistic data). R-22a prohibits reading any source containing real data. If a service-team test contains a real student ID checked in by mistake, R-22a is transitively violated.

**Resolution**: add **NFR-15** — a fail-closed static PII-pattern scan runs on every seed-test body before it's used as Bedrock prompt context. Patterns: SSN-shaped, real student-ID format, names from a curated College Board real-data corpus. On detection, the seed is dropped and the run continues; on chronic detection per service, an alert fires. Needs your approval.

### 7.6 R-28 single-token vs long async waits

R-28 mandates one IdP exchange per run; R-28a allows one refresh before the next hop. With 10-hop flows and per-hop waits up to R-30 timeouts, total run wall-time can exceed token TTL multiple times. Spec wording handles per-hop boundaries but not waits *within* a hop.

**Resolution**: proactive refresh at hop-start if token TTL < hop timeout + safety margin. Counts as "refresh before the next hop." On refresh failure, classify remaining hops as `infrastructure-failure` per R-28a. No spec change needed.

### 7.7 Generated-test runtime model — spec is implicit

Spec says tests "compile and run" and that the Orchestrator traverses services in topological order, but doesn't say *who* runs them.

**Resolution**: each generated `.test.ts` is a **Playwright Test spec** with a tag identifying its (flow, scenario, hop). Each HopExecutor invokes `npx playwright test --grep <hop-id>` against a checked-out commit of the generated repo. The HopExecutor is the runtime; Playwright Test provides the assertion library, fixtures (request/page), and reporter API. Hop ordering is enforced by the event chain (`hop.completed` → next HopExecutor), not by Playwright's runner. This preserves developer ergonomics (a dev can `npx playwright test` the generated repo locally for a full run) and the event-driven choreography.

### 7.8 R-32 vs R-33: per-service or per-interaction driver?

R-32 says "WHERE a service is registered as exposing a Web UI…drive the hop via UI-automation." R-33 says "WHERE a service exposes only an API…drive via HTTP." But a hop is an interaction *between* two services. If service A is API-only and triggers service B (which has a UI), the hop "A → B" needs HTTP to call A and UI driver to verify B's post-conditions.

**Resolution**: reinterpret R-32/R-33 as **per-interaction**, not per-service. Each hop has an inbound interaction (how we send it) and an outbound observation (how we verify side-effects). Driver choice depends on direction-and-target, not a global service property. Recommend rewriting R-32/R-33 along these lines.

### 7.9 Data Factory: design-time or run-time?

R-23 says "WHEN the Data Factory generates a value…" but never says *when*. Two readings:
- **Design-time baking** — simpler runtime, but R-24 requires the *run* UUID embedded, which the generator doesn't know.
- **Run-time fetching** — naturally satisfies R-24, but Data Factory is on every test's critical path.

**Resolution**: run-time. Generated tests call `await dataFactory.value('customer.id')`; the Data Factory Lambda materializes the value at run time with the current run UUID prefix. The internal endpoint is in §3.3. Recommend making this explicit as a new R-23a.

### 7.10 R-13 header tracks contract version; R-15 ignores generator version

R-13 records `generator version`. R-15 regenerates only on *spec* change. If we upgrade the generator (better prompts, bug fixes), no test regenerates — tests drift relative to the generator.

**Resolution**: extend R-15 trigger to include `generatorVersion ≠ current` as a regeneration condition, on a slow cadence (e.g., once per generator minor-version bump). Bounded by a "max regenerations per run" guard to prevent thundering herds.

### 7.11 OQ-13 "thin internal" dashboard does non-trivial UI work

R-43 live progress + R-42 export + R-49 per-scenario detail together imply ~4 routes and a real polling/WSS layer. "Thin" is doing a lot of work.

**Resolution**: accept thin = "internal-only, no brand polish, no UX design pass." Four screens: Runs list, Run detail (R-49), Live progress (R-43), Submit scenario (R-19). Export is a button on Run detail, not a separate screen.

---

## 8. Out-of-scope reminders (spec §3)

This design does **not** include: near-neighbor unit tests, production execution, real-PII handling, human editing of generated tests, or deferred items in spec §2 (additional flows, scheduled runs, SLA assertions, vendor coverage, human-test integration, notifications, multi-env promotion, automated cleanup/wipe).

---

## 9. Decisions still pending implementation kickoff

| ID | Question | Recommendation |
|----|----------|----------------|
| D-01 | §7.3 ODCS-vs-OpenAPI skew | Accept divergence; add drift annotation to run reports |
| D-02 | §7.5 PII scan (NFR-15) | Yes — fail-closed `pii_pattern_detected` |
| D-03 | §7.4 R-43 WSS push (vs poll) | WSS push |
| D-04 | §7.7 generated tests = Playwright Test specs | Yes |
| D-05 | §7.8 R-32/R-33 per-interaction rewrite | Yes |
| D-06 | §7.9 Data Factory at run-time, add R-23a | Yes |
| D-07 | §7.10 generator-version triggers regeneration | Yes, slow cadence |
| D-08 | §7.11 dashboard scope = 4 screens | Yes |

Plus operational details to confirm during kickoff (not architecturally blocking):
- Exact internal deployment registry endpoint + auth
- Final ODCS extension-property name for event channels
- SSM parameter naming convention for NFR-14 templates
- GitHub App identifier for the generator bot principal

---

## Approval checklist

Before any code is written, please confirm or override:

1. The 10 decisions in §0.
2. The 8 D-01..D-08 design decisions in §9.
3. The architecture in §1 (event-driven choreography, two lifecycles, Fargate for UI hops only).
4. The DynamoDB schema in §2.1.
5. The API surface in §3.
6. The default-accepted answers from prior open-questions triage (R-19a=4000, R-25 retries=3, traceparent header, 5-category taxonomy, etc.).

Once approved, I'll update `spec.md` to absorb the new requirements (NFR-15, R-23a, R-32/R-33 rewrite, R-43 transport clause, R-14 identity scope) and propose milestone scoping.
