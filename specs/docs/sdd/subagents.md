# SDD Subagent Pipeline

The SDD workflow maps to a pipeline of specialized subagents. Each is scoped to one stage, reads only what it needs, and produces a single deliverable. Run stages sequentially; within a stage some agents can be parallelized.

---

## Stage 0 — Gap Discovery (pre-stub)

**Not a subagent — the orchestrator and the human, in `/start-feature` Phase 1 (Intake).**

Before any spec file is written, the orchestrator runs the fit check in [fit-check.md](fit-check.md), then asks the user clarifying questions (most important first): missed edge cases, ambiguous requirements (stating each reading), implicit assumptions, production risks. Anything the codebase can answer is looked up and stated as an explicit assumption instead of asked. If a pending stub was referenced, the orchestrator summarizes it and asks the user to confirm or correct it.

**Output:** intake notes, gap-discovery answers, and stated assumptions — handed to `planner`. Every unanswered question becomes an Open Question in the spec.

---

## Stage 1 — Requirements

**Agent: `requirements`** → invoke as `.claude/agents/planner.md` (requirements mode)

Takes the intake notes (and a pending stub at `pending/<slug>/requirements.md`, if one was used) and produces `active/<slug>/requirements.md`. Deletes the pending stub once promoted.

Responsibilities:
- Expand the stub into full EARS requirements (`**R-nn** SHALL/WHEN/IF…`)
- Organize under `### 3.x` sub-sections
- Write NFRs, edge cases table, and open questions
- Record each non-obvious decision in the decisions log (`D-n`)
- Version the spec header
- After drafting: audit each requirement for EARS compliance — flag ambiguous ones, rewrite in strict EARS format, and generate GIVEN/WHEN/THEN test skeletons for each (flag any requirement that can't be expressed as GIVEN/WHEN/THEN; those need rewriting before design begins)
- Return an **Assumptions & Ambiguities** section and Open Questions tagged `[BLOCKING]`/`[NON-BLOCKING]` — `planner` cannot talk to the user, so the orchestrator puts these to the user

Inputs: intake notes + gap-discovery answers, pending stub (if any), relevant system-design docs from `specs/docs/`
Output: `requirements.md` with EARS-validated requirements and test skeletons

**Gate:** requirements are not approved while any `[BLOCKING]` question is unanswered; answers are written back into `requirements.md`.

---

## Stage 2 — Design

**Agent: `design`** → invoke as `.claude/agents/planner.md` (design mode)

First, `repo-analyst` (existing patterns, reusable code) and `tool-analyst` (external tools, build-vs-buy) run **in parallel** over the approved requirements. `planner` then takes `requirements.md` + both sets of findings and produces `active/<slug>/design.md`.

Responsibilities:
- For each significant technical decision: enumerate build options and buy/reuse options (existing packages, services, patterns in the codebase)
- Weigh trade-offs explicitly — don't just pick one; show the reasoning
- Derive the architecture, data models, API surface, and integration boundaries
- Map every requirement to at least one component
- Surface spec conflicts or design risks (flagged, not silent)
- Reference existing patterns from `specs/docs/system-design/` and `specs/docs/integrations/`

Inputs: `requirements.md`, `repo-analyst` + `tool-analyst` findings, `specs/docs/system-design/`, `specs/docs/integrations/`, `specs/docs/data-model/`
Output: `design.md`

**Gate:** shown with every open question from `requirements.md` and the `D-n` that resolved it; resolutions that were assumptions rather than facts are flagged for the user to confirm.

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
- Open with a Subagent Plan Summary and assign a subagent (or "none — reason") to every task

Inputs: `requirements.md`, `design.md`, analyst findings
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

- Flag ambiguity: requirements two implementers could read differently, unverified assumptions, unresolved open questions

Inputs: `requirements.md`, `design.md`, `tasks.md`
Output: a short list of confirmed gaps/risks — or "no blockers found". BLOCKING issues are fixed in the spec before any code is written.

---

## Stage 5 — Implementation

**Agents: `test-writer`** → `.claude/agents/test-writer.md` (test-first mode), **then `implementer`** → `.claude/agents/implementer.md` (or the task's declared subagent)

Takes one task from `tasks.md` and implements it. Per task the orchestrator: declares the subagent, checks the task is one reviewable step (proposes a split if not), then:

1. **Tests first — `test-writer`:** writes the `T-nna` tests from the spec's acceptance criteria (not from code) and confirms they fail for the right reason. Trivial tests may be written directly ("Subagent: none — trivial").
2. **Implement — `implementer`:** receives the task spec, relevant requirements/design context, and the failing tests. Done when those tests pass. Never edits tests to make them pass — a test that looks wrong against the spec is reported.
3. **Gate:** summary of changes, wait for approval.

`implementer` responsibilities:
- One task ≈ one Claude session — don't combine multiple unrelated tasks
- Keep changes minimal: implement what the task says, no extras
- Run `typecheck` and `test:offline` before reporting done
- After each task: check for spec drift — did the implementation require deviations? Were any edge cases discovered that aren't in the spec? Report these before starting the next task so requirements.md stays current.

Inputs: specific `T-nn`/`T-nna` task pair, failing tests from `test-writer`, `requirements.md` (relevant section), `design.md` (relevant section)
Output: passing tests + implementation + drift report (empty if no drift)

**Post-task sync:** any deviation or newly discovered edge case is written back into `requirements.md` / `design.md` (with a `D-n` entry) before the next task — never left only in code.

**Worktree consolidation (after each approved task):**
Implementer agents run in isolated git worktrees. After the human approves a task's output, merge the worktree branch back into the feature branch so all changes stay consolidated:
```sh
# From the feature branch (main checkout)
git merge <worktree-branch-name>
```
If multiple tasks ran in parallel worktrees, merge them one at a time and resolve any conflicts before the next merge. Never let worktree branches accumulate — merge as you go so the feature branch is always the source of truth.

---

## Stage 6 — Implementation Review

**Agent: `impl-reviewer`** → invoke as `.claude/agents/reviewer.md` (post-implementation mode)

Adversarial review of the implementation **after each task**. Findings are appended to `specs/active/<slug>/review.md`, and the user approves before the next task starts.

At the **end of each parallelization phase**, `reviewer` also runs in health-check mode — HC-1 and HC-2 from [health-check.md](health-check.md), scoped to the requirements that phase satisfied. Every drift item is reconciled before the next phase starts.

Responsibilities:
- Run code review on the diff
- Verify each AC claimed in the tasks actually passes
- Check for security issues: injection, missing auth checks, secrets in logs
- Flag correctness bugs only — not style issues
- Report: ACs verified, any failing ACs, any bugs found

Inputs: changed files + `tasks.md` (task ACs) + spec paths (`requirements.md`, `design.md`)
Output: a short verified-pass list or list of bugs requiring a fix

---

## Stage 7 — Technical Writer

**Agent: `tech-writer`** → `.claude/agents/tech-writer.md` (launched in `/start-feature` Phase 7 close-out)

Close-out runs in this order:
1. Full `/health-check <slug>` (HC-1 through HC-5); every drift item reconciled — no "later"
2. For UI work: run the app and check the rendered result against the requirements
3. `tech-writer` updates documentation (below) and reports Flagged items
4. **Gate:** user approves the health report and doc changes before the spec is archived

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
[intake + gap discovery] → intake notes (+ pending stub, if any)
  └── [planner: requirements] → requirements.md (EARS-validated + test skeletons)     ◆ gate
        └── [repo-analyst ∥ tool-analyst] → findings
              └── [planner: design] → design.md                                       ◆ gate
                    └── [technical-planner] → tasks.md                                ◆ gate
                          └── [reviewer: pre-impl] → gaps report (blockers fixed in spec)
                                └── per phase (sequential), per task:
                                      [test-writer] → failing tests
                                        └── [implementer] → passing tests             ◆ gate
                                              └── post-task sync → spec updated
                                                    └── [reviewer: post-impl] → review.md  ◆ gate
                                      end of phase: [reviewer: HC-1 + HC-2] → reconciled
                                └── [/health-check HC-1–HC-5] → reconciled
                                      └── [tech-writer] → updated docs + registry     ◆ gate → archive
```

Stages 0–4 (spec work) are sequential. Stages 5–6 repeat per task, grouped into parallelization phases (phases run sequentially; independent tasks within a phase may run in parallel worktrees). Stage 7 runs once after all phases are done. Health checks are gates, not optional: scoped HC-1 + HC-2 at the end of each phase, the full HC-1–HC-5 at close-out (`/health-check`) before `tech-writer`, plus periodic out-of-band runs.
