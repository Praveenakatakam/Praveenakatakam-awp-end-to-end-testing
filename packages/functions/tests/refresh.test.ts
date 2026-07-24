import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { performCrawl, handleRefresh } from '../src/refresh.js';
import type { GitHubApi, TreeEntry } from '@registry/core';
import { LockHeldError } from '../src/repository.js';

const coreFixtures = resolve(dirname(fileURLToPath(import.meta.url)), '../../core/tests/__fixtures__');
const validOrgYaml = readFileSync(resolve(coreFixtures, 'valid-org.odcs.yaml'), 'utf8');

const publisher = { label: 'publisher', owner: 'o', repo: 'publish', branch: 'main' };
const consumer = { label: 'consumer', owner: 'o', repo: 'consume', branch: 'main' };

/** Fake GitHub API driven by a per-repo tree + blob map. */
function apiFor(byRepo: Record<string, { tree: TreeEntry[]; blobs: Record<string, string>; fail?: boolean }>): GitHubApi {
  return {
    branchHeadSha: vi.fn(async (_o, repo) => {
      if (byRepo[repo]?.fail) throw new Error('GitHub 503');
      return 'commit-' + repo;
    }),
    tree: vi.fn(async (_o, repo) => byRepo[repo]?.tree ?? []),
    blob: vi.fn(async (_o, repo, sha) => byRepo[repo]?.blobs[sha] ?? ''),
  };
}

function fakeRepo() {
  return {
    acquireLock: vi.fn(async () => {}),
    releaseLock: vi.fn(async () => {}),
    ingestContract: vi.fn(async () => ({ outcome: 'new' as const, version: 1, versionNotBumped: false })),
    writeRun: vi.fn(async () => {}),
    putRequirements: vi.fn(async () => ({ discovered: 2, conforming: 2, nonConforming: 0, changed: 2, removed: 0 })),
    wipeRequirements: vi.fn(async () => ({ discovered: 0, conforming: 0, nonConforming: 0, changed: 0, removed: 3 })),
  };
}

// A minimal docs/spec.md with two requirements under the EARS section.
const SPEC_MD = `# App Spec

> **Spec version:** 0.1.0

## 3. Functional Requirements (EARS)

### 3.1 Contract

- **R-01** — The system SHALL define a contract.
- **R-10** — WHEN a client calls, THE API SHALL respond.
`;

describe('performCrawl (T-12 · R-10..R-14, R-23)', () => {
  it('catalogs only contract/*.odcs.yaml and reports counts (AC-10, AC-12, AC-23)', async () => {
    const api = apiFor({
      publish: {
        tree: [
          { path: 'contract/org.odcs.yaml', sha: 's1', type: 'blob' },
          { path: 'contract/org.schema.json', sha: 's2', type: 'blob' },
          { path: 'contract/odcs-v3.1.0.schema.json', sha: 's3', type: 'blob' },
        ],
        blobs: { s1: validOrgYaml },
      },
    });
    const repo = fakeRepo();
    const s = await performCrawl(api, [publisher], repo as any, 'run-1', '2026-07-08T00:00:00Z');
    expect(repo.ingestContract).toHaveBeenCalledTimes(1); // schema.json + meta-schema ignored (AC-23)
    expect(s.sources[0]).toMatchObject({ label: 'publisher', outcome: 'success', discovered: 1, valid: 1, newVersion: 1 });
  });

  it('isolates a failing source; others still catalog (AC-13)', async () => {
    const api = apiFor({
      publish: { tree: [], blobs: {}, fail: true },
      consume: { tree: [{ path: 'contract/org.odcs.yaml', sha: 's1', type: 'blob' }], blobs: { s1: validOrgYaml } },
    });
    const repo = fakeRepo();
    const s = await performCrawl(api, [publisher, consumer], repo as any, 'run-2', 't');
    const pub = s.sources.find((x) => x.label === 'publisher')!;
    const con = s.sources.find((x) => x.label === 'consumer')!;
    expect(pub.outcome).toBe('failed');
    expect(pub.reason).toMatch(/503/);
    expect(con.outcome).toBe('success');
    expect(con.discovered).toBe(1);
  });

  it('marks an empty source success with zero discoveries (AC-14)', async () => {
    const api = apiFor({ publish: { tree: [], blobs: {} } });
    const repo = fakeRepo();
    const s = await performCrawl(api, [publisher], repo as any, 'run-3', 't');
    expect(s.sources[0]).toMatchObject({ outcome: 'success', discovered: 0 });
  });

  it('flags an in-source id collision and catalogs only the first (AC-30a)', async () => {
    const api = apiFor({
      publish: {
        tree: [
          { path: 'contract/org.odcs.yaml', sha: 's1', type: 'blob' },
          { path: 'contract/org-copy.odcs.yaml', sha: 's2', type: 'blob' },
        ],
        blobs: { s1: validOrgYaml, s2: validOrgYaml }, // same id
      },
    });
    const repo = fakeRepo();
    const s = await performCrawl(api, [publisher], repo as any, 'run-4', 't');
    expect(repo.ingestContract).toHaveBeenCalledTimes(1);
    expect(s.collisions).toHaveLength(1);
    expect(s.collisions[0].paths).toEqual(['contract/org.odcs.yaml', 'contract/org-copy.odcs.yaml']);
  });
});

describe('requirements crawl integration (T-29 · R-100, R-101, R-105, R-108)', () => {
  it('fetches + parses + stores docs/spec.md and folds counts into the summary (AC-100/101/108)', async () => {
    const api = apiFor({
      publish: {
        tree: [
          { path: 'contract/org.odcs.yaml', sha: 's1', type: 'blob' },
          { path: 'docs/spec.md', sha: 'spec-sha', type: 'blob' },
        ],
        blobs: { s1: validOrgYaml, 'spec-sha': SPEC_MD },
      },
    });
    const repo = fakeRepo();
    const s = await performCrawl(api, [publisher], repo as any, 'run-req', 't');

    expect(repo.putRequirements).toHaveBeenCalledTimes(1);
    const [src, parsed, opts] = repo.putRequirements.mock.calls[0] as unknown as [string, any[], any];
    expect(src).toBe('publisher');
    expect(parsed.map((r: any) => r.id)).toEqual(['R-01', 'R-10']);
    expect(opts).toMatchObject({ specHash: 'spec-sha', specVersion: '0.1.0', rawSpec: SPEC_MD });
    expect(s.sources[0].requirements).toEqual({ discovered: 2, conforming: 2, nonConforming: 0, changed: 2, removed: 0 });
  });

  it('wipes the snapshot when a reachable source has no docs/spec.md (AC-105 absent → wipe)', async () => {
    const api = apiFor({ publish: { tree: [{ path: 'contract/org.odcs.yaml', sha: 's1', type: 'blob' }], blobs: { s1: validOrgYaml } } });
    const repo = fakeRepo();
    const s = await performCrawl(api, [publisher], repo as any, 'run-nospec', 't');
    expect(repo.wipeRequirements).toHaveBeenCalledWith('publisher');
    expect(repo.putRequirements).not.toHaveBeenCalled();
    expect(s.sources[0]).toMatchObject({ outcome: 'success', requirements: { discovered: 0, removed: 3 } });
  });

  it('wipes via putRequirements([]) when docs/spec.md is present but has no requirements section (AC-105 present-but-empty)', async () => {
    const api = apiFor({
      publish: {
        tree: [
          { path: 'contract/org.odcs.yaml', sha: 's1', type: 'blob' },
          { path: 'docs/spec.md', sha: 'spec-sha', type: 'blob' },
        ],
        // spec.md exists and fetches fine, but has no `## 3.` requirements section → parse → []
        blobs: { s1: validOrgYaml, 'spec-sha': '# App\n\n## 2. Out of Scope\n\n- **R-99** — not under a requirements section.\n' },
      },
    });
    const repo = fakeRepo();
    const s = await performCrawl(api, [publisher], repo as any, 'run-nosection', 't');
    // present-but-empty is an OBSERVED "zero requirements" → putRequirements([]) (wipe),
    // NOT wipeRequirements (that's the absent case) and NOT a requirements failure.
    expect(repo.putRequirements).toHaveBeenCalledWith('publisher', [], expect.anything());
    expect(repo.wipeRequirements).not.toHaveBeenCalled();
    expect(s.sources[0].requirements).not.toMatchObject({ failed: true });
  });

  it('leaves prior requirements untouched when the source fetch fails (AC-105 fail / E-36 / R-13)', async () => {
    const api = apiFor({ publish: { tree: [], blobs: {}, fail: true } });
    const repo = fakeRepo();
    const s = await performCrawl(api, [publisher], repo as any, 'run-fail', 't');
    // crawlSourceFull throws first → neither put nor wipe runs → prior snapshot kept
    expect(repo.putRequirements).not.toHaveBeenCalled();
    expect(repo.wipeRequirements).not.toHaveBeenCalled();
    expect(s.sources[0].outcome).toBe('failed');
  });

  it('isolates a requirements-store failure: contracts stay cataloged, requirements marked failed (AC-105a / E-37)', async () => {
    const api = apiFor({
      publish: {
        tree: [
          { path: 'contract/org.odcs.yaml', sha: 's1', type: 'blob' },
          { path: 'docs/spec.md', sha: 'spec-sha', type: 'blob' },
        ],
        blobs: { s1: validOrgYaml, 'spec-sha': SPEC_MD },
      },
    });
    const repo = fakeRepo();
    repo.putRequirements.mockRejectedValueOnce(new Error('ddb boom'));
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((l: string) => void lines.push(l));
    let s;
    try {
      s = await performCrawl(api, [publisher], repo as any, 'run-reqfail', 't');
    } finally {
      spy.mockRestore();
    }
    // contract crawl unaffected; source not failed
    expect(repo.ingestContract).toHaveBeenCalledTimes(1);
    expect(s.sources[0].outcome).toBe('success');
    expect(s.sources[0]).toMatchObject({ valid: 1, requirements: { failed: true } });
    // AC-105a: the isolated failure is logged
    expect(lines.map((l) => JSON.parse(l)).some((e) => e.event === 'crawl.requirements.failed' && e.source === 'publisher')).toBe(true);
  });

  it('logs crawl.requirements.collision when a source repeats an R-nn (D-49 / E-38)', async () => {
    const api = apiFor({
      publish: {
        tree: [
          { path: 'contract/org.odcs.yaml', sha: 's1', type: 'blob' },
          { path: 'docs/spec.md', sha: 'spec-sha', type: 'blob' },
        ],
        blobs: { s1: validOrgYaml, 'spec-sha': SPEC_MD },
      },
    });
    const repo = fakeRepo();
    // the repo reports a duplicate id was collapsed
    repo.putRequirements.mockResolvedValueOnce({
      discovered: 1,
      conforming: 1,
      nonConforming: 0,
      changed: 1,
      removed: 0,
      collisions: ['R-10'],
    } as any);
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((l: string) => void lines.push(l));
    try {
      await performCrawl(api, [publisher], repo as any, 'run-reqcollide', 't');
    } finally {
      spy.mockRestore();
    }
    const collision = lines.map((l) => JSON.parse(l)).find((e) => e.event === 'crawl.requirements.collision');
    expect(collision).toMatchObject({ source: 'publisher', ids: ['R-10'] });
  });

  it('isolates a docs/spec.md FETCH failure: contracts cataloged, requirements failed + event logged, other source unaffected (M2 / R-105a / E-37)', async () => {
    // Only publisher's spec-blob fetch throws; its tree + contract blob succeed.
    const api: GitHubApi = {
      branchHeadSha: vi.fn(async (_o, repo) => 'c-' + repo),
      tree: vi.fn(async (_o, repo) => [
        { path: 'contract/org.odcs.yaml', sha: repo + '-c', type: 'blob' },
        { path: 'docs/spec.md', sha: repo + '-spec', type: 'blob' },
      ]),
      blob: vi.fn(async (_o, _r, sha) => {
        if (sha === 'publish-spec') throw new Error('GitHub 500 reading blob');
        if (sha === 'consume-spec') return SPEC_MD;
        return validOrgYaml; // contract blobs
      }),
    };
    const repo = fakeRepo();
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((l: string) => void lines.push(l));
    let s;
    try {
      s = await performCrawl(api, [publisher, consumer], repo as any, 'run-specfail', 't');
    } finally {
      spy.mockRestore();
    }
    const pub = s.sources.find((x) => x.label === 'publisher')!;
    const con = s.sources.find((x) => x.label === 'consumer')!;
    // publisher's docs/spec.md fetch failed, yet its contract is cataloged and the source is NOT failed
    expect(pub.outcome).toBe('success');
    expect(pub.valid).toBe(1);
    expect(pub.requirements).toMatchObject({ failed: true });
    // consumer entirely unaffected — its requirements stored fine
    expect(con.outcome).toBe('success');
    expect(repo.putRequirements).toHaveBeenCalledWith('consumer', expect.anything(), expect.anything());
    // the failure event fired, naming the publisher (NFR-5 / D-43 taxonomy)
    const events = lines.map((l) => JSON.parse(l));
    expect(events.some((e) => e.event === 'crawl.requirements.failed' && e.source === 'publisher')).toBe(true);
  });
});

describe('crawl-run end time (R-12)', () => {
  it('records a real endedAt distinct from startedAt (not a copy)', async () => {
    const api = apiFor({ publish: { tree: [], blobs: {} } });
    const s = await performCrawl(api, [publisher], fakeRepo() as any, 'run-t', '2026-07-08T00:00:00.000Z');
    expect(s.startedAt).toBe('2026-07-08T00:00:00.000Z');
    expect(s.endedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    // The crawl ran now (2026-07+); the end time is after the fixed past startedAt.
    expect(s.endedAt > s.startedAt).toBe(true);
  });
});

describe('structured crawl logging + credential safety (NFR-5, NFR-2, R-02)', () => {
  it('emits per-source and per-file (invalid) log events with the offending path', async () => {
    const api = apiFor({
      publish: {
        tree: [
          { path: 'contract/org.odcs.yaml', sha: 's1', type: 'blob' },
          { path: 'contract/bad.odcs.yaml', sha: 's2', type: 'blob' },
        ],
        blobs: { s1: validOrgYaml, s2: ': not : valid : yaml :' },
      },
    });
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((l: string) => void lines.push(l));
    try {
      await performCrawl(api, [publisher], fakeRepo() as any, 'run-log', '2026-07-08T00:00:00Z');
    } finally {
      spy.mockRestore();
    }
    const events = lines.map((l) => JSON.parse(l));
    expect(events.map((e) => e.event)).toEqual(
      expect.arrayContaining(['crawl.start', 'crawl.file.invalid', 'crawl.source.done', 'crawl.requirements.done', 'crawl.done'])
    );
    const invalid = events.find((e) => e.event === 'crawl.file.invalid');
    expect(invalid).toMatchObject({ source: 'publisher', path: 'contract/bad.odcs.yaml' });
  });

  it('redacts a credential echoed by a source error from logs and the run summary (R-02, NFR-2)', async () => {
    const SECRET = 'ghp_topsecrettoken0123456789ABCDEF';
    // Simulate the worst case: the GitHub client throws an error whose message
    // embeds the token. The failure reason is both logged AND returned in the
    // summary, so it must be redacted at that boundary.
    const api: GitHubApi = {
      branchHeadSha: vi.fn(async () => {
        throw new Error(`401 Bad credentials (token ${SECRET})`);
      }),
      tree: vi.fn(async () => []),
      blob: vi.fn(async () => ''),
    };
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((l: string) => void lines.push(l));
    let summary;
    try {
      summary = await performCrawl(api, [publisher], fakeRepo() as any, 'run-sec', '2026-07-08T00:00:00Z');
    } finally {
      spy.mockRestore();
    }
    const haystack = lines.join('\n') + JSON.stringify(summary);
    expect(summary.sources[0].outcome).toBe('failed'); // the error path was actually exercised
    expect(haystack).not.toContain(SECRET);
    expect(haystack).not.toMatch(/ghp_[A-Za-z0-9]/); // no GitHub-token-shaped string survives
    expect(summary.sources[0].reason).toContain('[redacted]'); // reason preserved, secret scrubbed
  });
});

describe('handleRefresh (T-12 · R-15)', () => {
  it('returns 409 naming the in-flight run when the lock is held (AC-15, E-11)', async () => {
    const repo = fakeRepo();
    repo.acquireLock.mockRejectedValueOnce(new LockHeldError('held', 'run-inflight'));
    const api = apiFor({});
    const res = await handleRefresh(api, [publisher], repo as any, 'run-5', 't');
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).runId).toBe('run-inflight'); // 409 carries the in-flight run id (R-15)
    expect(repo.ingestContract).not.toHaveBeenCalled();
  });

  it('acquires the lock, writes the run, releases the lock on success', async () => {
    const api = apiFor({ publish: { tree: [], blobs: {} } });
    const repo = fakeRepo();
    const res = await handleRefresh(api, [publisher], repo as any, 'run-6', 't');
    expect(res.statusCode).toBe(200);
    expect(repo.acquireLock).toHaveBeenCalled();
    expect(repo.writeRun).toHaveBeenCalled();
    expect(repo.releaseLock).toHaveBeenCalled();
  });
});
