/**
 * Tests for T-05 authorizer extension — WRITER_ROUTES additions for pipeline
 * and prompt mutation routes (T-05a).
 *
 * Requirements: R-25
 * Design: Writer-route enforcement
 *
 * Uses the pure helper functions from authorizer.ts (no DDB/SST needed).
 */
import { describe, it, expect, vi } from 'vitest';
import { WRITER_ROUTES, requiredGroup, isAuthorized, handleAuthorization } from '../src/authorizer.js';

// ---------------------------------------------------------------------------
// WRITER_ROUTES membership — static data checks (no mocks required)
// ---------------------------------------------------------------------------

describe('WRITER_ROUTES — pipeline mutation routes (T-05 · R-25)', () => {
  it('POST /pipelines is in WRITER_ROUTES', () => {
    expect(WRITER_ROUTES.has('POST /pipelines')).toBe(true);
  });

  it('PUT /pipelines/{id} is in WRITER_ROUTES', () => {
    expect(WRITER_ROUTES.has('PUT /pipelines/{id}')).toBe(true);
  });

  it('DELETE /pipelines/{id} is in WRITER_ROUTES', () => {
    expect(WRITER_ROUTES.has('DELETE /pipelines/{id}')).toBe(true);
  });

  it('POST /prompts is in WRITER_ROUTES', () => {
    expect(WRITER_ROUTES.has('POST /prompts')).toBe(true);
  });

  it('PUT /prompts/{key} is in WRITER_ROUTES', () => {
    expect(WRITER_ROUTES.has('PUT /prompts/{key}')).toBe(true);
  });

  it('DELETE /prompts/{key} is in WRITER_ROUTES', () => {
    expect(WRITER_ROUTES.has('DELETE /prompts/{key}')).toBe(true);
  });
});

describe('WRITER_ROUTES — GET routes are NOT writer-only (reader access)', () => {
  it('GET /pipelines requires only reader', () => {
    expect(requiredGroup('GET /pipelines')).toBe('reader');
  });

  it('GET /pipelines/{id} requires only reader', () => {
    expect(requiredGroup('GET /pipelines/{id}')).toBe('reader');
  });

  it('GET /prompts requires only reader', () => {
    expect(requiredGroup('GET /prompts')).toBe('reader');
  });

  it('GET /prompts/{key} requires only reader', () => {
    expect(requiredGroup('GET /prompts/{key}')).toBe('reader');
  });

  it('GET /prompts/{key}/versions requires only reader', () => {
    expect(requiredGroup('GET /prompts/{key}/versions')).toBe('reader');
  });
});

describe('isAuthorized — pipeline/prompt mutation routes', () => {
  it('writer may POST /pipelines', () => {
    expect(isAuthorized('POST /pipelines', ['writer'])).toBe(true);
  });

  it('reader may not POST /pipelines → 403', () => {
    expect(isAuthorized('POST /pipelines', ['reader'])).toBe(false);
  });

  it('writer may PUT /pipelines/{id}', () => {
    expect(isAuthorized('PUT /pipelines/{id}', ['writer'])).toBe(true);
  });

  it('reader may not PUT /pipelines/{id} → 403', () => {
    expect(isAuthorized('PUT /pipelines/{id}', ['reader'])).toBe(false);
  });

  it('writer may DELETE /pipelines/{id}', () => {
    expect(isAuthorized('DELETE /pipelines/{id}', ['writer'])).toBe(true);
  });

  it('reader may not DELETE /pipelines/{id} → 403', () => {
    expect(isAuthorized('DELETE /pipelines/{id}', ['reader'])).toBe(false);
  });

  it('writer may POST /prompts', () => {
    expect(isAuthorized('POST /prompts', ['writer'])).toBe(true);
  });

  it('reader may not POST /prompts → 403', () => {
    expect(isAuthorized('POST /prompts', ['reader'])).toBe(false);
  });

  it('writer may PUT /prompts/{key}', () => {
    expect(isAuthorized('PUT /prompts/{key}', ['writer'])).toBe(true);
  });

  it('reader may not PUT /prompts/{key} → 403', () => {
    expect(isAuthorized('PUT /prompts/{key}', ['reader'])).toBe(false);
  });

  it('writer may DELETE /prompts/{key}', () => {
    expect(isAuthorized('DELETE /prompts/{key}', ['writer'])).toBe(true);
  });

  it('reader may not DELETE /prompts/{key} → 403', () => {
    expect(isAuthorized('DELETE /prompts/{key}', ['reader'])).toBe(false);
  });

  it('reader may GET /pipelines', () => {
    expect(isAuthorized('GET /pipelines', ['reader'])).toBe(true);
  });

  it('writer may also GET /pipelines', () => {
    expect(isAuthorized('GET /pipelines', ['writer'])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TS-22: handleAuthorization — end-to-end deny for non-writer on pipeline routes
// ---------------------------------------------------------------------------

describe('handleAuthorization — pipeline/prompt mutation denial (T-05a · TS-22)', () => {
  const evt = (routeKey: string, token = 'Bearer good') =>
    ({ routeKey, identitySource: [token], headers: {} }) as any;

  // TS-22: Non-writer token calling POST /pipelines → isAuthorized: false
  it('TS-22: reader token on POST /pipelines → isAuthorized: false', async () => {
    // GIVEN
    const verify = vi.fn(async () => ({
      sub: 'u1',
      username: 'reader@demo',
      'cognito:groups': ['reader'],
    }));

    // WHEN
    const res = await handleAuthorization(evt('POST /pipelines'), verify as any);

    // THEN
    expect(res.isAuthorized).toBe(false);
  });

  it('writer token on POST /pipelines → isAuthorized: true', async () => {
    // GIVEN
    const verify = vi.fn(async () => ({
      sub: 'u2',
      username: 'writer@demo',
      'cognito:groups': ['writer', 'reader'],
    }));

    // WHEN
    const res = await handleAuthorization(evt('POST /pipelines'), verify as any);

    // THEN
    expect(res.isAuthorized).toBe(true);
  });

  it('reader token on PUT /pipelines/{id} → isAuthorized: false', async () => {
    // GIVEN
    const verify = vi.fn(async () => ({
      sub: 'u3',
      username: 'reader@demo',
      'cognito:groups': ['reader'],
    }));

    // WHEN
    const res = await handleAuthorization(evt('PUT /pipelines/{id}'), verify as any);

    // THEN
    expect(res.isAuthorized).toBe(false);
  });

  it('reader token on DELETE /prompts/{key} → isAuthorized: false', async () => {
    // GIVEN
    const verify = vi.fn(async () => ({
      sub: 'u4',
      username: 'reader@demo',
      'cognito:groups': ['reader'],
    }));

    // WHEN
    const res = await handleAuthorization(evt('DELETE /prompts/{key}'), verify as any);

    // THEN
    expect(res.isAuthorized).toBe(false);
  });

  it('reader token on GET /pipelines → isAuthorized: true (read access)', async () => {
    // GIVEN
    const verify = vi.fn(async () => ({
      sub: 'u5',
      username: 'reader@demo',
      'cognito:groups': ['reader'],
    }));

    // WHEN
    const res = await handleAuthorization(evt('GET /pipelines'), verify as any);

    // THEN
    expect(res.isAuthorized).toBe(true);
  });

  it('all six new mutation routes are in WRITER_ROUTES (complete membership check)', () => {
    // GIVEN — the six routes added in T-05 per spec §T-05
    const newMutationRoutes = [
      'POST /pipelines',
      'PUT /pipelines/{id}',
      'DELETE /pipelines/{id}',
      'POST /prompts',
      'PUT /prompts/{key}',
      'DELETE /prompts/{key}',
    ];

    // THEN
    for (const route of newMutationRoutes) {
      expect(WRITER_ROUTES.has(route), `expected ${route} to be in WRITER_ROUTES`).toBe(true);
    }
  });
});
