# Calibration re-run — adversarial-test-review v0.4 (T-56 · AR-10)

- **Date:** 2026-10-08, after T-52…T-56 (spec v0.8.0).
- **Skill:** `adversarial-test-review` v0.4. The raw output reports `"version": "0.4"`, so the tightened reconcile definition was used. Agents `adversarial-test-blind` → `adversarial-test-reconcile`, model `claude-fable-5-1`.
- **Scope:** committed `generated-tests/` @ `c473e83` (unchanged; it predates v0.8.0), plus the v0.8.0 generator source in the working tree. `in_product_reports: none`, `sources: none`.
- **Run folder:** `.adversarial-review/20261008-1309_test_feat-qa-agent-skills/`
- **Verdict:** FAIL — Critical · Critical 13 · Major 12 · Minor 4 · posture-dropped 0 · unevidenced 0 · needs decision 4
- **Scored seeds:** D-80 1–5 and 7 (12 expectations). Seed 6 is fixed in the source (D-84) and no longer present, and seeds 8–9 are fixture-only. For comparison, the first run (`results_20261008_adversarial-test-review.md`) is re-scored on the same 12.

## Recall

| Seed | Expected | This run | Match | First run |
|---|---|---|---|---|
| S01-03 | R-134a · Critical | F-03 (`res.ok` only) | ✅ | ✅ |
| S01-03 | R-134b · Critical | F-02, F-05 (commented body, 21 × `it.todo`) | ✅ | ✅ |
| S01-03 | R-134c · Critical | F-02 (cites R-134c) | ✅ | ✅ |
| S01-03 | R-134d · Critical | F-06 (zero executable consumer assertions) | ✅ | ✅ |
| S01-03 | R-134e · Critical | F-04 (no bounded read-back) | ✅ | ✅ |
| S01-03 | R-133d · Critical | F-01, F-11 (fixed `PUBLISHER_*`/`CONSUMER_*` env names) | ✅ | ✅ |
| S01-03 | R-133e · Major | F-17 (`POST /api/review/advance` unmapped) | ✅ **new** | ❌ |
| S01-03 | R-136 M-noprop · Critical | F-07 | ✅ | ✅ |
| S04 | R-133a · Critical (consumer `itemCount`) | — (see miss 1) | ❌ | ⚠️ Major |
| S05 | R-133e · Major | F-17, F-19 (both create trigger paths) | ✅ **new** | ❌ |
| S05 | R-133b · Major | F-21: the same defect (trigger response ≠ the published event), Major, but it cites R-117a/b, not R-133b | ⚠️ defect found, rule not cited | ✅ |
| S07 | R-134h · Major | F-15 | ✅ | ✅ |

| Measure | First run (same 12) | This run |
|---|---|---|
| Strict (rule + severity) | 9 / 12 = 75% | **10 / 12 = 83%** |
| Defect-level (the right defect at the right severity) | 9 / 12 = 75% | **11 / 12 = 92%** |

Control `create-get-ready`: no mutation finding ✅. F-14 states the committed compat test is red on 5 properties, where the declared map leaves exactly 2 (`description`, `itemTypes`), which matches D-85.

## Misses

1. **S04 (R-133a on consumer `itemCount`).** This is a regression the T-56 wording caused. Mandatory check 2 says "apply the declared field map before you call a field absent". The agent read the prose assertion "title, taskType, itemCount, and taskId values … consistent with those in the published event" (`functional/manifest.json:87`) as a mapped correspondence and excused it. A field map says which publisher field a consumer field corresponds to. It does not make a publisher name valid on the consumer record. R-133a still caught three other absent consumer fields as Critical (F-08 `items[]…`, F-09 `tenantId/publishedBy/publishedAt`, F-10 `schemaVersion`). **Proposed fix (not applied):** reword check 2 so that a consumer assertion naming a publisher-side name is absent, and the map only governs `equals`/`matchFrom` correspondence.
2. **S05 R-133b not cited.** F-21 is the defect the first run's F-10 reported under R-133b. This run cites R-117a/b instead.

## Caveats

- `node -e` was denied by the permission system in the reconcile pass (5 attempts). Following the loop rule, the agent computed counts with ripgrep count mode and quoted them. Add `node -e` to the allowlist, or drop it from check 3.
- The committed tree is stale against HEAD: v1 plans, bare ids, no `fieldMap`, `promptVersion` v1 (D-01 in the report). Most committed-tree Criticals will change on the next `npm run generate-tests`. The generator findings are what persist: F-12/F-13 Critical (`equals`/`pollUntil` match `undefined === undefined`) and F-21…F-25. These are not in the answer key and are untriaged.

## Follow-up (pending)

- **2026-10-08, skill v0.5:** the proposed check-2 fix is applied. **The AR-10 re-run is deferred to T-49** at the user's direction: it runs once, on the regenerated tree, so these v0.4 numbers stay the baseline until then.
