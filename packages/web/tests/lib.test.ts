import { describe, it, expect } from 'vitest';
import {
  decodeGroups,
  isWriter,
  groupByEntity,
  groupBySource,
  groupRequirementsBySection,
  type Entry,
  type RequirementEntry,
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
