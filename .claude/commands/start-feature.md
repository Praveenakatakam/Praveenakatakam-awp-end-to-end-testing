You are running the spec-driven development workflow for a new feature.

Your job: guide this feature from intake through implementation using a structured, phased approach with approval gates between phases. Do not skip phases. Do not combine phases unless the work is provably trivial and you explain why.

I review all code myself. Never commit anything.

---

## Before intake — fit check

If the feature seems trivial (typo fix, config tweak, single-line change), say so and ask whether to skip SDD.

For anything non-trivial, run the five-item checklist in `specs/docs/sdd/fit-check.md`. If fewer than four apply, recommend a throwaway prototype first and ask the user before continuing.

---

## Phase 1 — Intake

First, check if the user referenced a pending stub (e.g., "use the stub for X" or provided a slug). If so:
- Read `specs/pending/<slug>/stub.md`
- Summarize what the stub captured and any open questions it flagged
- Ask the user to confirm, correct, or add to it before proceeding to Phase 2
- Skip asking for the feature idea — you already have it

If no stub was referenced, ask for:
- The feature idea and user outcome
- Any initial constraints or requirements already known
- Whether this has security or breaking-change implications

### Gap discovery (required)

Before Phase 2, ask the user clarifying questions — most important first — to surface what hasn't been thought through:
- Edge cases they might have missed
- Requirements that are ambiguous and could go multiple ways (state the readings)
- Implicit assumptions about the tech stack, users, data, or environment
- Anything that would make the output wrong in production

Don't ask what the codebase can answer — look it up, then state what you found as an explicit assumption the user can correct. Every question the user can't answer yet goes into the spec's Open Questions. Do not launch `planner` until this round is done.

---

## Phase 2 — Requirements

Launch the `planner` agent in requirements mode with the intake information.

Provide planner with:
- The feature description and user outcome
- Stated constraints
- The spec slug (derive from feature name, kebab-case)
- Instruction to write `specs/active/<slug>/requirements.md` using EARS format
- If a pending stub was used: the stub content as a starting point, and instruction to delete `specs/pending/<slug>/` after writing `specs/active/<slug>/requirements.md`
- The gap-discovery answers and every assumption you stated

`planner` cannot talk to the user. It returns an **Assumptions & Ambiguities** section and Open Questions tagged `[BLOCKING]`/`[NON-BLOCKING]` — you put them to the user.

**Stop and show requirements.md, leading with its assumptions, ambiguities, and blocking questions. Ask the user to resolve them. Do not treat requirements as approved while any `[BLOCKING]` question is unanswered — write the answers back into requirements.md first.**

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

**Stop and show design.md. Alongside it, list every open question from requirements.md and how design resolved it (D-n), plus any new assumption design made about the codebase or environment. Ask the user to confirm resolutions that were assumptions rather than facts. Wait for approval before proceeding.**

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
- Instruction to check coverage (every requirement → at least one task), failure modes, missing test tasks, scope creep, and ambiguity (requirements two implementers could read differently, unverified assumptions, unresolved open questions)

**Show reviewer findings. If there are BLOCKING issues, fix them in the relevant spec file before proceeding.**

---

## Phase 6 — Implementation (per task)

For each task in `tasks.md`:

1. **Declare:** State the subagent or "Subagent: none — reason" before touching any code.

2. **Check size:** If the task seems larger than one reviewable step, stop and propose splitting it.

3. **Tests first:** Launch `test-writer` in test-first mode with the `T-nna` task and the requirements it satisfies. Tests come from the spec, not from code. Confirm they fail for the right reason. If trivial, write them directly and note "Subagent: none — trivial".

4. **Implement:** Launch the declared subagent (or `implementer`) with the full task spec, relevant requirements/design context, and the failing tests. Done when those tests pass.

5. **Stop. Summarize what changed. Wait for approval.**

6. **Post-task sync:** Ask `implementer` (or check yourself): did the implementation require any deviations from the spec? Were any undocumented edge cases or assumptions discovered? Update `requirements.md` / `design.md` (with a D-n entry) before moving on — never leave a deviation only in code.

7. **Review:** Launch `reviewer` in post-implementation mode with the changed files, task spec, and spec paths. Instruction to append findings to `specs/active/<slug>/review.md`.

8. **Stop. Show review findings. Wait for approval before next task.**

**End of each parallelization phase — drift check:** launch `reviewer` in health-check mode running HC-1 and HC-2 (`specs/docs/sdd/health-check.md`) scoped to the requirements that phase satisfied. Reconcile every item before starting the next phase (see Rules).

---

## Phase 7 — Health check and close-out

After the last task, before the feature is called done or a PR is opened:

1. Run `/health-check <slug>` (HC-1 through HC-5). Show the report.
2. Reconcile every drift item — no exceptions, no "later".
3. For UI work: run the app and check the rendered result against the requirements (screenshot or browser). Passing DOM tests do not prove the layout works.
4. Launch `tech-writer` to update docs: human-facing `README.md` and `docs/`, agent-facing reference in `specs/docs/` (system-design, data-model, integrations), and `specs/registry.yaml`. Show its Flagged items alongside the doc changes.
5. **Stop. Show the health report and doc changes. Wait for approval before archiving the spec.**

---

## Rules

- Keep spec artifacts updated as work evolves
- If a finding changes the design: update `design.md` before continuing
- **Reconcile, don't tolerate drift.** Requirements, design, tests, and code will drift. Whenever they disagree, either fix the code to match the spec, or update the spec and record a D-n entry explaining why. Never leave a disagreement unresolved.
- **Surface, don't assume.** When you or a subagent makes an assumption or picks one reading of an ambiguous requirement, say so explicitly at the next approval gate.
- Never commit
- If asked to "skip review" or "skip tests" for a task, honor it once and note it in the task
- If resuming mid-feature, read all existing spec artifacts first and determine the current state
