# System Overview

## What it is

The **ODCS Contract Registry** is a serverless AWS application that:

1. **Crawls** `awp-app-plane` (GitHub API) for ODCS v3.1.0 contract files and EARS requirements
2. **Validates** each contract against the vendored ODCS v3.1.0 JSON schema
3. **Catalogs** them in DynamoDB with append-only version history
4. **Serves** the catalog via a REST API and a React SPA
5. **Generates** contract-driven and LLM-synthesised cross-service end-to-end tests

## Core principle

> A data contract is **validated, never assumed.** The registry validates every crawled document against the ODCS schema before cataloging it, and records the result rather than silently trusting the source.

## Components

| Component | Spec | Status |
|---|---|---|
| Registry core — crawl, validate, catalog, read API, SPA | R-01…R-72 | Live |
| Test Generator — deterministic contract-driven Vitest files | R-80…R-93 | Live |
| Requirements Catalog — EARS requirements crawl + catalog | R-100…R-114 | Live |
| Functional Test Generator — LLM (Bedrock) plan synthesis | R-115…R-126 | Live |

## What it does NOT do

- Reconcile or merge divergent contracts
- Modify source repos (read-only via GitHub API)
- Accept contract uploads (crawl-only population)
- Run the generated tests (generate-and-store only)
- Schedule crawls (manual `POST /refresh` only in v1)

## Deployment

Single-region, single-account AWS via SST v2. One command to deploy: `sst deploy`.
Source: [packages/](../../../packages/) · Stacks: [stacks/](../../../stacks/)
