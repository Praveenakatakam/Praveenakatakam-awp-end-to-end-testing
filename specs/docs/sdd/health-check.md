# SDD Health Check

Run HC-1 + HC-2 (scoped) at the end of every implementation phase, the full set before a feature is closed out or a significant PR is merged, and at least monthly on actively maintained projects. `/start-feature` and `/health-check` run these through the `reviewer` agent.

The longer you wait, the more expensive the drift is to fix.

---

## Setup

Before running, confirm Claude has access to:

- [ ] `specs/active/<slug>/requirements.md` (current spec)
- [ ] `specs/active/<slug>/design.md`
- [ ] The full codebase or relevant modules
- [ ] The test suite
- [ ] 30–60 minutes to review and act on the report

Run all five prompts in a single Claude session. Treat anything flagged as a blocker before starting new feature work.

---

## HC-1 — Spec → Code coverage (bidirectional)

```
Audit the codebase against our spec at specs/active/<slug>/requirements.md.

For each requirement R-01 through R-[last], classify it as:
- IMPLEMENTED: code exists and matches the requirement
- PARTIAL: code exists but doesn't fully satisfy it — describe the gap
- MISSING: no code implements this requirement
- CONTRADICTED: code exists but behaves contrary to the requirement

Then reverse it — scan the codebase for any significant logic, branching,
or behaviour that has no corresponding requirement in the spec.
List those as UNDOCUMENTED.

Output a table. Flag anything that is not IMPLEMENTED as a blocker.
```

---

## HC-2 — Spec → Test alignment

```
Compare our test suite against the acceptance criteria in specs/active/<slug>/requirements.md.

For each test:
1. Which requirement (R-xx) does it verify?
2. Does the test description match the GIVEN/WHEN/THEN language in the spec?
3. Is the test asserting what the spec says should happen, or what the
   current code happens to do? (These diverge when code changes without
   updating tests.)

Flag any tests that:
- Have no corresponding spec requirement (testing undocumented behaviour)
- Contradict their corresponding EARS requirement
- Cover a requirement that has since been modified in the spec
```

---

## HC-3 — Design → Reality alignment

```
Compare specs/active/<slug>/design.md against the actual implementation.

Check for:
1. Components in the design that no longer exist in the codebase
2. Components in the codebase not described in the design
3. Data model fields that differ between design and implementation
4. API contracts (endpoints, request/response shapes) that have drifted
5. Integration boundaries handled differently than the design describes
6. Any architectural decision made in code that contradicts the design

For each divergence, tell me whether the design needs to be updated
to match reality, or whether the code needs to be corrected to match the design.
```

---

## HC-4 — Decisions log completeness

```
Scan our spec, codebase, commit history, and inline comments for
decisions that were made but never documented in the decisions log in
specs/active/<slug>/design.md (and requirements.md).

Look for:
- Code comments that say "we decided to..." or "using X instead of Y because..."
- TODO/FIXME comments that reveal an unresolved open question
- Open questions in the spec that have been silently resolved in code
- Architectural choices in the implementation with no corresponding rationale

For each undocumented decision found, draft the decisions log entry:

**D-n — Short title.**
- **Decision:** [what was chosen]
- **Reason:** [why — inferred from context]
- **Affects:** [which requirements R-xx]

I will review and add these to the spec.
```

---

## HC-5 — Full health summary

```
Produce a one-page health report for this project covering:

1. Spec coverage: % of requirements fully implemented and tested
2. Drift items: count by category (code, test, design, decisions)
3. Top 3 most urgent fixes needed
4. Open questions still unresolved in the spec
5. Recommendation: is this codebase in a healthy state to receive
   new feature work, or does cleanup need to happen first?

Be direct. If the project has meaningful drift, say so.
```

---

## Change requests (requirements first)

Before writing code for any change:

```
I need to change the system: [describe the change]

Before writing any code:
1. Identify which existing requirements (R-xx) are affected
2. Write the updated EARS requirement(s)
3. Identify which test cases need to be updated
4. Identify which implementation tasks are affected
5. Flag any downstream impacts on other requirements

Show me the spec changes first. I will approve them before you touch any code.
```
