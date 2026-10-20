# CLAUDE.md — awp-end-to-end-testing

## What this project is

The **ODCS Contract Registry** — a serverless AWS application that crawls `awp-app-plane` (GitHub API) for ODCS v3.1.0 contracts and EARS requirements, validates and catalogs them in DynamoDB, and generates contract-driven and LLM-synthesised cross-service end-to-end tests via Amazon Bedrock.

See `specs/docs/system-design/overview.md` for the full picture.

---

## Stack

- **Language:** TypeScript (strict), Node.js 22 arm64, pnpm workspaces
- **Infra:** AWS via SST v2 (CDK-based)
- **Key services:** Lambda (arm64), DynamoDB on-demand single-table + 2 GSIs, S3 (raw artifact storage), API Gateway HTTP API, Cognito (user auth + Lambda authorizer), Bedrock (`claude-sonnet-4-6` via forced tool use)
- **GitHub integration:** `@octokit/rest` — crawls `awp-app-plane` for ODCS contracts and EARS requirements
- **Validation:** `ajv ^8.17.1` + `ajv-formats` + `js-yaml` — ODCS YAML → JSON Schema validation
- **Frontend:** React ^18 + Vite ^5 SPA (`packages/web/`)

## Package layout

| Package | Role |
|---|---|
| `packages/core/` | Shared types, utilities, constants |
| `packages/functions/` | Lambda handlers: crawl, validate, catalog, read API, Cognito authorizer |
| `packages/testgen/` | Contract-driven Vitest file generator (`@registry/testgen`) |
| `packages/functest/` | LLM-synthesised functional test runner (`@registry/functest`) |
| `packages/web/` | React + Vite SPA (catalog browser, test generation UI) |
| `stacks/` | SST v2 IaC definitions |
| `generated-tests/` | **Machine-generated** Vitest files — never edit manually |

## Architecture rules

- Lambda handlers are thin — business logic belongs in `packages/core/` or the relevant package
- DynamoDB uses single-table design — see `specs/docs/data-model/`
- Source data is read-only via GitHub API — never write back to `awp-app-plane`
- Cognito auth: Lambda authorizer verifies access tokens (`aws-jwt-verify`), SPA uses native SRP sign-in
- Generated tests (`generated-tests/**`) are machine-generated artifacts — treat as outputs, not sources
- Bedrock calls use forced tool use (`InvokeModel`) — see `specs/docs/integrations/bedrock.md`

## Testing

**Framework:** Vitest across five tiers:

| Tier | What | Location |
|---|---|---|
| `[unit]` | Pure logic + mocked AWS SDK | `packages/*/tests/*.test.ts` |
| `[infra]` | CDK template assertions (offline synth) | `stacks/tests/*.test.ts` |
| `[web]` | jsdom + stub fetch | `packages/web/tests/*.test.ts` — own vitest config |
| `[gen-unit]` | testgen over catalog fixtures, no AWS | `packages/testgen/tests/*.test.ts` |
| `[llm-unit]` | functest with stubbed LlmClient | `packages/functest/tests/*.test.ts` |

- `vitest.setup.ts` stubs SST resource bindings for offline tests
- Stack tests: `fileParallelism: false` (SST registry is process-global)
- Run: `vitest run` for unit/infra/gen-unit/llm-unit; `npm run test:web` in `packages/web/` for web tier

---

## Spec-Driven Development (SDD)

Before implementing any non-trivial feature, a spec must exist in `specs/active/<slug>/`.

**Non-trivial** = touches multiple files or requires design decisions. Skip SDD for patches and one-liners.

- Check `specs/active/` at the start of any feature work — if a spec exists, follow it
- Check `specs/pending/` — if a stub exists, use `/start-feature` to promote it
- Do not implement work that contradicts an active spec without flagging it first
- `tasks.md` is the source of truth for task progress
- The spec is the oracle: if code and spec disagree, fix the code (or update the spec explicitly and record the change in the decisions log)

**Docs placement:**
- `README.md` + `docs/` — human-facing: overviews, guides, architecture explanations, diagrams (`docs/diagrams/`).
- `specs/docs/` — LLM/agent-facing: terse reference files the SDD agents look up. Index `specs/docs/README.md`.
- Don't mix them. Feature changes usually need both, written for each audience. The `tech-writer` agent owns these updates at close-out.

**Commands:**
- `/stub-requirement <idea>` — fast capture to `specs/pending/` without starting SDD
- `/start-feature` — full SDD flow from intake through implementation
- `/resume-feature <slug>` — continue an in-progress spec from its last approval gate
- `/health-check <slug> [HC-n ...]` — drift audit (HC-1–HC-5) and reconcile spec ↔ design ↔ tests ↔ code

**Reference docs** (look these up when relevant):
| Doc | Contents |
|---|---|
| `specs/docs/sdd/README.md` | SDD lifecycle, EARS format, decisions log |
| `specs/docs/sdd/subagents.md` | 7-stage agent pipeline |
| `specs/docs/sdd/fit-check.md` | Stage 0: when to use SDD, gap discovery prompt |
| `specs/docs/sdd/health-check.md` | HC-1 through HC-5 periodic drift audit prompts |
| `specs/docs/system-design/overview.md` | What the system does |
| `specs/docs/system-design/architecture.md` | AWS infra, packages, key design choices |
| `specs/docs/system-design/api-surface.md` | REST API surface |
| `specs/docs/data-model/` | DynamoDB single-table design |
| `specs/docs/integrations/bedrock.md` | Bedrock/LLM synthesis patterns |
| `specs/docs/integrations/github.md` | GitHub API crawl patterns |
| `specs/docs/integrations/cognito.md` | Auth patterns |

**Spec registry:** `specs/registry.yaml` — authoritative index of every spec (pending, active, archived). Agents must update it when creating stubs, promoting specs, or archiving completed features.
