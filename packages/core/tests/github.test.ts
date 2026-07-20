import { describe, it, expect, vi } from "vitest";
import { crawlSource, crawlSourceFull, type GitHubApi, type TreeEntry } from "../src/github.js";
import { SOURCES } from "../src/sources.js";

function fakeApi(tree: TreeEntry[], blobs: Record<string, string>, headSha = "commit-abc"): GitHubApi {
  return {
    branchHeadSha: vi.fn(async () => headSha),
    tree: vi.fn(async () => tree),
    blob: vi.fn(async (_o, _r, sha) => blobs[sha] ?? ""),
  };
}

describe("SOURCES config (R-01, D-5)", () => {
  it("defines exactly the publisher and consumer repos", () => {
    expect(SOURCES.map((s) => s.label)).toEqual(["publisher", "consumer"]);
    expect(SOURCES.find((s) => s.label === "publisher")?.repo).toBe("awp-odcs-publishing");
    expect(SOURCES.find((s) => s.label === "consumer")?.repo).toBe("awp-odcs-consuming");
    expect(SOURCES.every((s) => s.branch === "main")).toBe(true);
  });
});

describe("crawlSource (T-04 · R-03, R-10, R-11, D-14)", () => {
  const source = SOURCES[0];

  // AC-03: only contract/*.odcs.yaml is selected.
  it("selects only contract/*.odcs.yaml, ignoring schema.json, meta-schema, and non-contract paths", async () => {
    const tree: TreeEntry[] = [
      { path: "contract/org.odcs.yaml", sha: "b1", type: "blob" },
      { path: "contract/user.odcs.yaml", sha: "b2", type: "blob" },
      { path: "contract/org.schema.json", sha: "b3", type: "blob" },
      { path: "contract/odcs-v3.1.0.schema.json", sha: "b4", type: "blob" },
      { path: "README.md", sha: "b5", type: "blob" },
      { path: "src/nested.odcs.yaml", sha: "b6", type: "blob" },
      { path: "contract", sha: "t1", type: "tree" },
    ];
    const api = fakeApi(tree, { b1: "org-bytes", b2: "user-bytes" });
    const files = await crawlSource(api, source);
    expect(files.map((f) => f.path).sort()).toEqual([
      "contract/org.odcs.yaml",
      "contract/user.odcs.yaml",
    ]);
  });

  // AC-10: each file records source/path/blobSha/commitSha/bytes.
  it("records source label, path, blob sha, commit sha, and bytes per file", async () => {
    const tree: TreeEntry[] = [{ path: "contract/org.odcs.yaml", sha: "blob-123", type: "blob" }];
    const api = fakeApi(tree, { "blob-123": "the-bytes" }, "commit-999");
    const [file] = await crawlSource(api, source);
    expect(file).toEqual({
      source: "publisher",
      path: "contract/org.odcs.yaml",
      blobSha: "blob-123",
      commitSha: "commit-999",
      bytes: "the-bytes",
    });
  });

  // Feeds AC-13: a GitHub error propagates so the refresh handler can isolate the source.
  it("propagates API errors (for per-source fault isolation)", async () => {
    const api: GitHubApi = {
      branchHeadSha: vi.fn(async () => { throw new Error("GitHub 503"); }),
      tree: vi.fn(),
      blob: vi.fn(),
    };
    await expect(crawlSource(api, source)).rejects.toThrow(/503/);
  });
});

describe("crawlSourceFull — contracts + docs/spec.md ref (T-29 · R-100, R-105a)", () => {
  const source = SOURCES[0];

  it("returns a specRef (SHA only — bytes not fetched here) alongside the contract files", async () => {
    const tree: TreeEntry[] = [
      { path: "contract/org.odcs.yaml", sha: "b1", type: "blob" },
      { path: "docs/spec.md", sha: "spec1", type: "blob" },
      { path: "docs/design.md", sha: "d1", type: "blob" }, // ignored
    ];
    const api = fakeApi(tree, { b1: "org-bytes", spec1: "# spec content" });
    const { files, specRef } = await crawlSourceFull(api, source);
    expect(files.map((f) => f.path)).toEqual(["contract/org.odcs.yaml"]);
    expect(specRef).toEqual({ path: "docs/spec.md", sha: "spec1" });
    // The spec blob is NOT fetched here — only the contract blob is, so a spec-doc
    // read error stays isolated to the refresh handler's requirements block (R-105a).
    expect(api.blob).toHaveBeenCalledTimes(1);
    expect(api.blob).toHaveBeenCalledWith(source.owner, source.repo, "b1");
  });

  it("returns undefined specRef when the repo has no docs/spec.md", async () => {
    const tree: TreeEntry[] = [{ path: "contract/org.odcs.yaml", sha: "b1", type: "blob" }];
    const { specRef } = await crawlSourceFull(fakeApi(tree, { b1: "x" }), source);
    expect(specRef).toBeUndefined();
  });
});
