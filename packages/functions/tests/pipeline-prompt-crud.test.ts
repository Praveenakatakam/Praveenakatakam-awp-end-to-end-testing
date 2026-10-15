/**
 * [unit] Tests for prompt CRUD handlers (T-04a).
 *
 * Requirements: R-31, R-32, R-33, R-34, R-52
 * Acceptance criteria: TS-19, TS-20, TS-21, TS-34
 *
 * Uses vi.mock to stub the repository functions and S3 client that the prompt
 * handlers call (module-bound pattern — handlers import at module scope).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

// ---------------------------------------------------------------------------
// Mock repository and S3 before importing the module under test.
// The vi.mock hoisting ensures these stubs are in place when pipeline.ts loads.
// ---------------------------------------------------------------------------

// vi.hoisted ensures mockS3Send is available inside the hoisted vi.mock factory.
const { mockS3Send: _mockS3Send } = vi.hoisted(() => ({ mockS3Send: vi.fn() }));

vi.mock('../src/repository.js', () => ({
  getPrmpt: vi.fn(),
  putPrmpt: vi.fn(),
  updatePrmpt: vi.fn(),
  listPrmpts: vi.fn(),
  putPrmptVer: vi.fn(),
  listPrmptVers: vi.fn(),
  listPipelines: vi.fn(),
  // pipeline CRUD helpers (referenced by pipeline.ts at module load)
  getPipeline: vi.fn(),
  putPipeline: vi.fn(),
  updatePipeline: vi.fn(),
  getPrun: vi.fn(),
  listPrunSteps: vi.fn(),
  getSysconfig: vi.fn(),
  pipelinePk: vi.fn(),
  prunPk: vi.fn(),
}));

vi.mock('@aws-sdk/client-s3', async () => {
  const actual = await vi.importActual<typeof import('@aws-sdk/client-s3')>('@aws-sdk/client-s3');
  return {
    ...actual,
    S3Client: vi.fn().mockImplementation(() => ({ send: _mockS3Send })),
    PutObjectCommand: actual.PutObjectCommand,
    GetObjectCommand: actual.GetObjectCommand,
  };
});

// Module-level reference to the hoisted S3 send mock.
const mockS3Send = _mockS3Send;

import {
  listPrompts,
  createPrompt,
  getPrompt,
  updatePrompt,
  deletePrompt,
  listPromptVersions,
} from '../src/pipeline.js';

import {
  getPrmpt,
  putPrmpt,
  updatePrmpt as updatePrmptRepo,
  listPrmpts,
  putPrmptVer,
  listPrmptVers,
  listPipelines as listPipelinesRepo,
} from '../src/repository.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ev(
  body?: object | string | null,
  pathParameters: Record<string, string> = {},
  queryStringParameters: Record<string, string> = {}
): APIGatewayProxyEventV2 {
  let rawBody: string | undefined;
  if (body === undefined || body === null) {
    rawBody = undefined;
  } else if (typeof body === 'string') {
    rawBody = body;
  } else {
    rawBody = JSON.stringify(body);
  }
  return {
    body: rawBody,
    pathParameters,
    queryStringParameters,
    headers: {},
    requestContext: {} as any,
    version: '2.0',
    routeKey: '',
    rawPath: '',
    rawQueryString: '',
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}

function activePromptItem(
  promptKey: string,
  overrides: Partial<Record<string, unknown>> = {}
) {
  return {
    pk: `PRMPT#${promptKey}`,
    sk: 'PRMPT',
    kind: 'PRMPT' as const,
    promptKey,
    currentVersion: 1,
    body: 'You are a helpful assistant.',
    active: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function activePipelineItem(pipelineId: string, promptKey: string) {
  return {
    pk: `PIPELINE#${pipelineId}`,
    sk: 'PIPELINE',
    kind: 'PIPELINE' as const,
    pipelineId,
    name: 'Test Pipeline',
    active: true,
    steps: [
      {
        stepId: 's1',
        label: 'Step 1',
        model: 'us.anthropic.claude-sonnet-4-6',
        promptKey,
        optional: false,
        waitForHuman: false,
        includeContext: true,
      },
    ],
    maxSteps: 10,
    maxAgeMinutes: 60,
    version: 1,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

// S3 Body helper — returns an object with transformToString matching what the
// S3 SDK streams back.
function s3Body(text: string) {
  return { transformToString: async () => text };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockS3Send.mockReset();
  // Default: write operations succeed silently.
  vi.mocked(putPrmpt).mockResolvedValue(undefined);
  vi.mocked(putPrmptVer).mockResolvedValue(undefined);
  vi.mocked(updatePrmptRepo).mockResolvedValue(undefined);
  vi.mocked(listPipelinesRepo).mockResolvedValue({ items: [] });
});

// ===========================================================================
// listPrompts — GET /prompts
// ===========================================================================

describe('listPrompts (GET /prompts)', () => {
  it('returns HTTP 200 with active prompts and usedByPipelines field (R-37, R-52)', async () => {
    // GIVEN — one active prompt
    vi.mocked(listPrmpts).mockResolvedValue({
      items: [activePromptItem('prompt-a')] as any[],
    });

    // WHEN
    const res = await listPrompts(ev());

    // THEN
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body!);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].promptKey).toBe('prompt-a');
    expect(body.items[0].usedByPipelines).toEqual([]);
  });

  it('omits nextToken when the page is the last (R-37)', async () => {
    // GIVEN
    vi.mocked(listPrmpts).mockResolvedValue({ items: [] });

    // WHEN
    const res = await listPrompts(ev());

    // THEN
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body!);
    expect(body.nextToken).toBeUndefined();
  });

  it('includes nextToken when repo returns one (R-37)', async () => {
    // GIVEN
    const token = Buffer.from(JSON.stringify({ pk: 'PRMPT#z', sk: 'PRMPT' })).toString('base64');
    vi.mocked(listPrmpts).mockResolvedValue({
      items: [activePromptItem('prompt-b')] as any[],
      nextToken: token,
    });

    // WHEN
    const res = await listPrompts(ev(undefined, {}, { nextToken: token }));

    // THEN
    const body = JSON.parse(res.body!);
    expect(body.nextToken).toBe(token);
  });

  it('annotates usedByPipelines when an active pipeline references the prompt (R-37)', async () => {
    // GIVEN — prompt is referenced by one active pipeline
    vi.mocked(listPrmpts).mockResolvedValue({
      items: [activePromptItem('shared-prompt')] as any[],
    });
    vi.mocked(listPipelinesRepo).mockResolvedValue({
      items: [activePipelineItem('pipe-x', 'shared-prompt')] as any[],
    });

    // WHEN
    const res = await listPrompts(ev());

    // THEN
    const body = JSON.parse(res.body!);
    expect(body.items[0].usedByPipelines).toEqual(['pipe-x']);
  });

  it('TS-34: listPrompts excludes soft-deleted prompts — repository already filters them (R-52)', async () => {
    // GIVEN — repo returns only active items (listPrmpts uses a FilterExpression)
    vi.mocked(listPrmpts).mockResolvedValue({ items: [] });

    // WHEN
    const res = await listPrompts(ev());

    // THEN — list is empty; no inactive prompt appears
    const body = JSON.parse(res.body!);
    expect(body.items).toHaveLength(0);
    expect(listPrmpts).toHaveBeenCalledOnce();
  });
});

// ===========================================================================
// createPrompt — POST /prompts
// ===========================================================================

describe('createPrompt (POST /prompts)', () => {
  it('returns HTTP 201 with promptKey, currentVersion: 1, createdAt (R-31)', async () => {
    // GIVEN
    const body = { promptKey: 'my-prompt', body: 'You are a helpful assistant.' };

    // WHEN
    const res = await createPrompt(ev(body));

    // THEN
    expect(res.statusCode).toBe(201);
    const resp = JSON.parse(res.body!);
    expect(resp.promptKey).toBe('my-prompt');
    expect(resp.currentVersion).toBe(1);
    expect(resp.createdAt).toBeTruthy();
  });

  it('writes PRMPT header and PRMPTVER record to DDB (R-31, R-32)', async () => {
    // GIVEN
    const body = { promptKey: 'test-prompt', body: 'hello world' };

    // WHEN
    await createPrompt(ev(body));

    // THEN — both writes occur
    expect(putPrmpt).toHaveBeenCalledOnce();
    expect(putPrmptVer).toHaveBeenCalledOnce();

    const promptItem = vi.mocked(putPrmpt).mock.calls[0][1];
    expect(promptItem.promptKey).toBe('test-prompt');
    expect(promptItem.currentVersion).toBe(1);
    expect(promptItem.active).toBe(true);

    const versionItem = vi.mocked(putPrmptVer).mock.calls[0][1];
    expect(versionItem.promptKey).toBe('test-prompt');
    expect(versionItem.version).toBe(1);
  });

  it('returns HTTP 422 when promptKey is missing (R-31)', async () => {
    // GIVEN — no promptKey
    const res = await createPrompt(ev({ body: 'some text' }));

    // THEN
    expect(res.statusCode).toBe(422);
    const resp = JSON.parse(res.body!);
    expect(resp.error).toMatch(/promptKey/i);
  });

  it('returns HTTP 422 when body is missing (R-31)', async () => {
    // GIVEN — no body field
    const res = await createPrompt(ev({ promptKey: 'p1' }));

    // THEN
    expect(res.statusCode).toBe(422);
    const resp = JSON.parse(res.body!);
    expect(resp.error).toMatch(/body/i);
  });

  it('returns HTTP 400 for non-JSON request body', async () => {
    // GIVEN
    const res = await createPrompt(ev('not-valid-json'));

    // THEN
    expect(res.statusCode).toBe(400);
  });

  it('stores body inline when size is exactly 64 KB (R-34 threshold boundary)', async () => {
    // GIVEN — body at exactly 64 KB (65536 bytes)
    const exactBody = 'a'.repeat(64 * 1024);

    // WHEN
    await createPrompt(ev({ promptKey: 'boundary-prompt', body: exactBody }));

    // THEN — stored inline, NOT in S3
    expect(mockS3Send).not.toHaveBeenCalled();
    const promptItem = vi.mocked(putPrmpt).mock.calls[0][1];
    expect(promptItem.body).toBe(exactBody);
    expect(promptItem.s3Ref).toBeUndefined();
  });

  it('stores body in S3 when size exceeds 64 KB by 1 byte (R-34)', async () => {
    // GIVEN — body is 64 KB + 1 byte (65537 bytes)
    const largeBody = 'a'.repeat(64 * 1024 + 1);
    mockS3Send.mockResolvedValue({});

    // WHEN
    await createPrompt(ev({ promptKey: 'large-prompt', body: largeBody }));

    // THEN — body sent to S3
    expect(mockS3Send).toHaveBeenCalledOnce();
    const promptItem = vi.mocked(putPrmpt).mock.calls[0][1];
    expect(promptItem.s3Ref).toMatch(/^prompts\/large-prompt\//);
    expect(promptItem.body).toBeUndefined();

    const versionItem = vi.mocked(putPrmptVer).mock.calls[0][1];
    expect(versionItem.s3Ref).toMatch(/^prompts\/large-prompt\//);
    expect(versionItem.body).toBeUndefined();
  });
});

// ===========================================================================
// getPrompt — GET /prompts/{key}
// ===========================================================================

describe('getPrompt (GET /prompts/{key})', () => {
  it('returns HTTP 200 with full prompt body for an active prompt (R-34)', async () => {
    // GIVEN
    vi.mocked(getPrmpt).mockResolvedValue(activePromptItem('my-prompt') as any);

    // WHEN
    const res = await getPrompt(ev(undefined, { key: 'my-prompt' }));

    // THEN
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body!);
    expect(body.promptKey).toBe('my-prompt');
    expect(body.body).toBe('You are a helpful assistant.');
    expect(body.active).toBe(true);
  });

  it('fetches body from S3 when prompt has s3Ref (R-34)', async () => {
    // GIVEN — prompt header has s3Ref instead of inline body
    vi.mocked(getPrmpt).mockResolvedValue({
      ...activePromptItem('large-prompt'),
      body: undefined,
      s3Ref: 'prompts/large-prompt/00001.txt',
    } as any);
    mockS3Send.mockResolvedValue({ Body: s3Body('fetched from S3') });

    // WHEN
    const res = await getPrompt(ev(undefined, { key: 'large-prompt' }));

    // THEN
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body!);
    expect(body.body).toBe('fetched from S3');
    expect(mockS3Send).toHaveBeenCalledOnce();
  });

  it('returns HTTP 404 when prompt does not exist (R-52)', async () => {
    // GIVEN
    vi.mocked(getPrmpt).mockResolvedValue(undefined);

    // WHEN
    const res = await getPrompt(ev(undefined, { key: 'no-such-prompt' }));

    // THEN
    expect(res.statusCode).toBe(404);
  });

  it('returns HTTP 404 for soft-deleted prompt (R-52)', async () => {
    // GIVEN — prompt exists but active: false
    vi.mocked(getPrmpt).mockResolvedValue(
      activePromptItem('deleted-prompt', { active: false }) as any
    );

    // WHEN
    const res = await getPrompt(ev(undefined, { key: 'deleted-prompt' }));

    // THEN
    expect(res.statusCode).toBe(404);
  });
});

// ===========================================================================
// updatePrompt — PUT /prompts/{key}
// ===========================================================================

describe('updatePrompt (PUT /prompts/{key})', () => {
  it('TS-20: increments currentVersion and writes a new PRMPTVER record (R-32)', async () => {
    // GIVEN — existing prompt at version 1
    vi.mocked(getPrmpt).mockResolvedValue(activePromptItem('my-prompt') as any);

    // WHEN
    const res = await updatePrompt(ev({ body: 'Updated prompt text.' }, { key: 'my-prompt' }));

    // THEN
    expect(res.statusCode).toBe(200);
    const resp = JSON.parse(res.body!);
    expect(resp.currentVersion).toBe(2);
    expect(resp.promptKey).toBe('my-prompt');

    // New version record must exist in DDB
    expect(putPrmptVer).toHaveBeenCalledOnce();
    const versionItem = vi.mocked(putPrmptVer).mock.calls[0][1];
    expect(versionItem.version).toBe(2);
    expect(versionItem.promptKey).toBe('my-prompt');
  });

  it('overwrites PRMPT header with new version and updatedAt (R-32)', async () => {
    // GIVEN
    vi.mocked(getPrmpt).mockResolvedValue(activePromptItem('my-prompt') as any);

    // WHEN
    await updatePrompt(ev({ body: 'New body.' }, { key: 'my-prompt' }));

    // THEN — header fully overwritten (putPrmpt, not updatePrmpt)
    expect(putPrmpt).toHaveBeenCalledOnce();
    const header = vi.mocked(putPrmpt).mock.calls[0][1];
    expect(header.currentVersion).toBe(2);
    expect(header.updatedAt).not.toBe('2026-01-01T00:00:00Z');
  });

  it('TS-19: cache key invalidated because promptVersion increments (R-29, R-32)', async () => {
    // GIVEN — prompt at version 1; after update it becomes version 2
    vi.mocked(getPrmpt).mockResolvedValue(activePromptItem('step-prompt') as any);

    // WHEN
    await updatePrompt(ev({ body: 'Changed.' }, { key: 'step-prompt' }));

    // THEN — the version stored in the new PRMPTVER record is 2, meaning any
    // cached step that used (promptKey='step-prompt', promptVersion=1) will no
    // longer match the new cache key derived with promptVersion=2 (R-29).
    const versionItem = vi.mocked(putPrmptVer).mock.calls[0][1];
    expect(versionItem.version).toBe(2); // version incremented → cache key changes
  });

  it('handles storage-tier switch: inline → S3 when updated body exceeds 64 KB (R-34)', async () => {
    // GIVEN — existing prompt was inline; new body is large
    vi.mocked(getPrmpt).mockResolvedValue(activePromptItem('switch-prompt') as any);
    const largeBody = 'x'.repeat(64 * 1024 + 1);
    mockS3Send.mockResolvedValue({});

    // WHEN
    await updatePrompt(ev({ body: largeBody }, { key: 'switch-prompt' }));

    // THEN — new header has s3Ref, no inline body
    const header = vi.mocked(putPrmpt).mock.calls[0][1];
    expect(header.s3Ref).toMatch(/^prompts\/switch-prompt\//);
    expect(header.body).toBeUndefined();
  });

  it('returns HTTP 404 for missing prompt (R-52)', async () => {
    // GIVEN
    vi.mocked(getPrmpt).mockResolvedValue(undefined);

    // WHEN
    const res = await updatePrompt(ev({ body: 'text' }, { key: 'ghost' }));

    // THEN
    expect(res.statusCode).toBe(404);
  });

  it('returns HTTP 404 for soft-deleted prompt (R-52)', async () => {
    // GIVEN
    vi.mocked(getPrmpt).mockResolvedValue(
      activePromptItem('gone-prompt', { active: false }) as any
    );

    // WHEN
    const res = await updatePrompt(ev({ body: 'text' }, { key: 'gone-prompt' }));

    // THEN
    expect(res.statusCode).toBe(404);
  });

  it('returns HTTP 422 when body field is missing', async () => {
    // GIVEN
    vi.mocked(getPrmpt).mockResolvedValue(activePromptItem('my-prompt') as any);

    // WHEN
    const res = await updatePrompt(ev({}, { key: 'my-prompt' }));

    // THEN
    expect(res.statusCode).toBe(422);
    const resp = JSON.parse(res.body!);
    expect(resp.error).toMatch(/body/i);
  });
});

// ===========================================================================
// deletePrompt — DELETE /prompts/{key}
// ===========================================================================

describe('deletePrompt (DELETE /prompts/{key})', () => {
  it('TS-34: soft-deletes by setting active: false; returns HTTP 200 (R-52, R-33)', async () => {
    // GIVEN — prompt exists and is not used by any active pipeline
    vi.mocked(getPrmpt).mockResolvedValue(activePromptItem('unused-prompt') as any);
    vi.mocked(listPipelinesRepo).mockResolvedValue({ items: [] });

    // WHEN
    const res = await deletePrompt(ev(undefined, { key: 'unused-prompt' }));

    // THEN
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body!);
    expect(body.active).toBe(false);
    expect(updatePrmptRepo).toHaveBeenCalledWith(
      expect.anything(),
      'unused-prompt',
      expect.objectContaining({ active: false })
    );
  });

  it('TS-21: returns HTTP 422 if prompt is referenced by an active pipeline step (R-52)', async () => {
    // GIVEN — prompt is referenced by an active pipeline
    vi.mocked(getPrmpt).mockResolvedValue(activePromptItem('shared-prompt') as any);
    vi.mocked(listPipelinesRepo).mockResolvedValue({
      items: [activePipelineItem('pipe-1', 'shared-prompt')] as any[],
    });

    // WHEN
    const res = await deletePrompt(ev(undefined, { key: 'shared-prompt' }));

    // THEN
    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body!);
    expect(body.error).toMatch(/pipe-1/);
    // Must NOT soft-delete
    expect(updatePrmptRepo).not.toHaveBeenCalled();
  });

  it('does not block delete when referencing pipeline is inactive', async () => {
    // GIVEN — pipeline exists but is inactive (active: false)
    vi.mocked(getPrmpt).mockResolvedValue(activePromptItem('old-prompt') as any);
    vi.mocked(listPipelinesRepo).mockResolvedValue({
      items: [{ ...activePipelineItem('pipe-2', 'old-prompt'), active: false }] as any[],
    });

    // WHEN
    const res = await deletePrompt(ev(undefined, { key: 'old-prompt' }));

    // THEN — inactive pipelines do not block deletion
    expect(res.statusCode).toBe(200);
    expect(updatePrmptRepo).toHaveBeenCalledOnce();
  });

  it('returns HTTP 404 for non-existent prompt', async () => {
    // GIVEN
    vi.mocked(getPrmpt).mockResolvedValue(undefined);

    // WHEN
    const res = await deletePrompt(ev(undefined, { key: 'no-such' }));

    // THEN
    expect(res.statusCode).toBe(404);
  });
});

// ===========================================================================
// listPromptVersions — GET /prompts/{key}/versions
// ===========================================================================

describe('listPromptVersions (GET /prompts/{key}/versions)', () => {
  it('returns HTTP 200 with version list (R-32, R-37)', async () => {
    // GIVEN
    vi.mocked(getPrmpt).mockResolvedValue(activePromptItem('versioned-prompt') as any);
    vi.mocked(listPrmptVers).mockResolvedValue([
      { promptKey: 'versioned-prompt', version: 1, createdAt: '2026-01-01T00:00:00Z' } as any,
      { promptKey: 'versioned-prompt', version: 2, createdAt: '2026-02-01T00:00:00Z' } as any,
    ]);

    // WHEN
    const res = await listPromptVersions(ev(undefined, { key: 'versioned-prompt' }));

    // THEN
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body!);
    expect(body.promptKey).toBe('versioned-prompt');
    expect(body.versions).toHaveLength(2);
    expect(body.versions[0].version).toBe(1);
    expect(body.versions[1].version).toBe(2);
    // Only version + createdAt should be exposed
    expect(body.versions[0].body).toBeUndefined();
    expect(body.versions[0].s3Ref).toBeUndefined();
  });

  it('returns HTTP 404 when prompt does not exist (R-32)', async () => {
    // GIVEN
    vi.mocked(getPrmpt).mockResolvedValue(undefined);

    // WHEN
    const res = await listPromptVersions(ev(undefined, { key: 'missing' }));

    // THEN
    expect(res.statusCode).toBe(404);
  });

  it('returns empty versions array when no version records exist yet', async () => {
    // GIVEN — prompt header exists but no version records
    vi.mocked(getPrmpt).mockResolvedValue(activePromptItem('new-prompt') as any);
    vi.mocked(listPrmptVers).mockResolvedValue([]);

    // WHEN
    const res = await listPromptVersions(ev(undefined, { key: 'new-prompt' }));

    // THEN
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body!);
    expect(body.versions).toEqual([]);
  });

  it('returns version history for soft-deleted prompts (R-32: versions never deleted)', async () => {
    // GIVEN — prompt is soft-deleted but version records still exist
    // listPromptVersions checks for existence only (not active flag), so
    // version history remains accessible after soft-delete.
    vi.mocked(getPrmpt).mockResolvedValue(
      activePromptItem('soft-deleted', { active: false }) as any
    );
    vi.mocked(listPrmptVers).mockResolvedValue([
      { promptKey: 'soft-deleted', version: 1, createdAt: '2026-01-01T00:00:00Z' } as any,
    ]);

    // WHEN
    const res = await listPromptVersions(ev(undefined, { key: 'soft-deleted' }));

    // THEN — version history is accessible regardless of active flag
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body!);
    expect(body.versions).toHaveLength(1);
  });
});
