Resume an in-progress SDD feature. The feature slug is: $ARGUMENTS

Read all existing spec artifacts for this feature:
- `specs/active/$ARGUMENTS/requirements.md` (if exists)
- `specs/active/$ARGUMENTS/design.md` (if exists)
- `specs/active/$ARGUMENTS/tasks.md` (if exists)
- `specs/active/$ARGUMENTS/review.md` (if exists)

Then determine the current state:

1. If no `requirements.md` exists → we are at Phase 1. Ask what is known about the feature and proceed with the `/start-feature` flow from Phase 2.

2. If `requirements.md` exists but no `design.md` → requirements need approval. Show the requirements and wait for approval before proceeding.

3. If `design.md` exists but no `tasks.md` → design needs approval. Show the design and wait for approval, then generate tasks.

4. If `tasks.md` exists → find the last completed task (look for checked items or review.md entries). Identify the next task and resume from there. Summarize where we are before proceeding.

5. If all tasks are checked → check `review.md` for any unresolved BLOCKING issues. If none, confirm whether to archive the spec.

**Rules while resuming:**
- Do not re-do approved work
- Re-read the full spec before touching any code
- If the spec seems stale or inconsistent with current code, flag it before proceeding
- Never commit anything
