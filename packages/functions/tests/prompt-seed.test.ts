/**
 * Tests for the seeder's new pipeline writes (T-10a).
 *
 * Requirements: R-10, R-31
 * Design: Seeder additions, Data Model Changes (SYSCONFIG/MODEL_ALLOWLIST)
 *
 * Uses aws-sdk-client-mock to intercept DynamoDB PutCommand calls at the class
 * level, matching the pattern in seed.test.ts and repository.test.ts.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { handler } from '../src/prompt-seed.js';

const ddb = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddb.reset();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return all PutCommand inputs captured during a handler run. */
function capturedPuts() {
  return ddb.commandCalls(PutCommand).map((c) => c.args[0].input);
}

/** Find the PutCommand input whose Item has the given PK. */
function findPutByPk(pk: string) {
  return capturedPuts().find((i) => i.Item?.['PK'] === pk);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('prompt-seed handler (T-10a · R-10, R-31)', () => {
  // -------------------------------------------------------------------------
  // Happy path — clean DDB (all items absent)
  // -------------------------------------------------------------------------

  describe('clean DDB — all three new writes succeed', () => {
    beforeEach(() => {
      // All PutCommands succeed on a clean table.
      ddb.on(PutCommand).resolves({});
    });

    it('returns { seeded: true } when at least one item is newly written', async () => {
      const result = await handler();
      expect(result.seeded).toBe(true);
    });

    it('writes SYSCONFIG / MODEL_ALLOWLIST with the expected allowedModels array', async () => {
      await handler();
      const put = findPutByPk('SYSCONFIG');
      expect(put).toBeDefined();
      expect(put!.Item!['SK']).toBe('MODEL_ALLOWLIST');
      const allowedModels = put!.Item!['allowedModels'] as string[];
      expect(allowedModels).toContain('us.anthropic.claude-sonnet-4-6');
      expect(allowedModels).toContain('us.anthropic.claude-haiku-4-5');
    });

    it('writes SYSCONFIG / MODEL_ALLOWLIST with pricing entries for every allowed model', async () => {
      await handler();
      const put = findPutByPk('SYSCONFIG');
      const allowedModels = put!.Item!['allowedModels'] as string[];
      const pricing = put!.Item!['pricing'] as Record<
        string,
        { inputPricePerMillionTokens: number; outputPricePerMillionTokens: number }
      >;

      for (const modelId of allowedModels) {
        expect(pricing[modelId], `pricing entry missing for ${modelId}`).toBeDefined();
        expect(typeof pricing[modelId].inputPricePerMillionTokens).toBe('number');
        expect(typeof pricing[modelId].outputPricePerMillionTokens).toBe('number');
      }
    });

    it('MODEL_ALLOWLIST write uses attribute_not_exists(PK) condition (idempotent)', async () => {
      await handler();
      const put = findPutByPk('SYSCONFIG');
      expect(put!.ConditionExpression).toBe('attribute_not_exists(PK)');
    });

    it('pricing map keys exactly match allowedModels (no orphan entries)', async () => {
      await handler();
      const put = findPutByPk('SYSCONFIG');
      const allowedModels = put!.Item!['allowedModels'] as string[];
      const pricing = put!.Item!['pricing'] as Record<string, unknown>;
      const pricingKeys = Object.keys(pricing).sort();
      expect(pricingKeys).toEqual([...allowedModels].sort());
    });

    it('writes PRMPT#functional-test-gen-default / PRMPT with active: true and currentVersion: 1', async () => {
      await handler();
      const put = findPutByPk('PRMPT#functional-test-gen-default');
      expect(put).toBeDefined();
      expect(put!.Item!['SK']).toBe('PRMPT');
      expect(put!.Item!['active']).toBe(true);
      expect(put!.Item!['currentVersion']).toBe(1);
    });

    it('PRMPT header write uses attribute_not_exists(PK) condition (idempotent)', async () => {
      await handler();
      const put = findPutByPk('PRMPT#functional-test-gen-default');
      expect(put!.ConditionExpression).toBe('attribute_not_exists(PK)');
    });

    it('writes immutable PRMPTVER#functional-test-gen-default#00001 / PRMPTVER record', async () => {
      await handler();
      const put = findPutByPk('PRMPTVER#functional-test-gen-default#00001');
      expect(put).toBeDefined();
      expect(put!.Item!['SK']).toBe('PRMPTVER');
      expect(put!.Item!['version']).toBe(1);
      expect(put!.Item!['promptKey']).toBe('functional-test-gen-default');
      // Version records are immutable — no updatedAt field
      expect(put!.Item!['updatedAt']).toBeUndefined();
    });

    it('PRMPTVER write uses attribute_not_exists(PK) condition (idempotent)', async () => {
      await handler();
      const put = findPutByPk('PRMPTVER#functional-test-gen-default#00001');
      expect(put!.ConditionExpression).toBe('attribute_not_exists(PK)');
    });
  });

  // -------------------------------------------------------------------------
  // Idempotency — ConditionalCheckFailedException is silently swallowed
  // -------------------------------------------------------------------------

  describe('idempotent re-run — ConditionalCheckFailedException swallowed', () => {
    it('does not throw when MODEL_ALLOWLIST already exists', async () => {
      const condFailed = Object.assign(new Error('exists'), {
        name: 'ConditionalCheckFailedException',
      });
      // First call (PROMPT#v1) succeeds; second (SYSCONFIG) throws the
      // conditional check exception; remaining calls succeed.
      ddb
        .on(PutCommand)
        .resolvesOnce({})         // PROMPT#v1
        .rejectsOnce(condFailed)  // SYSCONFIG / MODEL_ALLOWLIST
        .resolves({});            // PRMPT + PRMPTVER

      await expect(handler()).resolves.not.toThrow();
    });

    it('returns { seeded: true } when some writes succeed even if MODEL_ALLOWLIST already exists', async () => {
      const condFailed = Object.assign(new Error('exists'), {
        name: 'ConditionalCheckFailedException',
      });
      ddb
        .on(PutCommand)
        .resolvesOnce({})         // PROMPT#v1
        .rejectsOnce(condFailed)  // SYSCONFIG / MODEL_ALLOWLIST — already present
        .resolves({});            // PRMPT + PRMPTVER

      const result = await handler();
      // At least PRMPT and PRMPTVER succeeded, so seeded must be true.
      expect(result.seeded).toBe(true);
    });

    it('returns { seeded: false } when all items already exist', async () => {
      const condFailed = Object.assign(new Error('exists'), {
        name: 'ConditionalCheckFailedException',
      });
      ddb.on(PutCommand).rejects(condFailed);

      const result = await handler();
      expect(result.seeded).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Error propagation — non-conditional errors are re-thrown
  // -------------------------------------------------------------------------

  it('re-throws non-conditional DDB errors', async () => {
    const networkErr = Object.assign(new Error('network error'), {
      name: 'NetworkError',
    });
    ddb.on(PutCommand).rejectsOnce(networkErr);

    await expect(handler()).rejects.toThrow('network error');
  });
});
