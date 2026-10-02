# SDD Subagent Pipeline

The SDD workflow maps to a pipeline of specialized subagents. Each is scoped to one stage, reads only what it needs, and produces a single deliverable. Run stages sequentially; within a stage some agents can be parallelized.

---

## Stage 1 — Requirements

**Agent: `requirements`**

Takes a stub (`pending/<slug>/stub.md`) and produces `active/<slug>/requirements.md`.

Responsibilities:
- Expand the stub into full EARS requirements (`**R-nn** SHALL/WHEN/IF…`)
- Organize under `### 3.x` sub-sections
- Write NFRs, edge cases table, and open questions
- Record each non-obvious decision in the decisions log (`D-n`)
- Version the spec header

Inputs: `stub.md`, relevant system-design docs from `specs/docs/`
Output: `requirements.md`

---

## Stage 2 — Design

**Agent: `design`**

Takes `requirements.md` and produces `active/<slug>/design.md`.

Responsibilities:
- For each significant technical decision: enumerate **build options** (different implementation approaches) and **buy/reuse options** (existing packages, services, patterns already in the codebase)
- Weigh trade-offs explicitly — don't just pick one; show the reasoning
- Derive the architecture, data models, API surface, and integration boundaries
- Map every requirement to at least one component
- Surface spec conflicts or design risks (flagged, not silent)
- Reference existing patterns from `specs/docs/system-design/` and `specs/docs/integrations/` to stay consistent with what's already built

Inputs: `requirements.md`, `specs/docs/system-design/`, `specs/docs/integrations/`, `specs/docs/data-model/`
Output: `design.md`

---

## Stage 3 — Planning

**Agent: `planner`**

Takes `requirements.md` + `design.md` and produces `active/<slug>/tasks.md` (and optionally updates `acceptance-criteria.md`).

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

**Agent: `reviewer`**

Reviews design + tasks against requirements. **Only surfaces real gaps or major risks** — not nitpicks, not style, not hypothetical edge cases already covered. The bar is: "would this actually break something or miss a stated requirement?"

Responsibilities:
- Verify every requirement is addressed by at least one task
- Check that design failure modes are handled (not just happy paths)
- Flag missing test tasks, skipped ACs, or requirements with no design coverage
- Flag scope creep (tasks with no tracing requirement)
- Identify integration boundary risks not already called out in design

Inputs: `requirements.md`, `design.md`, `tasks.md`
Output: a short list of confirmed gaps/risks — or "no blockers found"

Not the reviewer's job: style suggestions, alternative architectures, speculative concerns, anything the design already acknowledges.

---

## Stage 5 — Implementation

**Agent: `implementer`**

Takes a task (or parallelization phase) from `tasks.md` and implements it.

Responsibilities:
- Write failing tests first (`T-nna`), verify they fail for the right reason, then implement `T-nn` until tests pass
- One task ≈ one Claude session — don't combine multiple unrelated tasks
- Keep changes minimal: implement what the task says, no extras
- Run `typecheck` and `test:offline` before reporting done

Inputs: specific `T-nn`/`T-nna` task pair, `requirements.md` (relevant section), `design.md` (relevant section)
Output: passing tests + implementation

---

## Stage 6 — Implementation Review

**Agent: `impl-reviewer`**

Adversarial review of the implementation after a phase is complete.

Responsibilities:
- Run `/code-review` or equivalent on the diff
- Verify each AC claimed in the tasks actually passes
- Check for security issues: injection, missing auth checks, secrets in logs
- Flag correctness bugs only — not style issues
- Report: ACs verified, any failing ACs, any bugs found

Inputs: diff + `tasks.md` (ACs for the phase) + `requirements.md` (relevant requirements)
Output: a short verified-pass list or list of bugs requiring a fix

---

## Stage 7 — Technical Writer

**Agent: `tech-writer`**

Updates documentation after a feature ships. Keeps both agent docs and human docs current.

Responsibilities:
- Update `specs/docs/` files affected by the new feature (system-design, data-model, integrations)
- Update `docs/` human-facing documentation (README, system map, etc.)
- Update `specs/registry.yaml` — move completed specs to `archive`, add `needed_by`/`depends_on` links
- Create or update `active/<slug>/stub.md` completion notes
- Files should stay under ~300 lines — split if needed, update the README/index

Inputs: merged diff, `specs/active/<slug>/` full set of docs
Output: updated `specs/docs/` and `docs/` files

---

## Parallelization

```
stub.md
  └── [requirements] → requirements.md
        └── [design] → design.md
              └── [planner] → tasks.md
                    ├── [reviewer] → gaps report          ← can run while planner writes tasks
                    └── [implementer × N phases]          ← phases run sequentially, tasks within a phase in parallel
                          └── [impl-reviewer] → pass/bug report
                                └── [tech-writer] → updated docs
```

Stages 1–4 (spec work) are sequential. Stages 5–6 repeat per parallelization phase. Stage 7 runs once after all phases are done (or can run incrementally per phase for long features).
