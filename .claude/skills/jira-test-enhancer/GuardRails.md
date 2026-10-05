# jira-test-enhancer — Guardrails

This document captures every guardrail built into the `jira-test-enhancer` agent. These rules are enforced on every invocation and override any general model defaults.

---

## 1. Anti-Hallucination (Most Critical)

> *"Every fact, API name, flag value, system behavior, step, or expected result must trace directly to the ticket text, the existing test file, or an explicit user statement."*

- **Source citation required** — every TC must have a `Source` field identifying which requirement or AC it traces to
- **If source cannot be cited → stop and ask**, never write it
- This applies to: API names, flag values (e.g. `connectionsOptOut`), system behaviors, step sequences, expected results

---

## 2. Gather-Before-Write Gate

> *"Do not generate or write any test case until Steps 1–3 are fully complete."*

Steps 1–3 must all be **fully finished** before a single TC is written:
- Step 1: File path + ticket IDs collected from user
- Step 2: Test file fully read and parsed (E2E map built)
- Step 3: All Jira ticket data fetched

This prevents partial-information hallucination.

---

## 3. Loop Detection / Infinite Retry Prevention

> *"If you attempt the same operation more than twice without progress, stop and tell the user exactly what is blocking you."*

- Max **2 retries** on any single operation (Jira fetch, file read, deduplication check)
- On failure: surface the exact blocker to the user, never silently loop

---

## 4. Idempotency Check

> *"If run twice with the same ticket and file, the second run adds nothing."*

Before writing any TC, the agent checks for existing **Jira Ref + Source** combinations. If a matching pair already exists in the file, the TC is skipped. This prevents duplicate TCs on re-runs.

---

## 5. E2E / Multi-Team Coverage Mandate

> *"Every uncovered integration boundary must produce at least one new TC or a documented reason for exclusion."*

The agent must:
- Map every system in the integration chain (e.g. `CTO → MC → CHOO → Bluebook`)
- For each boundary (System A → System B), verify test coverage exists
- Flag any **zero-coverage boundary** as a mandatory gap — it cannot be silently skipped

---

## 6. File Integrity Preservation

> *"Never delete, reorder, or renumber existing test cases."*

- Existing TCs are immutable — only additions and inline update notices are permitted
- New TCs continue the existing sequence (no ID reuse)
- Format must match existing file exactly (heading level, table style, terminology)

---

## 7. SKILL.md as Single Source of Truth

> *"If SKILL.md cannot be read, stop and report the failure instead of proceeding from memory."*

The agent's **first action** on every invocation is to read `SKILL.md`. This file contains:
- All 7-step workflow instructions
- Output formats for `.md` and `.xlsx`
- Cached file structures (row ranges, last TC number, section headers)
- Integration chain context for known test suites

If that read fails → **hard stop**, no proceeding from memory.

---

## 8. Tool Scope Restriction

The agent only has access to these tools (no arbitrary web browsing, no unrestricted code execution):

```
Read, Write, Edit, Glob, Grep, Bash, PowerShell
+ 5 Atlassian MCP tools (Jira fetch only):
  - getJiraIssue
  - getAccessibleAtlassianResources
  - search
  - getJiraIssueRemoteIssueLinks
  - searchJiraIssuesUsingJql
```

Cannot browse arbitrary URLs, cannot modify files outside the task scope.

---

## 9. Information Gap Reporting (Step 7)

Every run must output an **Information Gaps** section listing:
- Any ambiguities that could not be resolved from the ticket
- Any attachments referenced but not accessible
- Any fallback behaviors that need team confirmation

This ensures unknowns are surfaced rather than silently assumed.

---

## Summary Table

| # | Guardrail | What it prevents |
|---|---|---|
| 1 | Anti-hallucination | Invented facts, APIs, flag values |
| 2 | Gather-before-write gate | Writing TCs with incomplete information |
| 3 | Loop detection (max 2 retries) | Silent infinite retry loops |
| 4 | Idempotency check | Duplicate TCs on re-runs |
| 5 | E2E boundary mandate | Silent coverage gaps at integration boundaries |
| 6 | File integrity preservation | Accidental deletion or reordering of existing TCs |
| 7 | SKILL.md hard dependency | Agent drifting from canonical workflow and rules |
| 8 | Tool scope restriction | Unintended file or network access |
| 9 | Information gap reporting | Assumptions silently baked into TCs |

---

*Last updated: 2026-05-20*
*Agent file: `C:\Users\pkatakam\.claude\.claude\agents\jira-test-enhancer.md`*
*Skill file: `C:\Users\pkatakam\.claude\skills\jira-test-enhancer\SKILL.md`*
