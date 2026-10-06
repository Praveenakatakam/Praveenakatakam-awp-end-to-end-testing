# CI Generation Workflow

**Status:** Pending — idea, not yet initiated

## Problem

Generated tests today are produced manually (`npm run generate-tests`) and committed by hand. There is no automation connecting a crawl completion or a contract change to a new generation run, no branch/PR convention for generated test updates, and no CI gate ensuring generated tests are up to date.

## Rough shape

- On crawl completion (or on a schedule), trigger a generation run automatically
- Pull the resulting artifacts and open a PR against a designated branch with the updated `generated-tests/` tree
- CI should fail if generated tests are stale relative to the latest catalog (detectable via manifest content hashes vs current catalog hashes)

## Questions to resolve before initiating

- What triggers generation: crawl completion event, scheduled cron, or manual only?
- Which branch does the auto-PR target?
- Who reviews / auto-merges the generated test PR?
- Should CI block on stale generated tests or just warn?

## Related

- [pending/configurable-llm-pipeline](../configurable-llm-pipeline/stub.md) — generation pipeline that CI would trigger
- [pending/generation-run-audit](../generation-run-audit/stub.md) — run records CI would reference
- [active/odcs-contract-registry/requirements.md](../../active/odcs-contract-registry/requirements.md) §3.9 — generate-tests CLI this automates
