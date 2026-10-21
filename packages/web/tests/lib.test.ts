import { describe, it, expect } from 'vitest';
import {
  decodeGroups,
  isWriter,
  groupByEntity,
  groupBySource,
  groupRequirementsBySection,
  sortFindings,
  filterFindings,
  effectiveVerdict,
  formatRunLabel,
  type Entry,
  type RequirementEntry,
  type AdversarialFinding,
  type AdversarialRunSummary,
} from '../src/lib.js';

// Build a fake JWT with the given payload (header.payload.sig).
function jwt(payload: object): string {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'none' })}.${b64(payload)}.sig`;
}

describe('decodeGroups / isWriter (T-14)', () => {
  it('extracts cognito:groups from an access token', () => {
    expect(decodeGroups(jwt({ 'cognito:groups': ['writer', 'reader'] }))).toEqual(['writer', 'reader']);
    expect(decodeGroups(jwt({ sub: 'x' }))).toEqual([]);
    expect(decodeGroups(undefined)).toEqual([]);
    expect(decodeGroups('garbage')).toEqual([]);
  });
  it('isWriter is true only when the writer group is present', () => {
    expect(isWriter(jwt({ 'cognito:groups': ['writer'] }))).toBe(true);
    expect(isWriter(jwt({ 'cognito:groups': ['reader'] }))).toBe(false);
  });
});

describe('groupByEntity (T-15 · R-61)', () => {
  const entries: Entry[] = [
    { source: 'publisher', id: 'org', entity: 'org', currentVersion: 1, currentHash: 'h', validation: 'valid' },
    { source: 'consumer', id: 'org', entity: 'org', currentVersion: 1, currentHash: 'h', validation: 'valid' },
    { source: 'publisher', id: 'user', entity: 'user', currentVersion: 1, currentHash: 'hA', validation: 'valid' },
    { source: 'consumer', id: 'user', entity: 'user', currentVersion: 2, currentHash: 'hB', validation: 'valid' },
  ];
  it('groups variants by entity and flags divergence by hash', () => {
    const groups = groupByEntity(entries);
    const org = groups.find((g) => g.entity === 'org')!;
    const user = groups.find((g) => g.entity === 'user')!;
    expect(org.variants).toHaveLength(2);
    expect(org.divergent).toBe(false); // identical hashes
    expect(user.divergent).toBe(true); // hA vs hB
  });
});

describe('groupBySource (T-17 · R-65)', () => {
  const entries: Entry[] = [
    { source: 'publisher', id: 'user', entity: 'user', currentVersion: 1, currentHash: 'hA', validation: 'valid' },
    { source: 'consumer', id: 'org', entity: 'org', currentVersion: 1, currentHash: 'h', validation: 'valid' },
    { source: 'publisher', id: 'org', entity: 'org', currentVersion: 1, currentHash: 'h', validation: 'valid' },
    { source: 'consumer', id: 'user', entity: 'user', currentVersion: 2, currentHash: 'hB', validation: 'invalid' },
  ];

  it('groups every contract under its source, sources sorted, contracts sorted by entity', () => {
    const groups = groupBySource(entries);
    // one group per distinct source, alphabetically ordered (consumer before publisher)
    expect(groups.map((g) => g.source)).toEqual(['consumer', 'publisher']);
    const publisher = groups.find((g) => g.source === 'publisher')!;
    // each source carries all of its own contracts, sorted by entity
    expect(publisher.contracts.map((c) => c.entity)).toEqual(['org', 'user']);
    expect(publisher.contracts).toHaveLength(2);
    // rows preserve the fields the summary needs (entity, version, validation)
    const consumerUser = groups.find((g) => g.source === 'consumer')!.contracts.find((c) => c.entity === 'user')!;
    expect(consumerUser.currentVersion).toBe(2);
    expect(consumerUser.validation).toBe('invalid');
  });

  it('returns an empty list for an empty catalog', () => {
    expect(groupBySource([])).toEqual([]);
  });
});

describe('groupRequirementsBySection (T-31 · R-113)', () => {
  const reqs: RequirementEntry[] = [
    {
      source: 'publisher',
      id: 'R-01',
      text: 'a',
      section: 'Contract',
      earsType: 'ubiquitous',
      modality: 'SHALL',
      earsConforming: true,
      changedInLastCrawl: false,
    },
    {
      source: 'publisher',
      id: 'R-10',
      text: 'b',
      section: 'API',
      earsType: 'event',
      modality: 'SHALL',
      earsConforming: true,
      changedInLastCrawl: true,
    },
    {
      source: 'publisher',
      id: 'R-11',
      text: 'c',
      section: 'API',
      earsType: 'unwanted',
      modality: 'SHALL',
      earsConforming: true,
      changedInLastCrawl: false,
    },
    {
      source: 'consumer',
      id: 'R-20',
      text: 'd',
      section: 'Ingest',
      earsType: 'ubiquitous',
      modality: null,
      earsConforming: false,
      changedInLastCrawl: false,
    },
  ];

  it('groups requirements by source (sorted), then by section (first-seen order)', () => {
    const groups = groupRequirementsBySection(reqs);
    expect(groups.map((g) => g.source)).toEqual(['consumer', 'publisher']);
    const publisher = groups.find((g) => g.source === 'publisher')!;
    expect(publisher.sections.map((s) => s.section)).toEqual(['Contract', 'API']);
    const api = publisher.sections.find((s) => s.section === 'API')!;
    expect(api.requirements.map((r) => r.id)).toEqual(['R-10', 'R-11']);
  });

  it('returns an empty list when there are no requirements', () => {
    expect(groupRequirementsBySection([])).toEqual([]);
  });
});

// --- Adversarial helpers (T-AR-04 · R-22, R-25, R-27) ---

const f: (overrides: Partial<AdversarialFinding> & Pick<AdversarialFinding, 'id' | 'severity'>) => AdversarialFinding =
  (o) => ({ target: 'f.ts:1', defect: 'd', failureScenario: 'fs', ...o });

describe('effectiveVerdict (T-AR-04)', () => {
  const withVerification = f({ id: 'F-01', severity: 'Critical', verification: { verdict: 'CONFIRMED', reason: 'r' } });
  const withoutVerification = f({ id: 'F-02', severity: 'Major' });

  it('returns the finding verdict when verificationStatus is ok', () => {
    expect(effectiveVerdict(withVerification, 'ok')).toBe('CONFIRMED');
  });
  it('returns unverified when verificationStatus is stale', () => {
    expect(effectiveVerdict(withVerification, 'stale')).toBe('unverified');
  });
  it('returns unverified when verificationStatus is invalid', () => {
    expect(effectiveVerdict(withVerification, 'invalid')).toBe('unverified');
  });
  it('returns unverified when verification field is absent even if status is ok', () => {
    expect(effectiveVerdict(withoutVerification, 'ok')).toBe('unverified');
  });
});

describe('sortFindings (T-AR-04)', () => {
  const findings: AdversarialFinding[] = [
    f({ id: 'F-01', severity: 'Minor', verification: { verdict: 'CONFIRMED', reason: 'r' } }),
    f({ id: 'F-02', severity: 'Critical', verification: { verdict: 'REFUTED', reason: 'r' } }),
    f({ id: 'F-03', severity: 'Major' }),
  ];
  const naturalIds: AdversarialFinding[] = [
    f({ id: 'F-10', severity: 'Minor' }),
    f({ id: 'F-9', severity: 'Minor' }),
    f({ id: 'F-1', severity: 'Minor' }),
  ];

  it('(a) sorts severity descending (Critical first) by default', () => {
    const sorted = sortFindings(findings, 'severity', false);
    expect(sorted.map((x) => x.severity)).toEqual(['Critical', 'Major', 'Minor']);
  });
  it('sorts severity ascending (Minor first) when asc=true', () => {
    const sorted = sortFindings(findings, 'severity', true);
    expect(sorted.map((x) => x.severity)).toEqual(['Minor', 'Major', 'Critical']);
  });
  it('(b) sorts id naturally ascending — F-1 F-9 F-10, not F-1 F-10 F-9', () => {
    const sorted = sortFindings(naturalIds, 'id', true);
    expect(sorted.map((x) => x.id)).toEqual(['F-1', 'F-9', 'F-10']);
  });
  it('breaks ties by id ascending', () => {
    const tied = [
      f({ id: 'F-03', severity: 'Major' }),
      f({ id: 'F-01', severity: 'Major' }),
      f({ id: 'F-02', severity: 'Major' }),
    ];
    expect(sortFindings(tied, 'severity', false).map((x) => x.id)).toEqual(['F-01', 'F-02', 'F-03']);
  });
  it('does not mutate the original array', () => {
    const orig = [...findings];
    sortFindings(findings, 'severity', false);
    expect(findings).toEqual(orig);
  });
});

describe('filterFindings (T-AR-04)', () => {
  const findings: AdversarialFinding[] = [
    f({ id: 'F-01', severity: 'Critical', verification: { verdict: 'CONFIRMED', reason: 'r' } }),
    f({ id: 'F-02', severity: 'Critical', verification: { verdict: 'REFUTED', reason: 'r' } }),
    f({ id: 'F-03', severity: 'Major' }),
    f({ id: 'F-04', severity: 'Minor', verification: { verdict: 'UNCLEAR', reason: 'r' } }),
  ];

  it('(c) severity filter=Critical → only Critical rows', () => {
    const result = filterFindings(findings, new Set(['Critical']), new Set(), 'ok');
    expect(result.map((x) => x.id)).toEqual(['F-01', 'F-02']);
  });
  it('(d) verdict filter=unverified with stale → all findings (all unverified when stale)', () => {
    const result = filterFindings(findings, new Set(), new Set(['unverified']), 'stale');
    expect(result).toHaveLength(4);
  });
  it('(e) Critical severity + CONFIRMED verdict chips → AND logic: only Critical CONFIRMED', () => {
    const result = filterFindings(findings, new Set(['Critical']), new Set(['CONFIRMED']), 'ok');
    expect(result.map((x) => x.id)).toEqual(['F-01']);
  });
  it('(f) empty filter sets → all rows', () => {
    expect(filterFindings(findings, new Set(), new Set(), 'ok')).toHaveLength(4);
  });
  it('verdict filter=unverified matches findings with no verification object', () => {
    const result = filterFindings(findings, new Set(), new Set(['unverified']), 'ok');
    expect(result.map((x) => x.id)).toEqual(['F-03']);
  });
});

describe('formatRunLabel (T-AR-04)', () => {
  it('formats startedAt in local time with scope appended', () => {
    const run: AdversarialRunSummary = {
      reviewKind: 'test',
      run_dir: '20261021-1430_test_main',
      startedAt: '2026-10-21T14:30:00Z',
      scope: 'main',
      verdict: 'PASS',
      countCritical: 0,
      countMajor: 0,
      countMinor: 0,
      verificationStatus: 'ok',
    };
    const label = formatRunLabel(run);
    // Label ends with " — main" regardless of local timezone
    expect(label).toMatch(/— main$/);
    // Contains date portion from the ISO string
    expect(label).toMatch(/2026/);
  });
});
