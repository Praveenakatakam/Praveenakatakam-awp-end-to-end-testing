/**
 * Deploy-time PROMPT#v1 seeder (T-03 · R-20, R-62).
 *
 * Run by the SST `Script` in ApiStack on create/update. Writes the canonical
 * `PROMPT#v1` record to the Registry table using a conditional put
 * (`attribute_not_exists(PK)`) so re-deploys are idempotent. The text is the
 * verbatim v1 system prompt extracted from `llm.ts` at the time this task was
 * written — it is the source of truth until the prompt-versioning API is used
 * to register a new version.
 *
 * Both `createdAt` and `startedAt` are written to the same deploy-time ISO
 * timestamp so the record sorts correctly on the `byKind` GSI (kind="PROMPT",
 * SK=startedAt) — see design §2 note on T-04.
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

/** SST `Script` entry point — idempotent on re-deploy. */
export async function handler(): Promise<{ seeded: boolean }> {
  const now = new Date().toISOString();
  try {
    await ddb.send(
      new PutCommand({
        TableName: Table.Registry.tableName,
        Item: {
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
        ConditionExpression: 'attribute_not_exists(PK)',
      })
    );
    log.info('prompt-seed.seeded', { promptVersion: 'v1' });
    return { seeded: true };
  } catch (err) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
      // Record already exists — idempotent, not an error.
      log.info('prompt-seed.already-exists', { promptVersion: 'v1' });
      return { seeded: false };
    }
    throw err;
  }
}
