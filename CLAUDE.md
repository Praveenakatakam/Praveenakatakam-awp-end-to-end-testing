# awp-end-to-end-testing — Claude Code instructions

## Adversarial review chain
When `npm run generate-tests` (or `scripts/generate-tests.ts`) ends with an `## ADVERSARIAL REVIEW HANDOFF` block, run the **`adversarial-test-review`** skill before reporting back:

1. Pass the block's fields to the skill **exactly as printed**: `generated_dir`, `in_product_reports`, `run`, `functional_job`.
2. The skill runs `adversarial-test-blind`, **then** `adversarial-test-reconcile`, one after the other and never in parallel, and then the finalize script.
3. **Report the verdict to the user.** Never edit tests, generators, or generated files to make findings go away, and never commit. A fix only starts if the user asks for one.

`adversarial-code-review` is **not** chained. Run it only when the user asks, e.g. before opening a PR.

Full rules: `.claude/skills/adversarial-review-spec.md`.
