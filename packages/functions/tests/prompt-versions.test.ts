/**
 * Unit tests for prompt-version CRUD handlers (T-08a · prompt-versioning-experiments).
 *
 * Covers R-08 acceptance criteria:
 *   - POST /prompt-versions  → 201 happy path, 409 conflict, 400 bad input
 *   - GET  /prompt-versions  → 200 with text stripped
 *   - GET  /prompt-versions/{pv} → 200 full record, 404 not found
 *
 * No live AWS — `repository` is mocked via vi.mock.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import {
  handleCreatePromptVersion,
  handleListPromptVersions,
  handleGetPromptVersion,
} from '../src/prompt-versions.js';

// ---- Mock repository -------------------------------------------------------

vi.mock('../src/repository.js', () => ({
  repository: {
    putPromptVersion: vi.fn(),
    listPromptVersions: vi.fn(),
    getPromptVersion: vi.fn(),
  },
}));

// Import after vi.mock so we get the mocked version.
import { repository } from '../src/repository.js';

// ---- Helpers ----------------------------------------------------------------

/** Minimal APIGatewayProxyEventV2 for POST /prompt-versions. */
function postEvent(body: unknown, authorizer?: { username: string }): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: 'POST /prompt-versions',
    rawPath: '/prompt-versions',
    rawQueryString: '',
    headers: { 'content-type': 'application/json' },
    requestContext: {
      accountId: '123',
      apiId: 'api',
      domainName: 'example.com',
      domainPrefix: 'api',
      http: { method: 'POST', path: '/prompt-versions', protocol: 'HTTP/1.1', sourceIp: '1.2.3.4', userAgent: 'test' },
      requestId: 'req-1',
      routeKey: 'POST /prompt-versions',
      stage: '$default',
      time: '01/Jan/2026:00:00:00 +0000',
      timeEpoch: 0,
      authorizer: authorizer ? { lambda: authorizer } : undefined,
    },
    body: JSON.stringify(body),
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}

/** Minimal APIGatewayProxyEventV2 for GET /prompt-versions. */
function getListEvent(): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: 'GET /prompt-versions',
    rawPath: '/prompt-versions',
    rawQueryString: '',
    headers: {},
    requestContext: {
      accountId: '123',
      apiId: 'api',
      domainName: 'example.com',
      domainPrefix: 'api',
      http: { method: 'GET', path: '/prompt-versions', protocol: 'HTTP/1.1', sourceIp: '1.2.3.4', userAgent: 'test' },
      requestId: 'req-2',
      routeKey: 'GET /prompt-versions',
      stage: '$default',
      time: '01/Jan/2026:00:00:00 +0000',
      timeEpoch: 0,
    },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}

/** Minimal APIGatewayProxyEventV2 for GET /prompt-versions/{promptVersion}. */
function getOneEvent(promptVersion: string): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: 'GET /prompt-versions/{promptVersion}',
    rawPath: `/prompt-versions/${promptVersion}`,
    rawQueryString: '',
    headers: {},
    pathParameters: { promptVersion },
    requestContext: {
      accountId: '123',
      apiId: 'api',
      domainName: 'example.com',
      domainPrefix: 'api',
      http: { method: 'GET', path: `/prompt-versions/${promptVersion}`, protocol: 'HTTP/1.1', sourceIp: '1.2.3.4', userAgent: 'test' },
      requestId: 'req-3',
      routeKey: 'GET /prompt-versions/{promptVersion}',
      stage: '$default',
      time: '01/Jan/2026:00:00:00 +0000',
      timeEpoch: 0,
    },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}

const baseRecord = {
  promptVersion: 'v1.0.0',
  text: 'You are a contract test generator.',
  modelId: 'claude-sonnet-4-6',
  createdAt: '2026-10-01T00:00:00.000Z',
  startedAt: '2026-10-01T00:00:00.000Z',
  createdBy: 'test-user',
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ---- handleCreatePromptVersion ---------------------------------------------

describe('handleCreatePromptVersion (POST /prompt-versions)', () => {
  it('returns 201 with the stored record on the happy path (R-08)', async () => {
    // GIVEN
    vi.mocked(repository.putPromptVersion).mockResolvedValue(undefined);
    const event = postEvent(
      { promptVersion: 'v1.0.0', text: 'You are a contract test generator.', modelId: 'claude-sonnet-4-6' },
      { username: 'test-user' }
    );

    // WHEN
    const res = await handleCreatePromptVersion(event);

    // THEN
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body!);
    expect(body.promptVersion).toBe('v1.0.0');
    expect(body.text).toBe('You are a contract test generator.');
    expect(body.modelId).toBe('claude-sonnet-4-6');
    expect(body.createdAt).toBeTruthy();
    expect(body.startedAt).toBeTruthy();
    expect(vi.mocked(repository.putPromptVersion)).toHaveBeenCalledOnce();
  });

  it('returns 409 when putPromptVersion throws ConditionalCheckFailedException', async () => {
    // GIVEN — the version already exists in DynamoDB
    const conflict = Object.assign(new Error('already exists'), { name: 'ConditionalCheckFailedException' });
    vi.mocked(repository.putPromptVersion).mockRejectedValue(conflict);
    const event = postEvent({ promptVersion: 'v1.0.0', text: 'prompt text', modelId: 'claude-sonnet-4-6' });

    // WHEN
    const res = await handleCreatePromptVersion(event);

    // THEN — the record is unchanged (the mock did not write anything new)
    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body!);
    expect(body.error).toBe('conflict');
    expect(body.message).toContain('v1.0.0');
  });

  it('returns 400 when promptVersion is missing from the request body', async () => {
    // GIVEN
    vi.mocked(repository.putPromptVersion).mockResolvedValue(undefined);
    const event = postEvent({ text: 'prompt text', modelId: 'claude-sonnet-4-6' });

    // WHEN
    const res = await handleCreatePromptVersion(event);

    // THEN
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body!);
    expect(body.error).toBe('bad_request');
    expect(body.message).toContain('promptVersion');
    expect(vi.mocked(repository.putPromptVersion)).not.toHaveBeenCalled();
  });

  it('returns 400 when text is blank (whitespace-only)', async () => {
    // GIVEN
    vi.mocked(repository.putPromptVersion).mockResolvedValue(undefined);
    const event = postEvent({ promptVersion: 'v1.0.0', text: '   ', modelId: 'claude-sonnet-4-6' });

    // WHEN
    const res = await handleCreatePromptVersion(event);

    // THEN
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body!);
    expect(body.error).toBe('bad_request');
    expect(body.message).toContain('text');
    expect(vi.mocked(repository.putPromptVersion)).not.toHaveBeenCalled();
  });

  it('returns 400 when promptVersion fails isValidPromptVersion (e.g. uppercase letters)', async () => {
    // GIVEN — 'V1' has an uppercase letter, which violates the [a-z0-9-_.]{1,64} pattern
    vi.mocked(repository.putPromptVersion).mockResolvedValue(undefined);
    const event = postEvent({ promptVersion: 'V1', text: 'prompt text', modelId: 'claude-sonnet-4-6' });

    // WHEN
    const res = await handleCreatePromptVersion(event);

    // THEN
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body!);
    expect(body.error).toBe('bad_request');
    expect(body.message).toContain('promptVersion');
    expect(vi.mocked(repository.putPromptVersion)).not.toHaveBeenCalled();
  });
});

// ---- handleListPromptVersions ----------------------------------------------

describe('handleListPromptVersions (GET /prompt-versions)', () => {
  it('returns 200 with a promptVersions array and text is absent from each item', async () => {
    // GIVEN — two records including text
    vi.mocked(repository.listPromptVersions).mockResolvedValue([
      { ...baseRecord, promptVersion: 'v1.0.0' },
      { ...baseRecord, promptVersion: 'v1.1.0', text: 'Updated prompt text.' },
    ]);

    // WHEN
    const res = await handleListPromptVersions(getListEvent());

    // THEN
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body!);
    expect(body.promptVersions).toHaveLength(2);
    for (const item of body.promptVersions) {
      expect(item).not.toHaveProperty('text');
      expect(item.promptVersion).toBeTruthy();
    }
  });
});

// ---- handleGetPromptVersion ------------------------------------------------

describe('handleGetPromptVersion (GET /prompt-versions/{promptVersion})', () => {
  it('returns 200 with the full record including text when the version exists', async () => {
    // GIVEN
    vi.mocked(repository.getPromptVersion).mockResolvedValue(baseRecord);

    // WHEN
    const res = await handleGetPromptVersion(getOneEvent('v1.0.0'));

    // THEN
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body!);
    expect(body.promptVersion).toBe('v1.0.0');
    expect(body.text).toBe(baseRecord.text);
    expect(body.modelId).toBe(baseRecord.modelId);
    expect(vi.mocked(repository.getPromptVersion)).toHaveBeenCalledWith('v1.0.0');
  });

  it('returns 404 for an unknown prompt version', async () => {
    // GIVEN
    vi.mocked(repository.getPromptVersion).mockResolvedValue(undefined);

    // WHEN
    const res = await handleGetPromptVersion(getOneEvent('v-does-not-exist'));

    // THEN
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body!);
    expect(body.error).toBe('not_found');
  });
});
