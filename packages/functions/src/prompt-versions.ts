/**
 * Prompt-version CRUD handlers (T-08 · prompt-versioning-experiments).
 *
 * Three endpoints:
 *   POST   /prompt-versions         → handleCreatePromptVersion (201 / 400 / 409)
 *   GET    /prompt-versions         → handleListPromptVersions  (200, text omitted)
 *   GET    /prompt-versions/{pv}    → handleGetPromptVersion    (200 / 404)
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { isValidPromptVersion, type PromptVersionRecord } from '@registry/core';
import { repository } from './repository.js';
import { json, notFound } from './http.js';

/** POST /prompt-versions — register a new immutable prompt version. */
export async function handleCreatePromptVersion(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyStructuredResultV2> {
  // Parse body
  let body: Record<string, unknown>;
  try {
    if (!event.body) throw new SyntaxError('missing body');
    body = JSON.parse(event.body) as Record<string, unknown>;
  } catch {
    return json(400, { error: 'bad_request', message: 'request body must be valid JSON' });
  }

  const { promptVersion, text, modelId, notes } = body;

  // Required field validation
  if (!promptVersion || typeof promptVersion !== 'string' || promptVersion.trim() === '') {
    return json(400, { error: 'bad_request', message: 'promptVersion is required' });
  }
  if (!text || typeof text !== 'string' || text.trim() === '') {
    return json(400, { error: 'bad_request', message: 'text is required' });
  }
  if (!modelId || typeof modelId !== 'string' || modelId.trim() === '') {
    return json(400, { error: 'bad_request', message: 'modelId is required' });
  }

  // Format validation
  if (!isValidPromptVersion(promptVersion)) {
    return json(400, { error: 'bad_request', message: 'promptVersion must match [a-z0-9-_.]{1,64}' });
  }

  // Extract caller identity from Lambda authorizer context
  const lambdaCtx = event.requestContext?.authorizer?.lambda as Record<string, unknown> | undefined;
  const createdBy = (lambdaCtx?.username as string | undefined) ?? 'unknown';

  const now = new Date().toISOString();
  const record: PromptVersionRecord = {
    promptVersion,
    text,
    modelId,
    createdAt: now,
    startedAt: now,
    createdBy,
    ...(notes !== undefined && typeof notes === 'string' ? { notes } : {}),
  };

  try {
    await repository.putPromptVersion(record);
  } catch (err) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
      return json(409, { error: 'conflict', message: `prompt version '${promptVersion}' already exists` });
    }
    throw err;
  }

  return json(201, record);
}

/** GET /prompt-versions — list all prompt versions, omitting the `text` field. */
export async function handleListPromptVersions(
  _event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyStructuredResultV2> {
  const versions = await repository.listPromptVersions();
  const promptVersions = versions.map(({ text: _omitted, ...rest }) => rest);
  return json(200, { promptVersions });
}

/** GET /prompt-versions/{promptVersion} — fetch one prompt version with full text. */
export async function handleGetPromptVersion(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyStructuredResultV2> {
  const promptVersion = event.pathParameters?.promptVersion;
  if (!promptVersion) return notFound();

  const record = await repository.getPromptVersion(promptVersion);
  if (!record) return notFound(`no prompt version '${promptVersion}'`);

  return json(200, record);
}
