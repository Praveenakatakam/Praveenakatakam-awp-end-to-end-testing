# qa-paths — Canonical Path Registry for the QA Agent Suite

**This file is the single source of truth for shared paths.** When a folder moves, update the path here first, then follow the "Referenced by" column to fix every file that hardcodes it. A move is not done until every referenced file is updated.

Last updated: 2026-10-02

## Canonical paths

| Name | Path | Referenced by |
|---|---|---|
| REGRESSION_SUITE | `C:\2026\Fall 2026\Test Cases\BST CRA Regression Suite.xlsx` | jira-test-enhancer SKILL.md (cache block, examples); qa-orchestrator SKILL.md (example output); enhancer-review-spec.md §2 |
| E2E_OUTPUT_DIR | `C:\Users\pkatakam\.claude\skills\jira-e2e-test-writer\Fall26\` | jira-e2e-test-writer.md (output location, path restriction, SPEC path); jira-test-enhancer SKILL.md (DAP-1654 excluded TCs reference, example invocation) |
| E2E_WRITER_MEMORY | `C:\Users\pkatakam\.claude\skills\jira-e2e-test-writer\memory\` | jira-e2e-test-writer.md (memory system path, MEMORY.md pointer) |
| FUNCTIONAL_TEST_OUTPUT | `C:\Users\pkatakam\.claude\skills\functional-test-agent\{hostname}\` | functional-test-agent SKILL.md (Step 5, output conventions) |
| CHROME_LAUNCHER | `C:\Users\pkatakam\.claude\Chrome Scripts\start_chrome_final.bat` | functional-test-agent SKILL.md (Step 1); CLAUDE.md (QA env setup) |
| AGENTS_DIR | `C:\Users\pkatakam\.claude\.claude\agents\` | All seven agent definitions live here (harness requirement — do not move) |
| SKILLS_DIR | `C:\Users\pkatakam\.claude\skills\` | SKILL.md files, this registry, QA-AGENTS.md, Improvement Plan.md |
| PREFETCH_ALLOWED_DIRS | `C:\Users\pkatakam\.claude\skills\jira-e2e-test-writer\Fall26\` and `C:\2026\` | jira-e2e-test-writer.md (pre-fetched file path restriction) |
| ENHANCER_RUNS_DIR | `C:\Users\pkatakam\.claude\skills\jira-test-enhancer\runs\` | jira-test-enhancer SKILL.md (Step 5.5 run folder + snapshot retention, Step 9 hand-off); enhancer-review-spec.md §2/§3; enhancer-review-reconcile SKILL.md (RunHistory path); **`enhancer-review-blind\suite_rows.py` (`RUNS_DIR` constant — the snapshot-only guard)** |
| ENHANCER_CALIBRATION_DIR | `C:\Users\pkatakam\.claude\skills\jira-test-enhancer\runs\_calibration\` | enhancer-review-spec.md §2; jira-test-enhancer SKILL.md (retention skips it); enhancer-review-plan.md (Phase 4) |
| ENHANCER_REVIEW_SPEC | `C:\Users\pkatakam\.claude\skills\enhancer-review-spec.md` | enhancer-review-blind.md + enhancer-review-reconcile.md (mandatory first read); both reviewer SKILL.mds; jira-test-enhancer SKILL.md (Run modes, Step 7a, Step 9) |
| FUNCTIONAL_TEST_SPEC | `C:\Users\pkatakam\.claude\skills\functional-test-spec.md` | functional-test-agent.md + functional-test-runner.md (mandatory first read) |

## Agent-to-SKILL.md map

| Agent definition (AGENTS_DIR) | Skill spec (SKILLS_DIR) |
|---|---|
| `jira-e2e-test-writer.md` | *(none — agent body is self-contained)* |
| `jira-test-enhancer.md` | `jira-test-enhancer\SKILL.md` |
| `functional-test-agent.md` | `functional-test-agent\SKILL.md` + `functional-test-spec.md` (shared) |
| `functional-test-runner.md` | `functional-test-runner\SKILL.md` + `functional-test-spec.md` (shared) |
| `enhancer-review-blind.md` | `enhancer-review-blind\SKILL.md` + `enhancer-review-spec.md` (shared) |
| `enhancer-review-reconcile.md` | `enhancer-review-reconcile\SKILL.md` + `enhancer-review-spec.md` (shared) |
| `qa-orchestrator.md` | `qa-orchestrator\SKILL.md` |

## Move checklist

1. Move the folder/file.
2. Update the path in this registry.
3. Open every file in the "Referenced by" column and update the literal path there.
4. Grep `C:\Users\pkatakam\.claude` and `C:\2026` across AGENTS_DIR and SKILLS_DIR for any stragglers.
5. Restart Claude Code if any agent `.md` frontmatter changed.
