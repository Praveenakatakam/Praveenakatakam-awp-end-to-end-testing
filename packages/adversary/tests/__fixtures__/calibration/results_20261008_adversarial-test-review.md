# Calibration — adversarial-test-review (T-50a · AR-10)

- **Date:** 2026-10-08
- **Skill:** `adversarial-test-review` v0.3. Agents `adversarial-test-blind` → `adversarial-test-reconcile`, model `claude-fable-5-1`.
- **Scope:** committed `generated-tests/` @ `c473e83`. `in_product_reports: none` (no `adversarial-reports/` yet). `sources: none` (registry API not configured).
- **Run folder:** `.adversarial-review/20261008-1139_test_feat-qa-agent-skills/` (git-ignored)
- **Verdict:** FAIL — Critical · Critical 7 · Major 10 · Minor 4 · dropped by posture lint 0 · unevidenced 0 · needs decision 4
- **Answer key:** `answer-key.json` v1 (frozen 2026-10-07). Scored seeds are D-80 1–7 only, the ones present in the committed tree. S08, S09 and the `clean` control exist only as fixtures.

## Recall

Matching is by rule + severity on the seed's defect, as the answer key's `note` defines.

| Seed | Expected (rule · severity) | Found | Match |
|---|---|---|---|
| S01-03 | R-134a · Critical | F-04 (only check is `res.ok`) | ✅ |
| S01-03 | R-134b · Critical | F-02 (body commented out) | ✅ |
| S01-03 | R-134c · Critical | F-02, F-05 (prose `payloadShape`, no concrete payload) | ✅ |
| S01-03 | R-134d · Critical | F-04 (13 × `it.todo`) | ✅ |
| S01-03 | R-134e · Critical | F-03 (no read-back poll) | ✅ |
| S01-03 | R-133d · Critical | F-01 (`PUBLISHER_*`/`CONSUMER_*` vs `GET_READY_*`) | ✅ |
| S01-03 | R-133e · Major | — (unmapped trigger path appears only inside D-03) | ❌ |
| S01-03 | R-136 M-noprop · Critical | F-03 (cites R-136) | ✅ |
| S04 | R-133a · Critical | F-09 (consumer asserts `itemCount`; get-ready has `totalItemCount`), **Major** | ⚠️ found, severity under |
| S05 | R-133e · Major | — (same root cause as the S01-03 miss) | ❌ |
| S05 | R-133b · Major | F-10 (trigger response body is not the event, cites R-133b) | ✅ |
| S06 | R-135 M1 generator · Critical | F-07 (`resolveCompatPair` alphabetical roles) | ✅ (see caveat 1) |
| S07 | R-134h · Major | F-08 (conformance green on zero records) | ✅ |

- **Strict (rule + severity):** 10 / 13 = **77%**
- **Severity-agnostic:** 11 / 13 = **85%**
- **Seed-level (any finding on each seed's defect):** S01-03, S04, S05 (partial), S06 and S07: 5 / 5
- **Control `create-get-ready`** (forbid any mutation finding): ✅. No mutation finding was raised; D-01 notes that mutation is not applicable on the red baseline.

## Misses

1. **R-133e, unmapped trigger write path (2 expectations, 1 root cause).** `POST /api/review/advance` is in no `API_MAP` entry. The blind pass flagged it (G-25: "the `create` write path is unmapped … only Major"). The reconcile pass mentioned it only inside D-03 (role inversion), not as a finding of its own.
2. **S04 severity.** F-09 cites R-133a but rates it Major: the assertions are prose/`it.todo`, so they would *fail* against a correct consumer rather than pass against a broken one. The key says Critical (R-133a: an assertion on a field absent from the target schema).

## Caveats

1. **Seed 6 is disclosed by the spec.** `docs/spec.md` OQ-16 and D-80 name the `resolveCompatPair` role bug, and `docs/design.md:723` says "the current `resolveCompatPair` *is* the defect". Both passes may read these files, so S06 recall is not independent evidence.
2. **Header version.** `review.md` shows "adversarial-test-review v0.1" because the reconcile agent wrote `version: "0.1"` into `review.raw.json`. The skill is v0.3.
3. The blind pass disclosed one incidental ripgrep hit on `docs/tasks.md` and `docs/red-runs/*.md`. It used none of it as evidence, and the tripwire did not fire.

## Findings outside the answer key (not yet triaged)

These were reported but are not in the key. They are unverified, and each needs triage before it counts as a true or false positive:
- F-06 Critical: `pollUntil` matches `undefined === undefined` when `matchFrom` is not a payload key.
- F-11…F-17 Major: generator defects.
- F-18…F-21 Minor.

See `review.md`.

## Re-run triggers

Re-run after any change to `adversarial-review-spec.md` §5–§7, either agent definition, or the agents' model.
