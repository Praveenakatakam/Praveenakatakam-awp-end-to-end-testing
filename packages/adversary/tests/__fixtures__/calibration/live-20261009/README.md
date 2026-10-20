# Live TaskPublished contracts: D-85 rename check (T-49, without AWS)

- **Captured:** 2026-10-09, read-only shallow clone of `collegeboard-software/awp-app-plane`, branch `feat/end-to-end-testing-registry` @ `c54d40b`, path `docs/contracts/`.
- **Files:** verbatim copies of `create.content-events.odcs.yaml` (blob `506cbba…`) and `get-ready.assignments-api.odcs.yaml` (blob `078a5a3…`).
- **These are newer than the committed tree.** `generated-tests/` was generated from blobs `f9c3a51…` (create) and `72642b9…` (get-ready), and the reconstructed calibration contracts in `../contracts/` were built from those.

## Result: none of the three declared renames hold on the live contracts

Every get-ready `TaskPublished` property declares its source with ODCS `transformSourceObjects` / `transformDescription`:

| get-ready property | required | Declared source (verbatim) | D-85 map said |
|---|---|---|---|
| `taskId` | yes | "Sourced from TaskPublished.taskId in create.content-events." | `taskId → id` ❌ |
| `title` | yes | "Sourced from TaskPublished.title (field name unchanged)." | — |
| `taskType` | yes | "Sourced from TaskPublished.taskType in create.content-events." | `taskType → type` ❌ |
| `description` | no | "Sourced from TaskPublished.description (field name unchanged)." | — |
| `duration` | no | "Sourced from TaskPublished.duration. Coerce undefined → null." | — |
| `itemCount` | yes | "Sourced from TaskPublished.itemCount in create.content-events." | `itemCount → totalItemCount` ❌ |
| `items` | yes | "Sourced from TaskPublished.items (field name unchanged)." | — |
| `standards` | no | "Sourced from TaskPublished.standards. Coerce undefined → null." | — |

The live create contract carries every one of these names with the same logical types, including `description` (optional).

## Consequences

**Applied 2026-10-09 (T-57, user decision):** `ENTITY_FLOWS.TaskPublished.fields` was emptied. The rest of this section is not applied.


- **`ENTITY_FLOWS.TaskPublished.fields` should be empty.** It is harmless for §3.9 compat: the consumer requires `taskId`, which is not a mapped consumer name, so it matches by name. It is harmful for §3.11: prompt v3 would tell the model "taskId → id", so consumer assertions on `id` would be absent fields (R-133a Critical) and get withheld.
- On the live pair, compat would be **green**, so the R-135 mutation attack becomes applicable for the first time. The `create-get-ready` calibration control ("baseline red → no mutation finding") describes the old contracts.
- Item fields live in a separate `schema[]` object (`TaskPublishedItem`), not under `items.properties`, so D-86 nested comparison does not see them.
- The contracts already declare field lineage (`transformSourceObjects`, `transformDescription`). A field map could be derived from them instead of being hand-declared.
- `taskId → id` was called spec-backed (R-117b(b)), but that text describes the old get-ready contract. The R-117b(b) example is stale too.
