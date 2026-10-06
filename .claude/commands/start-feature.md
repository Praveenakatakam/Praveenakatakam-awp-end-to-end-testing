You are running the spec-driven development workflow for a new feature.

Your job: guide this feature from intake through implementation using a structured, phased approach with approval gates between phases. Do not skip phases. Do not combine phases unless the work is provably trivial and you explain why.

I review all code myself. Never commit anything.

---

## Before intake — fit check

If the feature seems trivial (typo fix, config tweak, single-line change), say so and ask whether to skip SDD. For anything non-trivial, proceed.

Reference `specs/docs/sdd/fit-check.md` if the user is unsure.

---

## Phase 1 — Intake

First, check if the user referenced a pending stub (e.g., "use the stub for X" or provided a slug). If so:
- Read `specs/pending/<slug>/requirements.md`
- Summarize what the stub captured and any open questions it flagged
- Ask the user to confirm, correct, or add to it before proceeding to Phase 2
- Skip asking for the feature idea — you already have it

If no stub was referenced, ask for:
- The feature idea and user outcome
- Any initial constraints or requirements already known
- Whether this has security or breaking-change implications

Keep it efficient. Don't ask questions the codebase can answer.

---

## Phase 2 — Requirements

Launch the `planner` agent in requirements mode with the intake information.

Provide planner with:
- The feature description and user outcome
- Stated constraints
- The spec slug (derive from feature name, kebab-case)
- Instruction to write `specs/active/<slug>/requirements.md` using EARS format
- If a pending stub was used: the stub content as a starting point, and instruction to delete `specs/pending/<slug>/` after writing `specs/active/<slug>/requirements.md`

**Stop and show requirements.md. Wait for approval before proceeding.**

---

## Phase 3 — Analysis

After requirements are approved, launch `repo-analyst` and `tool-analyst` IN PARALLEL (single message, two tool calls).

Provide each with:
- The approved `requirements.md`
- The feature slug

After both return findings, launch `planner` again in design mode with:
- The approved requirements
- Both sets of findings
- Instruction to write `specs/active/<slug>/design.md`

**Stop and show design.md. Wait for approval before proceeding.**

---

## Phase 4 — Task Planning

After design is approved, launch `technical-planner` with:
- `requirements.md` content
- `design.md` content
- Both analyst findings
- Instruction to create `specs/active/<slug>/tasks.md`

The task plan must:
- Include a Subagent Plan Summary at the top
- Break work into single-reviewable-chunk tasks
- Pair every `T-nn` implementation task with a `T-nna` test task
- Assign a subagent (or "none — reason") to each task
- Group tasks into parallelization phases

**Stop and show tasks.md. Wait for approval before proceeding.**

---

## Phase 5 — Adversarial Review (pre-implementation)

Before writing any code, launch `reviewer` in pre-implementation mode with:
- `requirements.md`
- `design.md`
- `tasks.md`
- Instruction to check coverage (every requirement → at least one task), failure modes, missing test tasks, and scope creep

**Show reviewer findings. If there are BLOCKING issues, fix them in the relevant spec file before proceeding.**

---

## Phase 6 — Implementation (per task)

For each task in `tasks.md`:

1. **Declare:** State the subagent or "Subagent: none — reason" before touching any code.

2. **Check size:** If the task seems larger than one reviewable step, stop and propose splitting it.

3. **Implement:** Launch the declared subagent (or `implementer`). Provide the full task spec + relevant context from requirements and design.

4. **Stop. Summarize what changed. Wait for approval.**

5. **Tests:** Launch `test-writer` with the implementation summary and task context. If trivial, write tests directly and note "Subagent: none — trivial".

6. **Post-task sync:** Ask `implementer` (or check yourself): did the implementation require any deviations from the spec? Were any undocumented edge cases discovered? Update `requirements.md` if yes before moving on.

7. **Review:** Launch `reviewer` in post-implementation mode with the changed files, task spec, and spec paths. Instruction to append findings to `specs/active/<slug>/review.md`.

8. **Stop. Show review findings. Wait for approval before next task.**

---

## Rules

- Keep spec artifacts updated as work evolves
- If a finding changes the design: update `design.md` before continuing
- Never commit
- If asked to "skip review" or "skip tests" for a task, honor it once and note it in the task
- If resuming mid-feature, read all existing spec artifacts first and determine the current state
