import { describe, it, expect } from 'vitest';
import { API_MAP, apiTarget } from '../src/api-map.js';

describe('API_MAP + apiTarget (T-18 · R-83b, D-31)', () => {
  it('every mapped target has a non-empty path + env-var names', () => {
    for (const [source, entities] of Object.entries(API_MAP)) {
      for (const [entity, t] of Object.entries(entities)) {
        expect(t.path, `${source}/${entity}`).toMatch(/^\//);
        expect(t.baseUrlEnv).toBeTruthy();
        expect(t.tokenEnv).toBeTruthy();
        expect(typeof t.recordsAt).toBe('string');
      }
    }
  });

  it('resolves the mapped publisher/org and consumer/class targets', () => {
    expect(apiTarget('publisher', 'org')).toMatchObject({ path: '/orgs', recordsAt: 'items' });
    expect(apiTarget('consumer', 'class')).toMatchObject({ path: '/me/classes' });
  });

  it('returns undefined for unmapped entities (drives the R-83b conformance skip)', () => {
    expect(apiTarget('publisher', 'user')).toBeUndefined();
    expect(apiTarget('consumer', 'org')).toBeUndefined();
    expect(apiTarget('publisher', 'class-roster')).toBeUndefined();
    expect(apiTarget('nonesuch', 'org')).toBeUndefined();
  });
});
