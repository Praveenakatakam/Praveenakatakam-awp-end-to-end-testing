import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { performCrawl, handleRefresh, assertJiraConfigured, type JiraSourceConfig, type JiraApi } from '../src/refresh.js';
import type { GitHubApi, TreeEntry } from '@registry/core';
import { LockHeldError } from '../src/repository.js';
import { JiraApiError, JiraTimeoutError, type JiraStory, type AdfDocument } from '../src/jira.js';

const coreFixtures = resolve(dirname(fileURLToPath(import.meta.url)), '../../core/tests/__fixtures__');
const validOrgYaml = readFileSync(resolve(coreFixtures, 'valid-org.odcs.yaml'), 'utf8');

// Use source labels matching the real SOURCES config (awp-app-plane, D-63).
// Tests that need two sources (fault isolation, multi-source requirements) use
// two distinct fictitious source entries with different repo/owner values so the
// fake API can route blobs by repo name.
const awpSrc = { label: 'awp-app-plane', owner: 'o', repo: 'awp', branch: 'feat', contractPathPrefix: 'docs/contracts/' };
const secondSrc = { label: 'awp-app-plane-b', owner: 'o', repo: 'awpb', branch: 'feat', contractPathPrefix: 'docs/contracts/' };

// Aliases kept for tests that only care about label values (requirements crawl, etc.)
const publisher = awpSrc;
const consumer = secondSrc;

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
    getEarsCache: vi.fn(async (): Promise<string | null> => null),
    putEarsCache: vi.fn(async () => {}),
  };
}

// ---- Jira crawl fixtures (T-07 · JR-10..17, JR-20..23, JR-30..32, NFR-J1..J4) ----

const jiraSrc: JiraSourceConfig = {
  label: 'jira-awp',
  baseUrl: 'https://collegeboard.atlassian.net',
  jql: 'project = BAWP AND issuetype = Story AND status != Done',
  acFieldId: 'customfield_11048',
  serviceAccountEmail: 'nashah@collegeboard.org',
};

function adfText(text: string): AdfDocument {
  return { type: 'doc', content: text ? [{ type: 'paragraph', content: [{ type: 'text', text }] }] : [] };
}

/** Fake Jira client: yields the given stories, then optionally throws (mid-search failure). */
function fakeJiraApi(stories: JiraStory[], opts: { failWith?: Error } = {}): JiraApi {
  return {
    async *search() {
      for (const s of stories) yield s;
      if (opts.failWith) throw opts.failWith;
    },
  };
}

const earsStory: JiraStory = {
  key: 'BAWP-1',
  fields: {
    customfield_11048: adfText('WHEN a user submits THE system SHALL save it'),
    parent: { key: 'BAWP-EP-1', fields: { summary: 'Checkout Epic', issuetype: { name: 'Epic' } } },
  },
};
const nonEarsStory: JiraStory = {
  key: 'BAWP-2',
  fields: { customfield_11048: adfText('the button must turn green when clicked') },
};
const blankAcStory: JiraStory = {
  key: 'BAWP-3',
  fields: { customfield_11048: adfText('   ') }, // whitespace-only — treated as absent (JR-11)
};

// A minimal docs/spec.md with two requirements under the EARS section.
const SPEC_MD = `# App Spec

> **Spec version:** 0.1.0

## 3. Functional Requirements (EARS)

### 3.1 Contract

**R-01** The system SHALL define a contract.
**R-10** WHEN a client calls, THE API SHALL respond.
`;

describe('performCrawl (T-12 · R-10..R-14, R-23)', () => {
  it('catalogs only docs/contracts/*.odcs.ya?ml and reports counts (AC-10, AC-12, AC-23)', async () => {
    const api = apiFor({
      awp: {
        tree: [
          { path: 'docs/contracts/org.odcs.yaml', sha: 's1', type: 'blob' },
          { path: 'docs/contracts/org.schema.json', sha: 's2', type: 'blob' },
          { path: 'docs/contracts/odcs-v3.1.0.schema.json', sha: 's3', type: 'blob' },
        ],
        blobs: { s1: validOrgYaml },
      },
    });
    const repo = fakeRepo();
    const s = await performCrawl(api, [awpSrc], repo as any, 'run-1', '2026-07-08T00:00:00Z');
    expect(repo.ingestContract).toHaveBeenCalledTimes(1); // schema.json + meta-schema ignored (AC-23)
    expect(s.sources[0]).toMatchObject({ label: 'awp-app-plane', outcome: 'success', discovered: 1, valid: 1, newVersion: 1 });
  });

  it('isolates a failing source; others still catalog (AC-13)', async () => {
    const api = apiFor({
      awp: { tree: [], blobs: {}, fail: true },
      awpb: { tree: [{ path: 'docs/contracts/org.odcs.yaml', sha: 's1', type: 'blob' }], blobs: { s1: validOrgYaml } },
    });
    const repo = fakeRepo();
    const s = await performCrawl(api, [awpSrc, secondSrc], repo as any, 'run-2', 't');
    const first = s.sources.find((x) => x.label === 'awp-app-plane')!;
    const second = s.sources.find((x) => x.label === 'awp-app-plane-b')!;
    expect(first.outcome).toBe('failed');
    expect(first.reason).toMatch(/503/);
    expect(second.outcome).toBe('success');
    expect(second.discovered).toBe(1);
  });

  it('marks an empty source success with zero discoveries (AC-14)', async () => {
    const api = apiFor({ awp: { tree: [], blobs: {} } });
    const repo = fakeRepo();
    const s = await performCrawl(api, [awpSrc], repo as any, 'run-3', 't');
    expect(s.sources[0]).toMatchObject({ outcome: 'success', discovered: 0 });
  });

  it('flags an in-source id collision and catalogs only the first (AC-30a)', async () => {
    const api = apiFor({
      awp: {
        tree: [
          { path: 'docs/contracts/org.odcs.yaml', sha: 's1', type: 'blob' },
          { path: 'docs/contracts/org-copy.odcs.yaml', sha: 's2', type: 'blob' },
        ],
        blobs: { s1: validOrgYaml, s2: validOrgYaml }, // same id
      },
    });
    const repo = fakeRepo();
    const s = await performCrawl(api, [awpSrc], repo as any, 'run-4', 't');
    expect(repo.ingestContract).toHaveBeenCalledTimes(1);
    expect(s.collisions).toHaveLength(1);
    expect(s.collisions[0].paths).toEqual(['docs/contracts/org.odcs.yaml', 'docs/contracts/org-copy.odcs.yaml']);
  });
});

describe('requirements crawl integration (T-29 · R-100, R-101, R-105, R-108)', () => {
  it('fetches + parses + stores docs/spec.md and folds counts into the summary (AC-100/101/108)', async () => {
    const api = apiFor({
      awp: {
        tree: [
          { path: 'docs/contracts/org.odcs.yaml', sha: 's1', type: 'blob' },
          { path: 'docs/spec.md', sha: 'spec-sha', type: 'blob' },
        ],
        blobs: { s1: validOrgYaml, 'spec-sha': SPEC_MD },
      },
    });
    const repo = fakeRepo();
    const s = await performCrawl(api, [awpSrc], repo as any, 'run-req', 't');

    expect(repo.putRequirements).toHaveBeenCalledTimes(1);
    const [src, parsed, opts] = repo.putRequirements.mock.calls[0] as unknown as [string, any[], any];
    expect(src).toBe('awp-app-plane');
    expect(parsed.map((r: any) => r.id)).toEqual(['R-01', 'R-10']);
    expect(opts).toMatchObject({ contentHash: 'spec-sha', sourceVersion: '0.1.0', rawSnapshot: SPEC_MD, snapshotKey: 'requirements/awp-app-plane/snapshot.md' });
    expect(s.sources[0].requirements).toEqual({ discovered: 2, conforming: 2, nonConforming: 0, changed: 2, removed: 0 });
  });

  it('wipes the snapshot when a reachable source has no docs/spec.md (AC-105 absent → wipe)', async () => {
    const api = apiFor({ awp: { tree: [{ path: 'docs/contracts/org.odcs.yaml', sha: 's1', type: 'blob' }], blobs: { s1: validOrgYaml } } });
    const repo = fakeRepo();
    const s = await performCrawl(api, [awpSrc], repo as any, 'run-nospec', 't');
    expect(repo.wipeRequirements).toHaveBeenCalledWith('awp-app-plane');
    expect(repo.putRequirements).not.toHaveBeenCalled();
    expect(s.sources[0]).toMatchObject({ outcome: 'success', requirements: { discovered: 0, removed: 3 } });
  });

  it('wipes via putRequirements([]) when docs/spec.md is present but has no requirements section (AC-105 present-but-empty)', async () => {
    const api = apiFor({
      awp: {
        tree: [
          { path: 'docs/contracts/org.odcs.yaml', sha: 's1', type: 'blob' },
          { path: 'docs/spec.md', sha: 'spec-sha', type: 'blob' },
        ],
        // spec.md exists and fetches fine, but has no `## 3.` requirements section → parse → []
        blobs: { s1: validOrgYaml, 'spec-sha': '# App\n\n## 2. Out of Scope\n\n**R-99** not under a requirements section.\n' },
      },
    });
    const repo = fakeRepo();
    const s = await performCrawl(api, [awpSrc], repo as any, 'run-nosection', 't');
    // present-but-empty is an OBSERVED "zero requirements" → putRequirements([]) (wipe),
    // NOT wipeRequirements (that's the absent case) and NOT a requirements failure.
    expect(repo.putRequirements).toHaveBeenCalledWith('awp-app-plane', [], expect.anything());
    expect(repo.wipeRequirements).not.toHaveBeenCalled();
    expect(s.sources[0].requirements).not.toMatchObject({ failed: true });
  });

  it('leaves prior requirements untouched when the source fetch fails (AC-105 fail / E-36 / R-13)', async () => {
    const api = apiFor({ awp: { tree: [], blobs: {}, fail: true } });
    const repo = fakeRepo();
    const s = await performCrawl(api, [awpSrc], repo as any, 'run-fail', 't');
    // crawlSourceFull throws first → neither put nor wipe runs → prior snapshot kept
    expect(repo.putRequirements).not.toHaveBeenCalled();
    expect(repo.wipeRequirements).not.toHaveBeenCalled();
    expect(s.sources[0].outcome).toBe('failed');
  });

  it('isolates a requirements-store failure: contracts stay cataloged, requirements marked failed (AC-105a / E-37)', async () => {
    const api = apiFor({
      awp: {
        tree: [
          { path: 'docs/contracts/org.odcs.yaml', sha: 's1', type: 'blob' },
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
      s = await performCrawl(api, [awpSrc], repo as any, 'run-reqfail', 't');
    } finally {
      spy.mockRestore();
    }
    // contract crawl unaffected; source not failed
    expect(repo.ingestContract).toHaveBeenCalledTimes(1);
    expect(s.sources[0].outcome).toBe('success');
    expect(s.sources[0]).toMatchObject({ valid: 1, requirements: { failed: true } });
    // AC-105a: the isolated failure is logged
    expect(lines.map((l) => JSON.parse(l)).some((e) => e.event === 'crawl.requirements.failed' && e.source === 'awp-app-plane')).toBe(true);
  });

  it('logs crawl.requirements.collision when a source repeats an R-nn (D-49 / E-38)', async () => {
    const api = apiFor({
      awp: {
        tree: [
          { path: 'docs/contracts/org.odcs.yaml', sha: 's1', type: 'blob' },
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
      await performCrawl(api, [awpSrc], repo as any, 'run-reqcollide', 't');
    } finally {
      spy.mockRestore();
    }
    const collision = lines.map((l) => JSON.parse(l)).find((e) => e.event === 'crawl.requirements.collision');
    expect(collision).toMatchObject({ source: 'awp-app-plane', ids: ['R-10'] });
  });

  it('isolates a docs/spec.md FETCH failure: contracts cataloged, requirements failed + event logged, other source unaffected (M2 / R-105a / E-37)', async () => {
    // First source's spec-blob fetch throws; its tree + contract blob succeed.
    const api: GitHubApi = {
      branchHeadSha: vi.fn(async (_o, repo) => 'c-' + repo),
      tree: vi.fn(async (_o, repo) => [
        { path: 'docs/contracts/org.odcs.yaml', sha: repo + '-c', type: 'blob' },
        { path: 'docs/spec.md', sha: repo + '-spec', type: 'blob' },
      ]),
      blob: vi.fn(async (_o, _r, sha) => {
        if (sha === 'awp-spec') throw new Error('GitHub 500 reading blob');
        if (sha === 'awpb-spec') return SPEC_MD;
        return validOrgYaml; // contract blobs
      }),
    };
    const repo = fakeRepo();
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((l: string) => void lines.push(l));
    let s;
    try {
      s = await performCrawl(api, [awpSrc, secondSrc], repo as any, 'run-specfail', 't');
    } finally {
      spy.mockRestore();
    }
    const first = s.sources.find((x) => x.label === 'awp-app-plane')!;
    const second = s.sources.find((x) => x.label === 'awp-app-plane-b')!;
    // first source's docs/spec.md fetch failed, yet its contract is cataloged and the source is NOT failed
    expect(first.outcome).toBe('success');
    expect(first.valid).toBe(1);
    expect(first.requirements).toMatchObject({ failed: true });
    // second source entirely unaffected — its requirements stored fine
    expect(second.outcome).toBe('success');
    expect(repo.putRequirements).toHaveBeenCalledWith('awp-app-plane-b', expect.anything(), expect.anything());
    // the failure event fired, naming the first source (NFR-5 / D-43 taxonomy)
    const events = lines.map((l) => JSON.parse(l));
    expect(events.some((e) => e.event === 'crawl.requirements.failed' && e.source === 'awp-app-plane')).toBe(true);
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
      awp: {
        tree: [
          { path: 'docs/contracts/org.odcs.yaml', sha: 's1', type: 'blob' },
          { path: 'docs/contracts/bad.odcs.yaml', sha: 's2', type: 'blob' },
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
    expect(invalid).toMatchObject({ source: 'awp-app-plane', path: 'docs/contracts/bad.odcs.yaml' });
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

describe('assertJiraConfigured — fast-fail guard (design §2.5, edge case table)', () => {
  it('throws when JIRA_API_TOKEN is blank', () => {
    expect(() => assertJiraConfigured({ JIRA_API_TOKEN: '' })).toThrow('JIRA_API_TOKEN secret is absent or blank');
  });

  it('throws when JIRA_API_TOKEN is absent entirely', () => {
    expect(() => assertJiraConfigured({})).toThrow('JIRA_API_TOKEN secret is absent or blank');
  });

  it('does not throw when JIRA_API_TOKEN is present', () => {
    expect(() => assertJiraConfigured({ JIRA_API_TOKEN: 'shh-a-real-token' })).not.toThrow();
  });
});

describe('Jira crawl integration (T-07 · JR-10..17, JR-20..23, JR-30..32, NFR-J1..J4)', () => {
  it('stores an EARS-conforming story as-is, converts a non-EARS story, and skips a blank-AC story (JR-11,12,13,20,21,30,31)', async () => {
    const api = apiFor({ awp: { tree: [], blobs: {} } });
    const repo = fakeRepo();
    const convert = vi.fn(async () => 'WHEN the button is clicked THE system SHALL turn it green');

    const result = await performCrawl(api, [publisher], repo as any, 'run-j1', 't', {
      sources: [jiraSrc],
      clientFor: () => fakeJiraApi([earsStory, nonEarsStory, blankAcStory]),
      convert,
    });

    expect(convert).toHaveBeenCalledTimes(1); // only the non-EARS story needs conversion
    expect(convert).toHaveBeenCalledWith('the button must turn green when clicked', { timeoutMs: 10_000 });

    expect(repo.putRequirements).toHaveBeenCalledTimes(1);
    const [source, parsed, opts] = repo.putRequirements.mock.calls[0] as unknown as [string, any[], any];
    expect(source).toBe('jira-awp');
    expect(parsed.map((p: any) => p.id)).toEqual(['BAWP-1', 'BAWP-2']); // blank-AC story never appears

    expect(parsed[0]).toMatchObject({
      id: 'BAWP-1',
      text: 'WHEN a user submits THE system SHALL save it',
      section: 'Checkout Epic',
      earsType: 'event',
      modality: 'SHALL',
      earsConforming: true,
      jiraUrl: 'https://collegeboard.atlassian.net/browse/BAWP-1',
    });
    expect(parsed[0].rawText).toBeUndefined(); // already-EARS — no rawText (edge case table)

    expect(parsed[1]).toMatchObject({
      id: 'BAWP-2',
      text: 'WHEN the button is clicked THE system SHALL turn it green',
      rawText: 'the button must turn green when clicked',
      section: 'Uncategorised', // no parent epic
      earsConforming: true,
      jiraUrl: 'https://collegeboard.atlassian.net/browse/BAWP-2',
    });

    expect(opts).toMatchObject({ snapshotKey: 'requirements/jira-awp/snapshot.json' });
    expect(opts.rawSnapshot).toContain('BAWP-1'); // raw JQL snapshot stored for provenance (JR-17)

    const jiraOutcome = result.sources.find((s) => s.label === 'jira-awp')!;
    expect(jiraOutcome.outcome).toBe('success');
  });

  it('falls back to the epic key when the epic is linked but has no fetchable name (edge case table)', async () => {
    const api = apiFor({ awp: { tree: [], blobs: {} } });
    const repo = fakeRepo();
    const storyWithNamelessEpic: JiraStory = {
      key: 'BAWP-4',
      fields: {
        customfield_11048: adfText('WHEN x THE system SHALL y'),
        parent: { key: 'BAWP-EP-4', fields: { issuetype: { name: 'Epic' } } } as any, // no summary
      },
    };

    await performCrawl(api, [publisher], repo as any, 'run-j1c', 't', {
      sources: [jiraSrc],
      clientFor: () => fakeJiraApi([storyWithNamelessEpic]),
    });

    const [, parsed] = repo.putRequirements.mock.calls[0] as unknown as [string, any[]];
    expect(parsed[0]).toMatchObject({ id: 'BAWP-4', section: 'BAWP-EP-4' });
  });

  it('uses the EARS cache instead of calling convert on a cache hit, and does not re-cache it (JR-23)', async () => {
    const api = apiFor({ awp: { tree: [], blobs: {} } });
    const repo = fakeRepo();
    repo.getEarsCache.mockResolvedValueOnce('WHEN cached THE system SHALL apply');
    const convert = vi.fn(async () => {
      throw new Error('convert should not be called on a cache hit');
    });

    await performCrawl(api, [publisher], repo as any, 'run-j2', 't', {
      sources: [jiraSrc],
      clientFor: () => fakeJiraApi([nonEarsStory]),
      convert,
    });

    expect(convert).not.toHaveBeenCalled();
    expect(repo.putEarsCache).not.toHaveBeenCalled();
    const [, parsed] = repo.putRequirements.mock.calls[0] as unknown as [string, any[]];
    expect(parsed[0]).toMatchObject({ text: 'WHEN cached THE system SHALL apply', rawText: 'the button must turn green when clicked' });
  });

  it('caches a fresh conversion after a miss (JR-23)', async () => {
    const api = apiFor({ awp: { tree: [], blobs: {} } });
    const repo = fakeRepo();
    const convert = vi.fn(async () => 'WHEN converted THE system SHALL apply');

    await performCrawl(api, [publisher], repo as any, 'run-j2b', 't', {
      sources: [jiraSrc],
      clientFor: () => fakeJiraApi([nonEarsStory]),
      convert,
    });

    expect(repo.putEarsCache).toHaveBeenCalledWith(expect.any(String), 'WHEN converted THE system SHALL apply');
  });

  it('falls back to raw text with earsConforming=false when EARS conversion fails (JR-22, NFR-J3)', async () => {
    const api = apiFor({ awp: { tree: [], blobs: {} } });
    const repo = fakeRepo();
    const convert = vi.fn(async () => {
      throw new Error('bedrock unavailable');
    });

    await performCrawl(api, [publisher], repo as any, 'run-j3', 't', {
      sources: [jiraSrc],
      clientFor: () => fakeJiraApi([nonEarsStory]),
      convert,
    });

    const [, parsed] = repo.putRequirements.mock.calls[0] as unknown as [string, any[]];
    expect(parsed[0]).toMatchObject({
      text: 'the button must turn green when clicked',
      rawText: 'the button must turn green when clicked',
      earsConforming: false,
      modality: null,
    });
  });

  it('marks the Jira source failed without touching prior data when the search itself fails; GitHub sources still complete (JR-15, NFR-J4)', async () => {
    const api = apiFor({ awp: { tree: [], blobs: {} } });
    const repo = fakeRepo();

    const result = await performCrawl(api, [publisher], repo as any, 'run-j4', 't', {
      sources: [jiraSrc],
      clientFor: () => fakeJiraApi([], { failWith: new JiraApiError('Jira search failed (401)', 401) }),
    });

    const jiraOutcome = result.sources.find((s) => s.label === 'jira-awp')!;
    expect(jiraOutcome.outcome).toBe('failed');
    expect(jiraOutcome.reason).toContain('401');
    expect(repo.putRequirements).not.toHaveBeenCalled();

    const ghOutcome = result.sources.find((s) => s.label === 'awp-app-plane')!;
    expect(ghOutcome.outcome).toBe('success'); // GitHub source unaffected
  });

  it('marks the Jira source failed on a cumulative timeout, discarding partial results (design §6 failure mode 8)', async () => {
    const api = apiFor({ awp: { tree: [], blobs: {} } });
    const repo = fakeRepo();

    const result = await performCrawl(api, [publisher], repo as any, 'run-j4b', 't', {
      sources: [jiraSrc],
      clientFor: () => fakeJiraApi([earsStory], { failWith: new JiraTimeoutError() }),
    });

    const jiraOutcome = result.sources.find((s) => s.label === 'jira-awp')!;
    expect(jiraOutcome.outcome).toBe('failed');
    expect(repo.putRequirements).not.toHaveBeenCalled(); // partial results discarded, prior snapshot preserved
  });

  it('a failing GitHub source does not prevent the Jira source from completing (NFR-J4)', async () => {
    const api = apiFor({ awp: { fail: true, tree: [], blobs: {} } });
    const repo = fakeRepo();

    const result = await performCrawl(api, [publisher], repo as any, 'run-j5', 't', {
      sources: [jiraSrc],
      clientFor: () => fakeJiraApi([earsStory]),
    });

    expect(result.sources.find((s) => s.label === 'awp-app-plane')!.outcome).toBe('failed');
    expect(result.sources.find((s) => s.label === 'jira-awp')!.outcome).toBe('success');
  });

  it('treats 0 Jira search results as unchanged — success with zero counts, no wipe (edge case table)', async () => {
    const api = apiFor({ awp: { tree: [], blobs: {} } });
    const repo = fakeRepo();

    const result = await performCrawl(api, [publisher], repo as any, 'run-j6', 't', {
      sources: [jiraSrc],
      clientFor: () => fakeJiraApi([]),
    });

    const jiraOutcome = result.sources.find((s) => s.label === 'jira-awp')!;
    expect(jiraOutcome.outcome).toBe('success');
    expect(jiraOutcome.requirements).toEqual({ discovered: 0, conforming: 0, nonConforming: 0, changed: 0, removed: 0 });
    expect(repo.putRequirements).not.toHaveBeenCalled();
  });

  it('no Jira crawling happens when the jira param is omitted (backward compatible with GitHub-only callers)', async () => {
    const api = apiFor({ awp: { tree: [], blobs: {} } });
    const repo = fakeRepo();
    const result = await performCrawl(api, [publisher], repo as any, 'run-j7', 't');
    expect(result.sources.map((s) => s.label)).toEqual(['awp-app-plane']);
  });

  it("reduces the Jira search budget by however much of the overall crawl the GitHub phase already used (NFR-J1)", async () => {
    vi.useFakeTimers();
    try {
      const start = new Date('2026-01-01T00:00:00.000Z');
      vi.setSystemTime(start);
      const api: GitHubApi = {
        branchHeadSha: vi.fn(async () => {
          vi.setSystemTime(new Date(start.getTime() + 15_000)); // GitHub phase alone takes 15s
          return 'commit-awp';
        }),
        tree: vi.fn(async () => []),
        blob: vi.fn(async () => ''),
      };
      const repo = fakeRepo();
      let capturedTimeoutMs: number | undefined;
      const jiraApi: JiraApi = {
        // eslint-disable-next-line require-yield -- test double; never yields
        async *search(_jql, _acFieldId, opts) {
          capturedTimeoutMs = opts.timeoutMs;
        },
      };

      await performCrawl(api, [publisher], repo as any, 'run-budget', start.toISOString(), {
        sources: [jiraSrc],
        clientFor: () => jiraApi,
      });

      // 28s overall budget (NFR-1's 30s minus a safety margin) - 15s already spent ≈ 13s left.
      expect(capturedTimeoutMs).toBeLessThan(20_000);
      expect(capturedTimeoutMs).toBeCloseTo(13_000, -3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('marks the Jira source failed without ever calling search when no crawl budget remains (NFR-J1)', async () => {
    vi.useFakeTimers();
    try {
      const start = new Date('2026-01-01T00:00:00.000Z');
      vi.setSystemTime(start);
      const api: GitHubApi = {
        branchHeadSha: vi.fn(async () => {
          vi.setSystemTime(new Date(start.getTime() + 29_000)); // GitHub phase alone blew the budget
          return 'commit-awp';
        }),
        tree: vi.fn(async () => []),
        blob: vi.fn(async () => ''),
      };
      const repo = fakeRepo();
      const searchSpy = vi.fn();

      const result = await performCrawl(api, [publisher], repo as any, 'run-budget2', start.toISOString(), {
        sources: [jiraSrc],
        clientFor: () => ({ search: searchSpy as any }),
      });

      expect(searchSpy).not.toHaveBeenCalled();
      const jiraOutcome = result.sources.find((s) => s.label === 'jira-awp')!;
      expect(jiraOutcome.outcome).toBe('failed');
      expect(jiraOutcome.reason).toMatch(/budget|time/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it('redacts the Jira token and service-account email from a search failure before it reaches the crawl summary (NFR-J2)', async () => {
    const api = apiFor({ awp: { tree: [], blobs: {} } });
    const repo = fakeRepo();
    const SECRET_TOKEN = 'super-secret-jira-token-xyz';
    const SECRET_EMAIL = jiraSrc.serviceAccountEmail;

    const result = await performCrawl(api, [publisher], repo as any, 'run-secret', 't', {
      sources: [jiraSrc],
      clientFor: () => fakeJiraApi([], { failWith: new Error(`401 unauthorized for token ${SECRET_TOKEN} account ${SECRET_EMAIL}`) }),
      secrets: [SECRET_TOKEN, SECRET_EMAIL],
    });

    const jiraOutcome = result.sources.find((s) => s.label === 'jira-awp')!;
    expect(jiraOutcome.reason).not.toContain(SECRET_TOKEN);
    expect(jiraOutcome.reason).not.toContain(SECRET_EMAIL);
    expect(jiraOutcome.reason).toContain('[redacted]');
  });
});
