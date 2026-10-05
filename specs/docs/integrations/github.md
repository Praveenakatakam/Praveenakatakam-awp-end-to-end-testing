# GitHub Integration

## Auth

Fine-grained Personal Access Token with `Contents: read` permission, scoped to `awp-app-plane`. Stored as SST Secret `GITHUB_TOKEN` — never logged, never returned by any endpoint.

## Crawl mechanics

Two GitHub API calls per source:

1. **Git Trees API** — `GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1` — returns the full recursive tree with blob SHAs for every file. Used to enumerate `*.odcs.ya?ml` files under the configured contract path prefix (default `docs/contracts/`) and to detect `docs/spec.md`.

2. **Git Blobs API** — `GET /repos/{owner}/{repo}/git/blobs/{sha}` — fetches the raw bytes of each matching file. The blob SHA from the Trees API doubles as the content hash (drives the version model).

## Fault isolation

- Source unreachable / 5xx / rate-limit → source marked `failed`, prior catalog untouched
- `docs/spec.md` fetch/parse failure (after contracts cataloged) → requirements outcome marked `failed`, contracts unaffected
- One bad contract file → `validation: invalid`, crawl continues

## Source configuration

Configured in `packages/core/src/sources.ts`. Branch and contract path prefix are overridable per deployment stage via SST Parameters (`SOURCE_BRANCH`, `CONTRACT_PATH_PREFIX`). Adding a new source repo requires a code change + redeploy.

## Client

`@octokit/rest` (v20) behind a `GitHubSource` interface in `packages/core/src/github.ts` — injectable for unit testing.
