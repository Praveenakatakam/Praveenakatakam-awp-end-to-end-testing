Run an SDD health check (drift audit) for a spec. Arguments: $ARGUMENTS — `<slug>` for the full check, or `<slug> HC-1 HC-2 ...` for a subset.

Requirements, design, tests, and code drift apart over time. This brings them back together.

1. Read `specs/docs/sdd/health-check.md` and every artifact in `specs/active/<slug>/` (or `specs/archive/<slug>/`).
2. Launch `reviewer` in health-check mode with the slug and the requested prompts (default: HC-1 through HC-5). It appends the report to `review.md`.
3. Show the report. For every drift item, give a recommendation: **fix code** (code is wrong per the spec) or **update spec** (the spec is stale; draft the D-n entry).
4. **Stop. Ask the user to decide each item.** Then apply the decisions: spec updates and D-n entries directly; code fixes as tasks via `implementer` (test-first, as in `/start-feature`).
5. Re-run the affected HC prompts to confirm the drift is closed.

**Rules:**
- Never silently accept drift. Every item ends as fixed code, an updated spec with a D-n entry, or an explicit user-approved Open Question.
- For UI features, include a rendered check (run the app, screenshot or browser) in HC-1 — DOM tests do not prove layout.
- Never commit anything.
