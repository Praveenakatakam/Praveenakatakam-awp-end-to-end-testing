/**
 * GitHub source client (T-04 · R-03, R-10, R-11, D-14).
 *
 * Discovers a source repo's `contract/*.odcs.yaml` files on its default branch
 * via the Git Trees + Blobs API and returns each file's bytes together with the
 * git blob SHA (the registry's content hash / change signal — design §2.1) and
 * the branch-tip commit SHA.
 *
 * The GitHub calls are behind the `GitHubApi` interface so the crawl logic is
 * unit-testable without network or Octokit internals. `createOctokitApi` wires
 * the real client (fine-grained PAT from the SST Secret GITHUB_TOKEN).
 */
import type { SourceConfig } from './sources.js';

/** A single entry from a recursive git tree listing. */
export interface TreeEntry {
  path: string;
  sha: string;
  type: string; // "blob" | "tree" | "commit"
}

/** Thin, mockable slice of the GitHub REST API the crawler needs. */
export interface GitHubApi {
  /** Resolve the tip commit SHA of `branch`. */
  branchHeadSha(owner: string, repo: string, branch: string): Promise<string>;
  /** List the recursive tree at `commitSha`. */
  tree(owner: string, repo: string, commitSha: string): Promise<TreeEntry[]>;
  /** Fetch a blob's decoded UTF-8 content by its blob SHA. */
  blob(owner: string, repo: string, sha: string): Promise<string>;
}

/** One discovered contract file, ready to validate + catalog. */
export interface CrawledFile {
  source: string;
  path: string;
  blobSha: string;
  commitSha: string;
  bytes: string;
}

/**
 * A reference to the source repo's `docs/spec.md` tree entry, when present
 * (§3.10, R-100). Only the blob SHA is returned here — the bytes are fetched
 * later, inside the refresh handler's isolated requirements block, so a
 * spec-doc fetch error cannot sink the source's contract crawl (R-105a).
 */
export interface SpecRef {
  path: string;
  sha: string;
}

/** A full source crawl: its contract files plus a reference to its requirements document. */
export interface SourceCrawl {
  files: CrawledFile[];
  specRef?: SpecRef;
}

const CONTRACT_EXT = /\.odcs\.ya?ml$/i;
const SPEC_DOC_PATH = /(?:^|\/)spec\.md$/i;

/** True for a tree entry that is a contract source file under the given path prefix (R-03). */
export function isContractFile(entry: TreeEntry, pathPrefix?: string): boolean {
  if (entry.type !== 'blob') return false;
  if (pathPrefix && !entry.path.startsWith(pathPrefix)) return false;
  return CONTRACT_EXT.test(entry.path);
}

/** True for the source repo's EARS requirements document (`docs/spec.md`, R-100). */
export function isSpecDoc(entry: TreeEntry): boolean {
  return entry.type === 'blob' && SPEC_DOC_PATH.test(entry.path);
}

/**
 * Crawl one source repo — its `contract/*.odcs.yaml` file **bytes** and a
 * **reference** to its `docs/spec.md` requirements document (R-100), from a
 * single recursive tree listing. The spec doc's bytes are deliberately NOT
 * fetched here: only its tree-entry SHA is returned, so the refresh handler can
 * fetch it inside its isolated requirements block (R-105a) — a transient error
 * reading `docs/spec.md` must not discard the source's contracts. Throws on any
 * tree/contract-blob error so the caller can mark just this source `failed` and
 * continue with the rest (R-13).
 */
export async function crawlSourceFull(api: GitHubApi, source: SourceConfig): Promise<SourceCrawl> {
  const commitSha = await api.branchHeadSha(source.owner, source.repo, source.branch);
  const entries = await api.tree(source.owner, source.repo, commitSha);

  const files: CrawledFile[] = [];
  for (const entry of entries.filter((e) => isContractFile(e, source.contractPathPrefix))) {
    const bytes = await api.blob(source.owner, source.repo, entry.sha);
    files.push({ source: source.label, path: entry.path, blobSha: entry.sha, commitSha, bytes });
  }

  const specEntry = entries.find(isSpecDoc);
  const specRef: SpecRef | undefined = specEntry ? { path: specEntry.path, sha: specEntry.sha } : undefined;

  return { files, specRef };
}

/** Crawl one source repo's contract files (back-compat wrapper over {@link crawlSourceFull}). */
export async function crawlSource(api: GitHubApi, source: SourceConfig): Promise<CrawledFile[]> {
  return (await crawlSourceFull(api, source)).files;
}

/**
 * Real GitHub API backed by `@octokit/rest`, authenticated with a fine-grained
 * PAT (D-14). Constructed in the refresh handler from the SST Secret
 * GITHUB_TOKEN; never constructed in unit tests.
 */
export function createOctokitApi(token: string): GitHubApi {
  // Lazy import so the pure core (and its tests) never load Octokit.
  const OctokitP = import('@octokit/rest').then(({ Octokit }) => new Octokit({ auth: token }));
  return {
    async branchHeadSha(owner, repo, branch) {
      const octokit = await OctokitP;
      const { data } = await octokit.git.getRef({ owner, repo, ref: `heads/${branch}` });
      return data.object.sha;
    },
    async tree(owner, repo, commitSha) {
      const octokit = await OctokitP;
      const { data } = await octokit.git.getTree({ owner, repo, tree_sha: commitSha, recursive: 'true' });
      return (data.tree ?? []).map((t) => ({
        path: t.path ?? '',
        sha: t.sha ?? '',
        type: t.type ?? '',
      }));
    },
    async blob(owner, repo, sha) {
      const octokit = await OctokitP;
      const { data } = await octokit.git.getBlob({ owner, repo, file_sha: sha });
      return Buffer.from(data.content, (data.encoding as BufferEncoding) ?? 'base64').toString('utf8');
    },
  };
}
