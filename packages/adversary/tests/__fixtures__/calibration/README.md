# Adversarial calibration set (T-48 · spec R-145, D-80)

Planted-defect fixtures the adversarial stage must catch. They are real defects observed in the committed tree on 2026-10-06, plus controls. `answer-key.json` is the machine-read key, and the T-48a test asserts it.

## Provenance

| File | Kind |
|---|---|
| `contracts/org.publisher.odcs.yaml` | **Verbatim** copy of `packages/core/tests/__fixtures__/valid-org.odcs.yaml` |
| `contracts/org.consumer.odcs.yaml` | **Derived** from it: same properties and types, narrower `required` set |
| `contracts/taskpublished.{create,get-ready}.odcs.yaml` | **Reconstructed** from the committed `generated-tests/manifest.json` (see `taskpublished.compat-evidence.json`). Replace with the live raw contracts in T-49 |
| `functional/S01-03-committed-cre-r-24/{plan.v1.json, file.generated.test.ts.txt}` | **Verbatim** copies of the committed CRE-R-24 functional plan and test |
| `testgen/S07-conformance-empty/*` | **Verbatim** copies of the committed `get-ready.TaskPublished` conformance entry and test |
| `api-map.json` | Verbatim `API_MAP` entries, plus a fixture-only `consumer/org` mapping for the clean control |
| CRE-R-24 requirement text (in seeds) | **Reconstructed** from the committed plan's title and setup. Capture the live text in T-49 |

Refresh the verbatim copies with `node build-calibration.mjs`. Do this only on purpose: the answer key assumes the 2026-10-06 defects.

## Seeds

| Seed | D-80 | Defect | Must be found |
|---|---|---|---|
| `clean` | control | Fully grounded org propagation plan | no Critical, no Major |
| `S01-03` | 1–3 | Committed CRE-R-24: body commented out, `res.ok` is the only check, 13 `it.todo`, hard-coded `PUBLISHER_*`/`CONSUMER_*` env names where get-ready maps `GET_READY_*` | R-134a/b/c/d/e, R-133d (Critical); R-133e (Major); R-136 M-noprop (Critical) |
| `S04` | 4 | Consumer assertion on `itemCount`; get-ready has `totalItemCount` | R-133a (Critical) |
| `S05` | 5 | Trigger entity is an event; `POST /api/review/advance` is in no mapping; the request body isn't the event | R-133e, R-133b (Major, not Critical, per OQ-15); critic: event-as-entity |
| `S06` | 6 | Role inversion. In 2026-10-06 code, `resolveCompatPair` assigned roles alphabetically. Since v0.8.0 (D-84) the generator reads declared flows, so the seed feeds it `generatorFlows` (an inverted, mis-declared flow) while `roles` stays true: M1 survives | R-135 generator finding (Critical) |
| `create-get-ready` | control | Real divergent pair. Even with the declared field map (`taskId→id`, …), get-ready's `description`/`itemTypes` are unmet, so the baseline compat test is red | no mutation finding (not applicable) |
| `S07` | 7 | Conformance test passes on zero records | R-134h (Major) |
| `S08` | 8 | `id equals payload.taskId` when the read-back was selected by that equality | R-134g (Major) |
| `S09` | 9 | `description equals payload.tenantId`: grounded but semantically wrong | critic only; no Critical |

Seed files with `extends` inherit the named seed's requirement, contracts and plan, and append `addAssertions` to the plan.
