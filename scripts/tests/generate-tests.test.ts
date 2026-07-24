import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import {
  buildCatalogFromApi,
  DEFAULT_USERNAME,
  fetchLatestArtifacts,
  generateLocally,
  mergeSettingSources,
  resolveSettings,
  triggerGeneration,
  writeArtifactTree,
} from '../generate-tests.js';
import type { ArtifactSet } from '@registry/testgen';

const API = 'https://api.example.test';

function rawDoc(entity: string): string {
  return yaml.dump({
    id: `${entity}-id`,
    name: entity,
    schema: [{ name: entity, properties: [{ name: 'sourcedId', required: true, logicalType: 'string' }] }],
  });
}

/** A fake fetch routing the registry read/write endpoints. */
function fakeApi(): typeof fetch {
  const contracts = [
    { source: 'publisher', entity: 'org', id: 'org-p', currentHash: 'h1', declaredVersion: '1.0.0', validation: 'valid' },
    { source: 'consumer', entity: 'org', id: 'org-c', currentHash: 'h2', declaredVersion: '1.0.0', validation: 'valid' },
  ];
  return (async (input: any, init: any = {}) => {
    const url = String(input);
    const path = url.slice(API.length);
    const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (path === '/generate-tests' && init.method === 'POST')
      return ok({ runId: 'run-1', counts: { conformance: 1, compat: 1, skipped: 1 } });
    if (path === '/contracts') return ok({ items: contracts });
    if (path.startsWith('/contracts/') && path.endsWith('/raw')) {
      const entity = path.includes('org-') ? 'org' : 'x';
      return new Response(rawDoc(entity), { status: 200 });
    }
    if (path === '/test-artifacts/latest') {
      const artifacts: ArtifactSet = {
        manifest: { manifestVersion: 1, generator: '@registry/testgen', tests: [], skipped: [] },
        files: [{ path: 'compat/org.generated.test.ts', contents: '// endpoint artifact\n' }],
      };
      return ok({ run: { runId: 'run-1' }, artifacts });
    }
    throw new Error(`unexpected fetch ${init.method ?? 'GET'} ${path}`);
  }) as typeof fetch;
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gentests-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('generate-tests CLI (T-24 · R-91, R-92, D-33/D-34)', () => {
  it("default: triggers generation then pulls + writes the endpoint's artifacts (AC-91)", async () => {
    const f = fakeApi();
    const summary = await triggerGeneration(f, API, 'tok');
    expect(summary.runId).toBe('run-1');
    const artifacts = await fetchLatestArtifacts(f, API, 'tok');
    const written = writeArtifactTree(dir, artifacts);
    expect(written).toContain('manifest.json');
    expect(written).toContain('compat/org.generated.test.ts');
    expect(readFileSync(join(dir, 'compat/org.generated.test.ts'), 'utf8')).toContain('endpoint artifact');
  });

  it('--local: builds an identical tree from the read API via the same pure core (AC-91, D-33)', async () => {
    const f = fakeApi();
    const catalog = await buildCatalogFromApi(f, API, 'tok');
    expect(catalog.map((c) => `${c.source}/${c.id}`)).toEqual(['publisher/org-p', 'consumer/org-c']);
    const artifacts = await generateLocally(f, API, 'tok');
    // Both org variants valid + shared → one compat test emitted locally.
    expect(artifacts.manifest.tests.some((t: any) => t.kind === 'compat' && t.entity === 'org')).toBe(true);
    const written = writeArtifactTree(dir, artifacts);
    expect(written).toContain('compat/org.generated.test.ts');
    expect(existsSync(join(dir, 'manifest.json'))).toBe(true);
  });

  it('replaces the tree wholesale — stale generated files are removed (AC-88 removal / E-28)', () => {
    // Seed a stale file that a later generation no longer produces.
    mkdirSync(join(dir, 'conformance'), { recursive: true });
    writeFileSync(join(dir, 'conformance/stale.generated.test.ts'), '// stale\n');

    const artifacts: ArtifactSet = {
      manifest: { manifestVersion: 1, generator: '@registry/testgen', tests: [], skipped: [] } as any,
      files: [{ path: 'compat/org.generated.test.ts', contents: '// fresh\n' }],
    };
    writeArtifactTree(dir, artifacts);

    expect(existsSync(join(dir, 'conformance/stale.generated.test.ts'))).toBe(false);
    expect(existsSync(join(dir, 'compat/org.generated.test.ts'))).toBe(true);
  });
});

describe('generate-tests CLI settings resolution (D-35 · R-91a — sst bind + SSM)', () => {
  describe('mergeSettingSources', () => {
    it('env overrides sst-bind Config; Config fills the rest', () => {
      const bound = {
        REGISTRY_API_URL: 'https://ssm.example',
        USER_POOL_CLIENT_ID: 'ssmClient',
        REGISTRY_DEMO_PASSWORD: 'ssmpw',
      };
      const merged = mergeSettingSources(bound, { REGISTRY_API_URL: 'https://override.example', AWS_REGION: 'us-west-2' });
      expect(merged.REGISTRY_API_URL).toBe('https://override.example'); // env wins
      expect(merged.USER_POOL_CLIENT_ID).toBe('ssmClient'); // from Config
      expect(merged.REGISTRY_DEMO_PASSWORD).toBe('ssmpw'); // from Config
      expect(merged.AWS_REGION).toBe('us-west-2');
    });
  });

  describe('resolveSettings', () => {
    it('uses the sst-bind writer secret + coordinates, defaulting username + region', () => {
      const s = resolveSettings({
        REGISTRY_API_URL: 'https://api.example/',
        USER_POOL_CLIENT_ID: 'client123',
        REGISTRY_DEMO_PASSWORD: 'seededpw',
      });
      expect(s).toEqual({
        apiUrl: 'https://api.example', // trailing slash stripped
        clientId: 'client123',
        region: 'us-east-1',
        token: undefined,
        username: DEFAULT_USERNAME,
        password: 'seededpw',
      });
    });
    it('an explicit REGISTRY_PASSWORD overrides the seeded demo secret', () => {
      const s = resolveSettings({ REGISTRY_API_URL: 'https://a', REGISTRY_DEMO_PASSWORD: 'seed', REGISTRY_PASSWORD: 'override' });
      expect(s.password).toBe('override');
    });
    it('a REGISTRY_TOKEN satisfies the credential with no password', () => {
      const s = resolveSettings({ REGISTRY_API_URL: 'https://a', REGISTRY_TOKEN: 'tok' });
      expect(s.token).toBe('tok');
      expect(s.password).toBeUndefined();
    });
    it('errors (never hangs) when the API URL is absent', () => {
      expect(() => resolveSettings({ REGISTRY_DEMO_PASSWORD: 'pw' })).toThrow(/no registry API URL/);
    });
    it('errors when no credential is resolvable from any source', () => {
      expect(() => resolveSettings({ REGISTRY_API_URL: 'https://a', USER_POOL_CLIENT_ID: 'c' })).toThrow(/no credential/);
    });
  });
});
