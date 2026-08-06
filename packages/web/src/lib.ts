/**
 * Pure SPA helpers (T-14/T-15) — kept out of components so they unit-test
 * without a DOM.
 */

export interface Entry {
  source: string;
  id: string;
  entity: string;
  name?: string;
  domain?: string;
  currentVersion: number;
  currentHash: string;
  validation: string;
}

export interface EntityGroup {
  entity: string;
  variants: Entry[];
  divergent: boolean;
}

export interface SourceGroup {
  /** The ODCS domain (e.g. "deliver", "onboard"), or the crawler source label when domain is absent. */
  source: string;
  contracts: Entry[];
}

/** A cataloged EARS requirement (mirror of the API projection — §3.10, R-109). */
export interface RequirementEntry {
  source: string;
  id: string;
  text: string;
  section: string;
  earsType: string;
  modality: string | null;
  earsConforming: boolean;
  changedInLastCrawl: boolean;
}

export interface RequirementSourceGroup {
  source: string;
  /** Requirements grouped by their spec sub-section, in first-seen order. */
  sections: { section: string; requirements: RequirementEntry[] }[];
}

/** Decode the `cognito:groups` claim from a JWT access token (no verification). */
export function decodeGroups(token: string | undefined): string[] {
  if (!token) return [];
  const part = token.split('.')[1];
  if (!part) return [];
  try {
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(json) as Record<string, unknown>;
    const groups = payload['cognito:groups'];
    return Array.isArray(groups) ? (groups as string[]) : [];
  } catch {
    return [];
  }
}

export const isWriter = (token: string | undefined): boolean => decodeGroups(token).includes('writer');

/** Group catalog entries by entity and flag divergence (variants with differing hashes). */
export function groupByEntity(entries: Entry[]): EntityGroup[] {
  const byEntity = new Map<string, Entry[]>();
  for (const e of entries) {
    const list = byEntity.get(e.entity) ?? [];
    list.push(e);
    byEntity.set(e.entity, list);
  }
  return [...byEntity.entries()]
    .map(([entity, variants]) => ({
      entity,
      variants,
      divergent: new Set(variants.map((v) => v.currentHash)).size > 1,
    }))
    .sort((a, b) => a.entity.localeCompare(b.entity));
}

/** Group catalog entries by ODCS domain (falling back to crawler source label), sorted by entity within each group (R-65). */
export function groupBySource(entries: Entry[]): SourceGroup[] {
  const byDomain = new Map<string, Entry[]>();
  for (const e of entries) {
    const key = e.domain ?? e.source;
    const list = byDomain.get(key) ?? [];
    list.push(e);
    byDomain.set(key, list);
  }
  return [...byDomain.entries()]
    .map(([source, contracts]) => ({
      source,
      contracts: [...contracts].sort((a, b) => a.entity.localeCompare(b.entity)),
    }))
    .sort((a, b) => a.source.localeCompare(b.source));
}

/**
 * Group cataloged requirements by source, then by spec sub-section (R-113).
 * Preserves the order of `reqs` as delivered — the read API returns requirements
 * sorted by source then natural requirement id (R-109), so sections here appear
 * in first-seen (ascending-id) order and requirements within a section in id order.
 */
export function groupRequirementsBySection(reqs: RequirementEntry[]): RequirementSourceGroup[] {
  const bySource = new Map<string, Map<string, RequirementEntry[]>>();
  for (const r of reqs) {
    const sections = bySource.get(r.source) ?? new Map<string, RequirementEntry[]>();
    const list = sections.get(r.section) ?? [];
    list.push(r);
    sections.set(r.section, list);
    bySource.set(r.source, sections);
  }
  return [...bySource.entries()]
    .map(([source, sections]) => ({
      source,
      sections: [...sections.entries()].map(([section, requirements]) => ({ section, requirements })),
    }))
    .sort((a, b) => a.source.localeCompare(b.source));
}
