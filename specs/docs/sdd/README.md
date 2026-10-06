# SDD Workflow

Spec-driven development in this repo. The spec is always the oracle — if code and spec disagree, fix the code (or update the spec explicitly and record the change in the decisions log).

---

## The lifecycle

### 0. Fit check

Before creating a stub, confirm SDD is the right tool and run a gap discovery session. See [fit-check.md](fit-check.md). Then use `/stub-requirement <idea>` to capture the stub.

### 1. Idea → pending

Create `specs/pending/<feature-slug>/stub.md`. A stub is:
- One-paragraph description of the feature
- Why it's needed
- Open questions before initiating (use gap discovery to find these)

Update `specs/registry.yaml` to add the pending entry.

### 2. Pending → active (initiate)

Move the stub to `specs/active/<feature-slug>/stub.md`. Then, in order:

1. **requirements.md** — EARS requirements. Format: numbered bullets `**R-nn** WHEN/IF/SHALL…` under `## 3. Functional Requirements (EARS)` with `### 3.x` sub-sections. Include: purpose, out-of-scope, functional requirements, NFRs, edge cases table, decisions log. This is the oracle.
2. **design.md** — technical design derived from requirements. How, not what.
3. **tasks.md** — ordered implementation tasks. Every `T-nn` must have a paired `T-nna` test task. Golden rule: write failing tests first, get approval, then implement.
4. **test-plan.md** — test conditions by phase (optional if test coverage is already in tasks.md).

Update `specs/registry.yaml`.

### 3. Active → archive (complete)

When all tasks in `tasks.md` are done and deployed/verified, move the entire `active/<slug>/` folder to `archive/<slug>/`. Update `registry.yaml`.

---

## EARS format

```
**R-01** — The system SHALL …
**R-02** — WHEN X occurs, THE system SHALL …
**R-03** — IF X fails, THE system SHALL …
**R-04** — WHILE X is active, THE system SHALL …
**R-05** — WHERE feature Y is enabled, THE system MAY …
```

- Each requirement: bold id `**R-nn**` (or `**DOMAIN-R-nn**` for domain-namespaced), space, text.
- Leading keyword determines EARS type: `WHEN` → event, `IF` → unwanted, `WHILE` → state, `WHERE` → optional, none → ubiquitous.
- First modality keyword: `SHALL` (mandatory), `SHOULD` (preferred), `MAY` (optional).

---

## Decisions log

Every non-obvious design choice goes in the decisions log at the bottom of `requirements.md`:

```markdown
**D-1 — Short title.**
- **Decision:** What was decided.
- **Reason:** Why.
- **Affects:** Which requirements.
```

---

## Version bumping

When updating `requirements.md`, bump the version in the header and add a log entry describing what changed and whether any requirement behaviour was weakened.

---

## Commands

- `/stub-requirement <idea>` — fast capture to `specs/pending/` without starting SDD
- `/start-feature` — full SDD flow from intake through implementation (can reference a pending stub)
- `/resume-feature <slug>` — continue an in-progress spec from its last approval gate

## Subagents

See [subagents.md](subagents.md) for the full pipeline. Executable agent files live in `.claude/agents/`.

---

## Health checks

Run periodically to detect spec drift. See [health-check.md](health-check.md).
