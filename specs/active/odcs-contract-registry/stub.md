# ODCS Contract Registry

**Status:** Implemented and deployed (spec v0.6.2)

## What it does

A reference AWS application that crawls the `awp-app-plane` monorepo for ODCS v3.1.0 data contracts and EARS requirements, catalogs them, and exposes:

- A REST API (authenticated, reader/writer Cognito groups)
- A React SPA for browsing contracts, diffs, and requirements
- A deterministic contract-driven test generator (Vitest files)
- An LLM-powered cross-service functional test generator (Claude on Bedrock)

## Why it exists

Makes contract divergence between a publisher app and a consumer app visible and queryable. Demonstrates the principle: a data contract is **validated, never assumed**.

## Components

| Component | Spec section | Status |
|---|---|---|
| Registry core (crawl, catalog, read API, SPA) | R-01…R-72 | Done T-01…T-17 |
| Test Generator | R-80…R-93 | Done T-18…T-26 |
| Requirements Catalog | R-100…R-114 | Done T-27…T-32 |
| LLM Functional Test Generator | R-115…R-126 | Done T-33…T-39 |

## Key files

- [requirements.md](requirements.md) — EARS spec (the oracle, v0.6.2)
- [design.md](design.md) — technical design
- [tasks.md](tasks.md) — implementation task list
- [acceptance-criteria.md](acceptance-criteria.md) — GIVEN/WHEN/THEN ACs
