# Adversarial Review: design and flow of events

> Overview as of 2026-10-09 (spec v0.8.0). The sources of truth are `specs/active/odcs-contract-registry/requirements.md` §3.12 (in-product stage), `specs/active/odcs-contract-registry/design.md` §12, and `.claude/skills/adversarial-review-spec.md` (Claude Code skills). If this file disagrees with them, they win.

## 1. Purpose

Attack generated end-to-end tests, and the code that generates them, **before a human reviews them**, looking for defects, broken logic, and tests that would pass against a broken system. All reviewers share one persona (D-75):

> You are an adversarial reviewer with a single job: find defects, broken logic, and reasons this code will fail. Do not praise or suggest improvements.

Reviewers **report only**. They never edit, commit, push or post.

## 2. Architecture: three layers

```
┌──────────────────────── DEPLOYED REGISTRY: in-product stage (spec §3.12) ────────────────────┐
│  POST /generate-tests (§3.9)               POST /generate-functional-tests (§3.11, async)    │
│        │                                            │                                         │
│   testgen core ──► reviewTestgen             functest core ──► reviewFunctional               │
│   (roles from ENTITY_FLOWS, R-84b)           (ground → LLM plan → stamp, R-117c)              │
│        │  deterministic:                            │  deterministic + critic:                │
│        │  • vacuity (R-134)                         │  • grounding (R-133)                    │
│        │  • mutation, manifest tier (R-135)         │  • vacuity (R-134)                      │
│        │                                            │  • static mutation (R-136)              │
│        │                                            │  • LLM critic, Opus, report-only        │
│        ▼                                            ▼                                         │
│   manifest + `adversarial` block             deterministic Critical → plan WITHHELD;          │
│   (§3.9 never withheld)                      others emitted; manifest + block + report        │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
                    │  GET /test-artifacts · GET /functional-test-jobs
                    ▼
┌──────────────────────── LOCAL CLI: npm run generate-tests (R-144) ───────────────────────────┐
│  download → executed-tier mutation (real Vitest run of compat files) → write generated-tests/ │
│  → adversarial-reports/<id>/report.{md,json} (git-ignored) → print verdicts                   │
│  → "review git diff" reminder → ## ADVERSARIAL REVIEW HANDOFF                                  │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
                    │  the repo CLAUDE.md chains on the handoff block
                    ▼
┌──────────────────────── CLAUDE CODE SKILLS: local tooling (D-83) ────────────────────────────┐
│  adversarial-test-review  (automatic after generate-tests)                                    │
│  adversarial-code-review  (on demand, e.g. before a PR)                                       │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Design rules

| Rule | Why |
|---|---|
| **Only deterministic findings gate** (D-73). The critic is report-only. | Keeps output byte-identical across runs (R-88, R-119a). The user declined critic gating twice. |
| **§3.9 tests are never withheld.** A generator defect is a Critical finding against `packages/testgen`. | A defect in the generator is not a defect in one test. |
| **§3.11 plans with a deterministic Critical are withheld** (R-129). They stay cached; there is no repair loop (D-82). | Bounds cost, preserves the no-op diff, and keeps the human in charge of fixes. |
| **Roles come from one declared source,** `ENTITY_FLOWS` in `packages/core/src/api-map.ts` (D-84). The order is: declared flow, then literal `publisher`/`consumer` labels, then skip. | The generators and the mutation oracle agree, and a role bug cannot mark its own homework. Alphabetical inference is gone. |
| **Field map only for real renames** (D-85). `TaskPublished` declares none. | The live contracts (2026-10-09) use the same names on both sides. |
| **Nested properties are compared** by dotted path, e.g. `items[].itemId` (D-86). | A dropped nested field used to pass both compat and conformance. |
| **Trigger write paths stay ungrounded**, and R-133e stays Major (D-88). | User decision on OQ-15. |

## 3. In-product attacks (`packages/adversary`)

| Attack | Applies to | What it catches | Severity |
|---|---|---|---|
| Grounding (R-133) | §3.11 plans + emitted files | Fields absent from the contract (a), payload keys (b), non-verbatim clauses (c), wrong env vars (d), unmapped paths (e) | (a)–(d) Critical, (e) Major |
| Vacuity (R-134) | §3.9 and §3.11 | Only a `res.ok` check, `it.todo`, a missing body, no bounded wait, tautologies, conformance green on `[]` | Critical / Major |
| Mutation, §3.9 (R-135) | compat tests | M1 drop, M2 retype, M3 rename, M4 new required field; C1 control. Runs the same generator core and must go red (C1 must stay green) | Surviving mutant = Critical |
| Mutation, §3.11 (R-136) | plans | MP-drop / corrupt / type, M-noprop; score vs threshold 0.5 (D-77) | M-noprop Critical, low score Major |
| LLM critic (R-137…R-142) | §3.11 plans | Blind pass, then reconcile pass, then posture lint; cached; failures isolated | Report-only |

## 4. Claude Code skills

### 4.1 Components

| Part | Path |
|---|---|
| Shared spec: persona, finding format, lint, verdict, layout | `.claude/skills/adversarial-review-spec.md` |
| Orchestrators | `.claude/skills/adversarial-test-review/SKILL.md` (v0.5), `.claude/skills/adversarial-code-review/SKILL.md` (v0.2) |
| Agents (model fable) | `.claude/agents/adversarial-{test,code}-blind.md` (no shell), `.claude/agents/adversarial-{test,code}-reconcile.md` (read-only shell) |
| Deterministic finalize step | `scripts/adversarial-review-finalize.ts` |
| Run output (git-ignored) | `.adversarial-review/{YYYYMMDD-HHMM}_{test|code}_{branch}/` |

### 4.2 Flow: `adversarial-test-review`

```
generate-tests prints the handoff block (generated_dir, in_product_reports, run, functional_job)
  │
  ▼ Step 1 — Preflight (main conversation)
  │   • generated-tests/manifest.json exists?                       no → stop
  │   • keep only the in_product_reports that exist
  │   • create run_dir
  │   • finalize.ts blind-inputs → ONLY requirement ids, contract ids/hashes, entity names
  │   • optional (non-prod only): fetch live contracts/requirements into run_dir/sources
  │
  ▼ Step 2 — Pass 1: adversarial-test-blind   (no shell; never opens generated-tests/ or generators)
  │   reads spec §3.9/§3.11/§3.12 + contracts → expected-behaviours.md
  │   (X-nn behaviours, G-nn generator obligations, each with a verbatim quote + location)
  │   orchestrator checks: file exists, no "BLIND PASS COMPROMISED"          fail → stop
  │
  ▼ Step 3 — Pass 2: adversarial-test-reconcile   (fresh agent)
  │   reads Pass 1, generated-tests/**, packages/testgen|functest/src, in-product reports
  │   mandatory checks:
  │     • every unmapped trigger/read-back path → its own R-133e Major finding
  │     • assertion on a field absent from the target contract → R-133a Critical
  │       (the field map never makes a publisher-side name valid on the consumer)
  │     • counts computed, never estimated; rule ids in evidence
  │   disagreements with in-product findings → needsDecision (AR-07)
  │   → review.raw.json
  │
  ▼ Step 4 — finalize.ts finalize   (deterministic)
  │   refuses if Pass 1 is missing, compromised, or newer than Pass 2
  │   posture lint → F-nn / D-nn ids → verdict → review.json + review.md
  │
  ▼ Step 5 — Report: verdict, counts, Needs your decision, Critical findings. No fixes unless asked.
```

### 4.3 Flow: `adversarial-code-review`

```
user request (range defaults to main...HEAD)
  │
  ▼ Preflight: validate the range (never fall back to the whole repo); changed files minus
  │   generated-tests/ and pnpm-lock.yaml; empty → stop; spec ids per path from design.md/tasks.md only
  ▼ Pass 1: adversarial-code-blind      sees file NAMES + spec ids only → expected-behaviours.md
  ▼ Pass 2: adversarial-code-reconcile  git diff + full changed files + Pass 1
  │   checks: spec contradictions; invariants (R-88/R-119a determinism, NFR-4, D-21, NFR-2);
  │           unhandled errors; tests green against broken code; paired-test rule (T-nn ↔ T-nna)
  ▼ finalize.ts → review.md → report
```

### 4.4 Verdict (first match wins)

| Verdict | Condition |
|---|---|
| FAIL — Critical | ≥ 1 Critical |
| FAIL — Major | ≥ 1 Major |
| PASS WITH NOTES | Minor only |
| PASS | No findings |

"Needs your decision" items are listed first and never change the verdict. A finding with no evidence is kept, tagged `unevidenced` (D-79).

## 5. Integrity safeguards

| Safeguard | Protects against |
|---|---|
| The blind agent has no shell, and its inputs are filtered by `blind-inputs` | The reviewer agreeing with what it reads |
| Separate fresh agents run in sequence, never in parallel (AR-02) | Context leaking from Pass 2 into Pass 1 |
| Persona, model and tools fixed in the agent files | Per-run prompts loosening the rules |
| `BLIND PASS COMPROMISED` marker and the finalize ordering check | A blind pass that was contaminated or written late |
| Same posture lint as the in-product critic | Inconsistent judging between the product and the skills |
| Calibration answer key, re-run after agent or spec §5–§7 changes (AR-10, AR-14) | Silent loss of recall |

## 6. Calibration status

| Run | Result | Notes |
|---|---|---|
| Test review v0.3 (T-50a) | 77% strict | Missed the unmapped trigger; rated seed 4 too low |
| Test review v0.4 (T-56) | 83% strict, 92% defect-level | Seed 4 regressed because of check-2 wording; fixed in v0.5, re-run deferred to T-49 |
| Code review v0.2 (T-51a) | 3/3 planted defects, all Critical, plus the paired-test violation | The commit title leaked to the blind pass; small diff |

Results files: `packages/adversary/tests/__fixtures__/calibration/results_*.md`. Live contract snapshot: `calibration/live-20261009/`.

## 7. Open items

- **T-49:** deploy to stage `pkatakam`, live generation, critic calibration, no-op re-run check, and the deferred test-review v0.5 calibration. Blocked on AWS: profile `cb-e2etest-nonprod-dev` needs MFA entered in a terminal outside Claude Code, and org policy blocks Claude from running CDK deploys.
- **Untriaged generator findings:** two Critical `undefined === undefined` false-pass bugs in `packages/functest/src/emit.ts` (the `equals` render and the `pollUntil` match).
- **Web suite:** loads since the scoped `'jsdom>undici': 7.30.0` override. Three stale divergence tests fail; this predates the work, because the logic moved to `applyEntityDivergence`.
- **Live contracts:** `TaskPublished` items sit in a separate `TaskPublishedItem` schema object, which nested comparison (D-86) does not follow. A field map could instead be derived from the contracts' `transformSourceObjects`.
