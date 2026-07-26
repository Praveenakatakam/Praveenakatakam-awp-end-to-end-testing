/**
 * Fixed source-repository configuration (R-01, D-5).
 *
 * The registry crawls exactly these two repos — the OneRoster publisher and
 * consumer example apps. The set is configuration, not a runtime input; adding
 * a source is a code/redeploy change (§2 out-of-scope).
 */
export interface SourceConfig {
  /** Stable source label used as part of the catalog key (D-13). */
  label: string;
  owner: string;
  repo: string;
  /** Default branch crawled (source of truth — D-8). */
  branch: string;
}

export const SOURCES: SourceConfig[] = [
  { label: 'awp-app-plane', owner: 'collegeboard-software', repo: 'awp-app-plane', branch: 'feat/end-to-end-testing-registry' },
];
