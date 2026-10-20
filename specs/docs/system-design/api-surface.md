# API Surface

Base URL: the HTTP API endpoint (resolved from `sst/node/api` binding or `.sst/outputs.json`).

All routes require a Cognito access token (`Authorization: Bearer <token>`). Missing header → `401`. Invalid/expired/wrong-group → `403`.

## Auth groups

- **`reader`** — all GET endpoints
- **`writer`** — all GET endpoints + `POST /refresh`, `POST /generate-tests`, `POST /generate-functional-tests`, pipeline/prompt mutation routes

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
| `POST` | `/generate-functional-tests` | writer | no `pipelineId`: `202` `{jobId,…}` (legacy job). With `pipelineId`: `202` `{runIds[], skipped[], experimentId}` (per_requirement) or `{runId, skipped[], experimentId}` (batch); `dryRun: true` → `200` `{selected[], skipped[]}` | `401`, `403`, `422` (pipeline missing/inactive, nothing groundable, ambiguous bare id) |
| `GET` | `/functional-test-jobs` | reader | `200` job list | `401`, `403` |
| `GET` | `/functional-test-jobs/latest` | reader | `200` job record + artifact set | `401`, `403`, `404` |
| `GET` | `/functional-test-jobs/{jobId}` | reader | `200` job record + artifact set | `401`, `403`, `404` |
| `GET` | `/pipelines` | reader | `200` `{items[], nextToken?}` | `401`, `403` |
| `POST` | `/pipelines` | writer | `201` `{pipelineId, version}` | `401`, `403`, `422` |
| `GET` | `/pipelines/{id}` | reader | `200` full pipeline config | `401`, `403`, `404` |
| `PUT` | `/pipelines/{id}` | writer | `200` `{version}` | `401`, `403`, `404`, `409`, `422` |
| `DELETE` | `/pipelines/{id}` | writer | `200` | `401`, `403`, `404`, `409` |
| `GET` | `/prompts` | reader | `200` `{items[], nextToken?}` | `401`, `403` |
| `POST` | `/prompts` | writer | `201` `{promptKey, currentVersion}` | `401`, `403`, `422` |
| `GET` | `/prompts/{key}` | reader | `200` current prompt with body | `401`, `403`, `404` |
| `PUT` | `/prompts/{key}` | writer | `200` `{currentVersion}` | `401`, `403`, `404`, `422` |
| `DELETE` | `/prompts/{key}` | writer | `200` | `401`, `403`, `404`, `422` |
| `GET` | `/prompts/{key}/versions` | reader | `200` `{versions[]}` (ascending) | `401`, `403`, `404` |
| `POST` | `/prompts/import-legacy` | writer | `200` `{imported[], skipped[]}` | `401`, `403` |
| `GET` | `/runs` | reader | `200` pipeline runs, newest first | `401`, `403` |
| `GET` | `/runs/{runId}` | reader | `200` run record + steps | `401`, `403`, `404` |
| `GET` | `/runs/{runId}/steps/{stepIndex}` | reader | `200` `{step, input, output}` | `401`, `403`, `404` |
| `GET` | `/runs/{runId}/artifact` | reader | `200` `{path, content}` | `401`, `403`, `404` |
| `GET` | `/experiment-index` | reader | `200` `{experiments[]}` (pipeline + legacy, newest first) | `401`, `403` |
| `GET` | `/experiment-results/{kind}/{id}` | reader | `200` `{experiment, results[], skipped[]}` | `401`, `403`, `404` |

## Query filters

- `GET /contracts` — `?source=`, `?entity=`, `?validation=`
- `GET /requirements` — `?source=`, `?earsType=`, `?conforming=`
- `GET /contracts/{source}/{id}/raw` — `?version=` (default: current)
- `POST /generate-functional-tests` — optional body: `{pipelineId?, sampling?, mode?, dryRun?}`
- `GET /experiment-results/{kind}/{id}` — `kind` is `pipeline` or `legacy`
