# SDD Subagent Pipeline

The SDD workflow maps to a pipeline of specialized subagents. Each is scoped to one stage, reads only what it needs, and produces a single deliverable. Run stages sequentially; within a stage some agents can be parallelized.

---

## Stage 0 — Gap Discovery (pre-stub)

**Not a subagent — a human step.**

Before opening a stub file, run the gap discovery prompt from [fit-check.md](fit-check.md) in a Claude chat. Answer Claude's questions, then write the stub incorporating everything you learned. Every unanswered question becomes an open question in the stub.

**Output:** a stub with pre-surfaced open questions rather than a blank slate.

---

## Stage 1 — Requirements

**Agent: `requirements`** → invoke as `.claude/agents/planner.md` (requirements mode)

Takes a stub (`pending/<slug>/stub.md`) and produces `active/<slug>/requirements.md`.

Responsibilities:
- Expand the stub into full EARS requirements (`**R-nn** SHALL/WHEN/IF…`)
- Organize under `### 3.x` sub-sections
- Write NFRs, edge cases table, and open questions
- Record each non-obvious decision in the decisions log (`D-n`)
- Version the spec header
- After drafting: audit each requirement for EARS compliance — flag ambiguous ones, rewrite in strict EARS format, and generate GIVEN/WHEN/THEN test skeletons for each (flag any requirement that can't be expressed as GIVEN/WHEN/THEN; those need rewriting before design begins)

Inputs: `stub.md`, relevant system-design docs from `specs/docs/`
Output: `requirements.md` with EARS-validated requirements and test skeletons

---

## Stage 2 — Design

**Agent: `design`** → invoke as `.claude/agents/planner.md` (design mode)

Takes `requirements.md` and produces `active/<slug>/design.md`.

Responsibilities:
- For each significant technical decision: enumerate build options and buy/reuse options (existing packages, services, patterns in the codebase)
- Weigh trade-offs explicitly — don't just pick one; show the reasoning
- Derive the architecture, data models, API surface, and integration boundaries
- Map every requirement to at least one component
- Surface spec conflicts or design risks (flagged, not silent)
- Reference existing patterns from `specs/docs/system-design/` and `specs/docs/integrations/`

Inputs: `requirements.md`, `specs/docs/system-design/`, `specs/docs/integrations/`, `specs/docs/data-model/`
Output: `design.md`

---

## Stage 3 — Planning

**Agent: `planner`** → invoke as `.claude/agents/technical-planner.md`

Takes `requirements.md` + `design.md` and produces `active/<slug>/tasks.md`.

Responsibilities:
- Write ordered implementation tasks (`T-nn`) with explicit `Deps:`, `Satisfies:` (requirement ids), and `Done when (AC)` fields
- Every `T-nn` gets a paired test task `T-nna` immediately after it — never separate them
- Golden rule: **write failing tests first**, get approval, then implement
- Group tasks into parallelization phases so independent work can be delegated to separate sessions
- Scope-creep check: every task must trace to a requirement or be explicitly labelled `enabling`

Inputs: `requirements.md`, `design.md`
Output: `tasks.md`

---

## Stage 4 — Adversarial Review

**Agent: `reviewer`** → invoke as `.claude/agents/reviewer.md` (pre-implementation mode)

Reviews design + tasks against requirements. **Only surfaces real gaps or major risks** — not nitpicks, not style, not hypothetical edge cases already covered.

Responsibilities:
- Verify every requirement is addressed by at least one task
- Check that design failure modes are handled (not just happy paths)
- Flag missing test tasks, skipped ACs, or requirements with no design coverage
- Flag scope creep (tasks with no tracing requirement)
- Identify integration boundary risks not already called out in design

Inputs: `requirements.md`, `design.md`, `tasks.md`
Output: a short list of confirmed gaps/risks — or "no blockers found"

---

## Stage 5 — Implementation

**Agent: `implementer`** → invoke as `.claude/agents/implementer.md`

Takes a task (or parallelization phase) from `tasks.md` and implements it.

Responsibilities:
- Write failing tests first (`T-nna`), verify they fail for the right reason, then implement `T-nn` until tests pass
- One task ≈ one Claude session — don't combine multiple unrelated tasks
- Keep changes minimal: implement what the task says, no extras
- Run `typecheck` and `test:offline` before reporting done
- After each task: check for spec drift — did the implementation require deviations? Were any edge cases discovered that aren't in the spec? Report these before starting the next task so requirements.md stays current.

Inputs: specific `T-nn`/`T-nna` task pair, `requirements.md` (relevant section), `design.md` (relevant section)
Output: passing tests + implementation + drift report (empty if no drift)

---

## Stage 6 — Implementation Review

**Agent: `impl-reviewer`** → invoke as `.claude/agents/reviewer.md` (post-implementation mode)

Adversarial review of the implementation after a phase is complete.

Responsibilities:
- Run code review on the diff
- Verify each AC claimed in the tasks actually passes
- Check for security issues: injection, missing auth checks, secrets in logs
- Flag correctness bugs only — not style issues
- Report: ACs verified, any failing ACs, any bugs found

Inputs: diff + `tasks.md` (ACs for the phase) + `requirements.md` (relevant requirements)
Output: a short verified-pass list or list of bugs requiring a fix

---

## Stage 7 — Technical Writer

**Agent: `tech-writer`** → `.claude/agents/tech-writer.md` (launched in `/start-feature` Phase 7 close-out)

Updates documentation after a feature ships.

Responsibilities:
- Update `specs/docs/` agent-facing reference files affected by the new feature (system-design, data-model, integrations) — terse, LLM-oriented
- Update human-facing documentation (`README.md`, `docs/` diagrams) — narrative, written for people
- Keep the two trees separate: never put tutorials/diagrams in `specs/docs/` or agent lookup tables in `README.md`/`docs/`
- Update `specs/registry.yaml` — move completed specs to `archive`, add `needed_by`/`depends_on` links
- Files should stay under ~200 lines — split if needed, update the README/index

Inputs: merged diff, `specs/active/<slug>/` full set of docs
Output: updated `specs/docs/` and `docs/` files

---

## Parallelization

```
[gap discovery] → stub.md
  └── [requirements] → requirements.md (EARS-validated + test skeletons)
        └── [design] → design.md
              └── [planner] → tasks.md
                    ├── [reviewer] → gaps report          ← can run while planner writes tasks
                    └── [implementer × N phases]          ← phases run sequentially, tasks within a phase in parallel
                          └── [impl-reviewer] → pass/bug report
                                └── [tech-writer] → updated docs
                                      └── [health-check] → drift report (periodic)
```

Stages 0–4 (spec work) are sequential. Stages 5–6 repeat per parallelization phase. Stage 7 runs once after all phases are done (or incrementally per phase for long features). Health checks are gates, not optional: scoped HC-1 + HC-2 at the end of each phase, the full HC-1–HC-5 at close-out (`/health-check`), plus periodic out-of-band runs.
