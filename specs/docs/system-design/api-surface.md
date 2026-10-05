# API Surface

Base URL: the HTTP API endpoint (resolved from `sst/node/api` binding or `.sst/outputs.json`).

All routes require a Cognito access token (`Authorization: Bearer <token>`). Missing header → `401`. Invalid/expired/wrong-group → `403`.

## Auth groups

- **`reader`** — all GET endpoints
- **`writer`** — all GET endpoints + `POST /refresh`, `POST /generate-tests`, `POST /generate-functional-tests`

## Routes

| Method | Path | Group | Success | Key errors |
|---|---|---|---|---|
| `POST` | `/refresh` | writer | `200` crawl-run summary | `401`, `403`, `409` (in-flight) |
| `GET` | `/contracts` | reader | `200` `{items: Entry[]}` | `401`, `403` |
| `GET` | `/contracts/{source}/{id}` | reader | `200` entry + version history | `401`, `403`, `404` |
| `GET` | `/contracts/{source}/{id}/raw` | reader | `200` raw ODCS YAML | `401`, `403`, `404` |
| `GET` | `/entities/{entity}` | reader | `200` variants + `divergent` + semantic diff | `401`, `403`, `404` |
| `GET` | `/crawls` | reader | `200` crawl history | `401`, `403` |
| `GET` | `/crawls/{runId}` | reader | `200` single run | `401`, `403`, `404` |
| `GET` | `/requirements` | reader | `200` `{items: Requirement[]}` | `401`, `403` |
| `GET` | `/requirements/{source}` | reader | `200` source set + specVersion/specHash | `401`, `403`, `404` |
| `GET` | `/requirements/{source}/{id}` | reader | `200` single requirement | `401`, `403`, `404` |
| `POST` | `/generate-tests` | writer | `200` generation-run summary | `401`, `403` |
| `GET` | `/test-artifacts` | reader | `200` run list | `401`, `403` |
| `GET` | `/test-artifacts/latest` | reader | `200` run record + inline artifact set | `401`, `403`, `404` |
| `GET` | `/test-artifacts/{runId}` | reader | `200` run record + inline artifact set | `401`, `403`, `404` |
| `POST` | `/generate-functional-tests` | writer | `202` `{jobId}` | `401`, `403` |
| `GET` | `/functional-test-jobs` | reader | `200` job list | `401`, `403` |
| `GET` | `/functional-test-jobs/latest` | reader | `200` job record + artifact set | `401`, `403`, `404` |
| `GET` | `/functional-test-jobs/{jobId}` | reader | `200` job record + artifact set | `401`, `403`, `404` |

## Query filters

- `GET /contracts` — `?source=`, `?entity=`, `?validation=`
- `GET /requirements` — `?source=`, `?earsType=`, `?conforming=`
- `GET /contracts/{source}/{id}/raw` — `?version=` (default: current)
