# QA Agent Suite — Audit & Improvement Plan

**Date:** 2026-06-25
**Auditor:** Claude (Fable 5)
**Scope:** qa-orchestrator, functional-test-agent, jira-test-enhancer, jira-e2e-test-writer

**Files audited:**
- `C:\Users\pkatakam\.claude\.claude\agents\qa-orchestrator.md` + `skills\qa-orchestrator\SKILL.md`
- `C:\Users\pkatakam\.claude\.claude\agents\functional-test-agent.md` + `skills\functional-test-agent\SKILL.md`
- `C:\Users\pkatakam\.claude\.claude\agents\jira-test-enhancer.md` + `skills\jira-test-enhancer\SKILL.md`
- `C:\Users\pkatakam\.claude\.claude\agents\jira-e2e-test-writer.md`

---

## Part 1: Per-Agent Findings

### 1. qa-orchestrator (newest, weakest architecturally)

| # | Severity | Finding |
|---|---|---|
| O-1 | **HIGH** | **Subagents cannot interview users.** The design says "ask at most 2 questions, one at a time" — but when launched via the Agent tool, a subagent runs to completion and returns one final message. It cannot pause and wait for an answer. The questions arrive as the agent's *final output*, the agent dies, and a fresh one starts when the user answers — losing its context. The routing logic works; the interactive Q&A flow does not. |
| O-2 | MEDIUM | The routing decision block instructs the *main context* to invoke the specialist, but nothing enforces that handoff. If the main Claude paraphrases the suggested invocation, arguments (mode, file paths) can silently drop. |
| O-3 | LOW | The agent-ecosystem table is duplicated in qa-orchestrator.md, its SKILL.md, *and* functional-test-agent's SKILL.md. Three copies will drift when agent #5 is added. |

**Fix for O-1:** Convert the Q&A into a single-shot design — the orchestrator returns *either* a routing decision *or* one consolidated clarification request (all missing inputs listed at once), and the main context relays it. Update both files to remove "one at a time."

### 2. functional-test-agent (feasibility risks — never run yet)

| # | Severity | Finding |
|---|---|---|
| F-1 | **HIGH** | **Screenshot persistence is unverified.** The `computer` tool *returns* screenshots into the conversation; it does not save PNGs to `screenshots\*.png` on disk. The entire results-file design (baseline, post-click, failure screenshots) rests on an unvalidated capability. The agent may need a different mechanism or the SKILL.md needs to soften "save" to "capture and describe." Needs a smoke test before first real use. |
| F-2 | **HIGH** | **No re-run mode.** The replay (Step 6) runs minutes after observation (Step 3), so it verifies against a page that almost certainly hasn't changed — first-run PASS is nearly guaranteed and proves little. The real value is *re-running the saved TC file next week against v6*. There is no workflow step for "load an existing TestCases_*.md and execute it without re-observing." This is the agent's core long-term purpose and it's missing. |
| F-3 | MEDIUM | `javascript_tool` is unrestricted. Guardrails block destructive *clicks* but nothing stops generated JS from calling `fetch()`, writing cookies, or mutating the DOM. Add a guardrail: JS is limited to `scrollIntoView`, `.click()`, and read-only DOM queries — never network calls, storage writes, or DOM mutation. |
| F-4 | MEDIUM | No standardized viewport. Edge P3 tests "narrow viewport," but the baseline viewport is never set (`resize_window` is in the tool list but unused in the workflow). Results aren't reproducible across runs on different screens. Define e.g. 1440×900 baseline / 390×844 narrow. |
| F-5 | LOW | Guardrail 2's destructive-label blocklist is English-only and label-based; an icon-only or non-English button bypasses it. Acceptable for now; noted. |
| F-6 | LOW | Results files accumulate per hostname with no index — after 10 runs there's no summary of pass-rate trend. A one-line-per-run RunHistory.md would fix it. |

### 3. jira-e2e-test-writer (most mature; config conflict)

| # | Severity | Finding |
|---|---|---|
| W-1 | **HIGH** | **Memory path conflict.** Frontmatter says `memory: user`, which makes the harness manage its own memory directory and inject its own memory instructions at runtime. But the body's "Persistent Agent Memory" section (redirected to `skills\jira-e2e-test-writer\memory\` on 2026-06-25) points elsewhere. The agent will receive two contradictory memory locations. Pick one: drop `memory: user` and keep the custom path, or delete the custom section and let the harness own it. The moved files (MEMORY.md, project_imi8878_wontdo.md) must live wherever chosen. |
| W-2 | MEDIUM | Regression-mode auto-detect keywords are brittle ("feed jira-test-enhancer", "for the regression suite"). A request like "make TCs to add to the suite" falls through to full mode → 2× token cost, the exact problem regression mode was built to fix. Add a cheap default: when the output is `.md` destined for the enhancer, or the user names the BST suite, assume regression. |
| W-3 | LOW | Excel structure spec (columns, sheets) is duplicated between the agent body and what the enhancer expects; no shared contract. If a column is renamed, the enhancer's Step 3b parser breaks silently. |
| W-4 | LOW | Loop threshold inconsistency: this agent stops at "two clarification attempts," enhancer at "more than twice," functional-test-agent at "3 consecutive failures." Harmless but worth unifying to one rule (3) across the suite. |

### 4. jira-test-enhancer (most battle-tested; cache is the risk)

| # | Severity | Finding |
|---|---|---|
| E-1 | MEDIUM | **The cached structure has no update step.** SKILL.md caches BST suite rows/last-TC (last cached 2026-05-15, updated 2026-06-16) and Step 6 validates against it — but no workflow step says "after writing, update this cache block in SKILL.md." Every run makes the cache staler; eventually the 5-row guard trips on every run and becomes noise. Add Step 8: rewrite the cache block after a successful write. |
| E-2 | MEDIUM | The 5-row drift tolerance is both too loose and too tight: 4 externally-added rows pass silently (new TCs then overwrite them — data loss), while one legitimate run adding 14 rows without a cache update trips it forever after. Better: validate against the *actual file* only (read last TC ID directly, always), and demote the cache to a performance hint that can never gate a write. |
| E-3 | LOW | The xlsx read/write mechanic ("PowerShell → Python → temp .txt → Read") is described in prose and reinvented each run. Ship a small `read_suite.py` / `append_tcs.py` helper pair in the skills folder and reference them — fewer tokens, fewer transcription errors. |
| E-4 | LOW | No `memory:` at all, while the writer has `memory: user`. The enhancer relearns nothing across runs (e.g., that the D9E1F2 header style is confirmed good). Intentional or oversight — decide explicitly. |

---

## Part 2: Cross-Cutting Issues

| # | Severity | Finding |
|---|---|---|
| X-1 | **HIGH** | **Hardcoded absolute paths everywhere.** The 2026-06-25 Fall26 folder move required edits in 3 files and still left the risk of a missed reference. A single `qa-paths.md` (or JSON) in `skills\` that every SKILL.md reads at start would make future moves a one-line change. |
| X-2 | MEDIUM | Guardrails are copy-pasted between each agent .md and its SKILL.md — 8 guardrails × 2 copies for functional-test-agent alone. Drift is inevitable. Keep the authoritative text in the agent .md (which the harness always loads) and let SKILL.md reference it by number only. |
| X-3 | MEDIUM | **No smoke tests for the agents themselves.** functional-test-agent and qa-orchestrator have never executed. Even one scripted dry run per agent ("route this request", "test this public page") would catch F-1/O-1 class issues before a real QA day does. |
| X-4 | LOW | No suite-level README. The README.xlsx covers only functional-test-agent. A one-page `skills\QA-AGENTS.md` with the four-agent map, TC ID conventions (`TC-{TICKET}-{NNN}` vs `FT-{NNN}` vs `CRA_*_Regr_{NNN}`), and file locations would be the natural companion to the orchestrator. |
| X-5 | LOW | No changelog/version field in any agent frontmatter. ~15 edits across these files this month with no record inside the files themselves. |

---

## Part 3: Prioritized Improvement Plan

### Phase 1 — Correctness (do before next real use, ~1 session) — ✅ COMPLETED 2026-06-25
1. **Fix W-1** ✅ DONE: dropped `memory: user` from jira-e2e-test-writer frontmatter; body's explicit `skills\jira-e2e-test-writer\memory\` path is now the single memory location; stale "memory is empty" snapshot replaced with instruction to read MEMORY.md index at run start.
2. **Fix O-1** ✅ DONE: qa-orchestrator redesigned to single-shot — outputs either a Routing Decision or ONE consolidated Clarification Request (all missing inputs at once); multi-turn Q&A removed from both agent .md and SKILL.md.
3. **F-1** ✅ RESOLVED (schema-verified): the `computer` tool supports `save_to_disk: true` on screenshot/zoom and returns the saved path — but the caller cannot choose the path. SKILL.md updated with the persistence mechanic: screenshot with save_to_disk → Copy-Item to screenshots dir → reference copied path. Fallback documented if persistence fails. Live browser run still pending (Chrome extension was not connected during fix session) — do one live validation on first real use.

**Bonus fixes (found during Phase 1):**
- Chrome MCP server was renamed `Claude_in_Chrome` → `claude-in-chrome`; functional-test-agent's entire tools list pointed at the dead prefix. Fixed.
- `tabs_close_mcp` was missing from functional-test-agent's tools despite the workflow requiring tab closes. Added.
- SKILL.md Step 1 now includes the mandatory `tabs_context_mcp` call (required once before any other browser tool).

### Phase 2 — Robustness (~1 session) — ✅ COMPLETED 2026-06-25
4. **F-2** ✅ DONE: added "Modes" section to functional-test-agent SKILL.md — Mode A (observe & generate, default) and Mode B (re-run existing `TestCases_*.md`; steps 1–2 then 6–7 only; supports executing v5-written TCs against a v6 URL with both URLs recorded; never modifies the original TC file). Agent description updated so "re-run the saved tests" routes correctly.
5. **E-1 + E-2** ✅ DONE: enhancer Step 6 pre-write validation rewritten — the actual xlsx is always authoritative (real max row, last TC ID, section boundaries read before every write); cache demoted to a pure performance hint that never gates a write; stale cache produces a drift note, not a stop; stop only on real file corruption (duplicate TC IDs / missing section header). New Step 8 refreshes the SKILL.md cache block after every successful write. Agent .md updated to 8-step workflow.
6. **F-3 + F-4** ✅ DONE: Guardrail 9 added to functional-test-agent.md — `javascript_tool` limited to scrollIntoView / .click() / read-only DOM queries; network calls, storage writes, DOM mutation, eval, script injection, and navigation prohibited. Standard viewport pinned: 1440×900 set via `resize_window` in Step 2 before navigation; Edge P3 TCs use 390×844 and restore 1440×900 afterward. SKILL.md guardrail count and quick reference synced to 9.

### Phase 3 — Maintainability — ✅ COMPLETED 2026-06-25
7. **X-1** ✅ DONE: created `skills\qa-paths.md` — canonical path registry with 8 named paths, referenced-by columns, agent-to-SKILL.md map, and a 5-step move checklist. SKILL.mds keep literal paths for zero-friction runs; the registry is the master to update first on any move.
8. **X-2** ✅ DONE: guardrail lists removed from functional-test-agent and qa-orchestrator SKILL.mds — replaced with pointers to the agent .md (single source of truth) plus a one-line scope summary. Stale "Ask Question 1" reference in orchestrator guardrails fixed.
9. **E-3** ✅ DONE: `skills\jira-test-enhancer\suite_info.py` created and tested against the real BST suite — dumps sheets, max rows, header row, section-title rows, last TC ID, next TC number. Referenced in SKILL.md for Steps 2/6. Test run immediately proved E-2: cached row ranges had already drifted (PSAT title actual row 75 vs cached 73; Accommodated actual 95 vs cached 101). Cache block refreshed with verified snapshot.
10. **X-4** ✅ DONE: `skills\QA-AGENTS.md` written — 4-agent map, which-agent-for-which-task table, TC ID conventions, shared conventions, file locations, maintenance rules. **W-4** ✅ DONE: e2e-writer Loop Protection now pinned at 3 failed attempts (suite-wide rule; enhancer and functional-test-agent already effectively at 3).

### Phase 4 — Nice-to-have — ✅ COMPLETED 2026-06-25
11. **F-6** ✅ DONE: RunHistory.md one-line-per-run index added to functional-test-agent Step 7 (date | mode | version | totals | results file). **X-5** ✅ DONE: `version:` + `updated:` frontmatter added to all four agent .mds (writer 2.0, enhancer 2.0, functional 1.2, orchestrator 1.1); Changelog sections appended to the three SKILL.mds. **W-2** ✅ DONE: e2e-writer regression auto-detect expanded (BST suite named as target, output feeds enhancer, "add to the suite") with a default-to-regression-when-in-doubt rule for suite-bound work. **W-3** ✅ DONE: shared E2E xlsx column contract documented in QA-AGENTS.md with pointer notes in both jira-e2e-test-writer.md and jira-test-enhancer SKILL.md Step 3b (mismatch → report, don't guess).

### Phase 5 — Independent review of jira-test-enhancer — ✅ COMPLETED 2026-10-02 (live)

**Goal:** make enhancer output reliable, objective and resistant to blind spots before it lands in the official suite. The design was agreed in a grilling session (13 decisions) and recorded in `skills\enhancer-review-plan.md`.

**Design in brief:**
- **Two `fable` reviewers.** `enhancer-review-blind` builds expected coverage from the raw sources only, fetching Jira itself; `enhancer-review-reconcile` runs checks R1–R10 and applies a fixed verdict rule. The enhancer stays on `opus`.
- **Report only**, with a 2-cycle fix limit.
- **Shared spec** `enhancer-review-spec.md`.
- **Mechanical checks:** `suite_diff.py` (R8/R10) and `suite_rows.py` (the snapshot-only guard).

| Sub-phase | Status | Notes |
|---|---|---|
| 1. Reviewer spec, 2 SKILL.mds, 2 agent .mds, helper scripts | ✅ 2026-10-02 | `suite_diff.py` tested on copies of the suite: a clean copy PASS, all planted problems caught |
| 2. Enhancer v2.1 (snapshot, `change-summary.md`, REVIEW HANDOFF, fix-cycle mode, append-only) | ✅ 2026-10-02 | Testing found that deleting a row mid-sheet in openpyxl misaligns the merged A:B titles (6 TCs corrupted) → enhancer is now append-only |
| — `.md` target support (reviewer v1.1, spec v1.1) | ✅ 2026-10-02 | All 3 md body styles parsed; md-specific R8 checks; exact Jira Ref + Source duplicate key |
| 3. Registry and docs (`qa-paths.md`, `QA-AGENTS.md`, orchestrator v1.3, this log) | ✅ 2026-10-02 | Also fixed: the stray `cd` in `qa-paths.md` line 1; the orchestrator agent .md was missing `functional-test-runner` (stale since 2026-09-29) |
| 4. Planted-mistakes test + control | ✅ 2026-10-02 PASS | seeded: 10/10 plants, correct severities and verdict; control: 0 false alarms (2 genuine Minor findings about the real suite). `runs\_calibration\results_20261002.md` |
| 4b. DAP-1654 replay with a live Jira fetch | ✅ 2026-10-02 | Both fetches and the timestamp compare work; FAIL — fix (4 Major, all verified as real suite gaps: TDTK/Atlas/DataGen boundaries, Live Support workflows) |
| 5. Go live | ✅ 2026-10-02 | Relay rules added to global `CLAUDE.md`; fixed a RunHistory parallel-write race (append-only + no parallel reconciles) |

**New findings (from building Phase 5):**

| # | Severity | Finding | Status |
|---|---|---|---|
| E-5 | HIGH | Mid-sheet row insert/delete through openpyxl corrupts merged section titles | Fixed: append-only rule (enhancer Step 6) + R8 detection |
| E-6 | MEDIUM | The BST suite has no Jira Ref or Source column, so the enhancer's idempotency rule (dedupe by Jira Ref + Source) can't actually be applied to the xlsx | Partly mitigated: the reviewer's R4 uses TC name + content similarity. The enhancer's own idempotency check still relies on section titles and scenario text; revisit if duplicates show up in reviews |
| O-4 | LOW | The orchestrator agent .md drifted from its SKILL.md (missing runner) | Fixed in v1.3; the X-2 single-source rule should cover ecosystem tables too |

---

## Top 3 — Act First

1. **O-1** — The orchestrator's interactive Q&A can't work as designed (subagents can't pause for user input).
2. **W-1** — The e2e-writer is telling the harness and itself two different memory locations.
3. **F-1** — The functional-test-agent's screenshot-saving assumption has never been verified.
