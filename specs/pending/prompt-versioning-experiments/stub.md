# Prompt Versioning & Experiment Tracking

**Status:** Pending — idea, not yet initiated

## Problem

The LLM functional test generator (§3.11) uses a versioned prompt today, but the version is just a string in the cache key. There's no systematic way to:

- Run the generator against the same source documentation with different prompt versions and compare quality
- Catalog which tests came from which prompt version
- Track metrics across experiment runs (e.g. plan validity rate, skip rate, test coverage)

## Proposed approach

1. **Store prompt versions in DynamoDB** (or S3) rather than hardcoding them — a `PROMPT#{version}` item kind with the full prompt text, model id, and metadata (created, author, notes)
2. **Tag every generation run** (functional jobs) with the exact prompt version used — already partially done via `promptVersion` in the cache key and job record
3. **Experiment runs** — a new concept: trigger a set of functional-gen jobs across a matrix of `{promptVersion × sourceSnapshot}`, store results under an experiment id
4. **Experiment catalog** — a read API + SPA view to compare experiments side by side: plans generated, skip rate, test coverage vs requirements

## Questions to resolve before initiating

- Should prompt versions live in DynamoDB or be git-tracked files?
- Is the comparison surface qualitative (human reviews tests) or quantitative (automated scoring)?
- Should this be a new SST stack component or extend the existing functional-gen infrastructure?
- Does the existing `PlanCache` input-hash scheme need to change to account for prompt version as a first-class axis?

## Related

- [active/odcs-contract-registry/requirements.md](../active/odcs-contract-registry/requirements.md) §3.11 — the LLM functional gen this extends
- [specs/docs/integrations/bedrock.md](../../docs/integrations/bedrock.md) — Bedrock integration details
