/**
 * Deploy-time seeder for canonical DynamoDB records (T-03 · R-20, R-62; T-10 · R-10, R-31).
 *
 * Run by the SST `Script` in ApiStack on create/update. Writes four records:
 *
 * 1. `PROMPT#v1` — the canonical v1 system prompt used by the legacy FJOB path (T-03).
 * 2. `SYSCONFIG / MODEL_ALLOWLIST` — default Bedrock model IDs and per-model pricing map
 *    for cost estimation in the step Lambda (T-10, R-10, D-16, D-21).
 * 3. `PRMPT#functional-test-gen-default / PRMPT` — default pipeline prompt header (T-10, R-31).
 * 4. `PRMPTVER#functional-test-gen-default#00001 / PRMPTVER` — corresponding immutable
 *    version record (T-10, R-32).
 *
 * Every write uses `attribute_not_exists(PK)` so re-deploys are idempotent and
 * manually-updated items are never overwritten.
 *
 * Both `createdAt` and `startedAt` are written to the same deploy-time ISO
 * timestamp so the PROMPT#v1 record sorts correctly on the `byKind` GSI
 * (kind="PROMPT", SK=startedAt) — see design §2 note on T-04.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { Table } from 'sst/node/table';
import { log } from './log.js';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/** The canonical v1 system prompt — verbatim from packages/functions/src/llm.ts. */
const V1_PROMPT_TEXT = [
  'You are a senior test engineer specifying ONE end-to-end, cross-service functional test.',
  'You are given a single natural-language EARS requirement, the ODCS contract schema for the',
  'entity it concerns, and the live API coordinates for each service that handles that entity.',
  '',
  'Produce a SINGLE test PLAN (never code) for the scenario: the PUBLISHER performs a write that,',
  'via change-data-capture (CDC), propagates to the CONSUMER, with assertions on the affected side(s).',
  '',
  'Rules:',
  '- Ground every field ONLY in the inputs provided. Never invent an entity, source, endpoint, or',
  '  field that was not given. `trigger.entity` MUST be the given entity; `trigger.source` MUST be',
  '  one of the given sources.',
  "- `trigger.path` should be the write endpoint on the publisher for that entity.",
  '- Keep `payloadShape` a description of the request body shape, not a literal payload.',
  '- Assertions describe what a runner must verify after propagation; be specific and grounded.',
  '- Call the `emit_functional_test_plan` tool exactly once with the plan; do not reply with prose.',
].join('\n');

/**
 * Default system prompt for the functional-test-gen pipeline — seeded as
 * PRMPT#functional-test-gen-default (T-10, R-31).
 */
const DEFAULT_PROMPT_BODY = [
  'You are a test engineer. Given the provided service contract and requirements context,',
  'generate a comprehensive Vitest functional test suite. Output valid TypeScript using Vitest.',
  'Focus on contract adherence, edge cases, and requirement coverage.',
].join('\n');

/**
 * Write a single item with `attribute_not_exists(PK)` guard.
 * Returns `true` when the item was newly written, `false` when it already existed.
 * Re-throws any non-conditional error.
 */
async function conditionalPut(item: Record<string, unknown>, logKey: string): Promise<boolean> {
  try {
    await ddb.send(
      new PutCommand({
        TableName: Table.Registry.tableName,
        Item: item,
        ConditionExpression: 'attribute_not_exists(PK)',
      })
    );
    log.info(`${logKey}.seeded`, { PK: item['PK'] });
    return true;
  } catch (err) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
      // Record already exists — idempotent, not an error.
      log.info(`${logKey}.already-exists`, { PK: item['PK'] });
      return false;
    }
    throw err;
  }
}

/** SST `Script` entry point — idempotent on re-deploy. */
export async function handler(): Promise<{ seeded: boolean }> {
  const now = new Date().toISOString();

  // 1. Legacy PROMPT#v1 — used by the FJOB functional-test-gen path.
  const v1Seeded = await conditionalPut(
    {
      PK: 'PROMPT#v1',
      SK: 'PROMPT',
      kind: 'PROMPT',
      promptVersion: 'v1',
      text: V1_PROMPT_TEXT,
      modelId: 'us.anthropic.claude-sonnet-4-6',
      createdAt: now,
      startedAt: now,
      createdBy: 'system',
    },
    'prompt-seed'
  );

  // 2. SYSCONFIG / MODEL_ALLOWLIST — model IDs and per-model pricing for the step Lambda.
  const allowlistSeeded = await conditionalPut(
    {
      PK: 'SYSCONFIG',
      SK: 'MODEL_ALLOWLIST',
      allowedModels: ['us.anthropic.claude-sonnet-4-6', 'us.anthropic.claude-haiku-4-5'],
      pricing: {
        'us.anthropic.claude-sonnet-4-6': {
          inputPricePerMillionTokens: 3.0,
          outputPricePerMillionTokens: 15.0,
        },
        'us.anthropic.claude-haiku-4-5': {
          inputPricePerMillionTokens: 0.8,
          outputPricePerMillionTokens: 4.0,
        },
      },
      updatedAt: now,
    },
    'pipeline-seed.allowlist'
  );

  // 3. PRMPT#functional-test-gen-default — default pipeline prompt header.
  const prmptSeeded = await conditionalPut(
    {
      PK: 'PRMPT#functional-test-gen-default',
      SK: 'PRMPT',
      kind: 'PRMPT',
      promptKey: 'functional-test-gen-default',
      currentVersion: 1,
      body: DEFAULT_PROMPT_BODY,
      active: true,
      createdAt: now,
      updatedAt: now,
    },
    'pipeline-seed.prmpt'
  );

  // 4. PRMPTVER#functional-test-gen-default#00001 — immutable version record.
  const prmptVerSeeded = await conditionalPut(
    {
      PK: 'PRMPTVER#functional-test-gen-default#00001',
      SK: 'PRMPTVER',
      kind: 'PRMPTVER',
      promptKey: 'functional-test-gen-default',
      version: 1,
      body: DEFAULT_PROMPT_BODY,
      createdAt: now,
    },
    'pipeline-seed.prmptver'
  );

  return { seeded: v1Seeded || allowlistSeeded || prmptSeeded || prmptVerSeeded };
}
