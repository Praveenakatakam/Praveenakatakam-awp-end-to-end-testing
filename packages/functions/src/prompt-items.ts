/**
 * Pure builders for new prompt items (PRMPT header + first PRMPTVER) and the
 * legacy-import key, shared by `POST /prompts`, `POST /prompts/import-legacy`
 * (pipeline.ts, R-31, R-72) and the deploy-time seeder (prompt-seed.ts, R-85).
 *
 * Deliberately free of AWS clients and SST bindings: the seeder Script is bound
 * to the table only, so it cannot import pipeline.ts / repository.ts (which read
 * the bucket binding at module load).
 */
import type { PromptItem, PromptVersionItem } from '@registry/core';

/** Prompt key a legacy prompt version is imported under (R-72). */
export function legacyPromptKey(promptVersion: string): string {
  return `legacy-${promptVersion}`;
}

/** Zero-pad a prompt version number to 5 digits (e.g. `1` → `00001`). */
export function padPromptVersion(v: number): string {
  return String(v).padStart(5, '0');
}

/**
 * The PRMPT header (currentVersion 1, active) and immutable
 * PRMPTVER#<key>#00001 for a brand-new prompt. Exactly one of
 * `storage.inlineBody` / `storage.s3Ref` is expected (R-34).
 */
export function newPromptItems(
  promptKey: string,
  storage: { inlineBody?: string; s3Ref?: string },
  now: string
): { header: PromptItem; version: PromptVersionItem } {
  const version = 1;
  const { inlineBody, s3Ref } = storage;
  const header: PromptItem = {
    pk: `PRMPT#${promptKey}`,
    sk: 'PRMPT',
    kind: 'PRMPT',
    promptKey,
    currentVersion: version,
    active: true,
    createdAt: now,
    updatedAt: now,
    ...(inlineBody !== undefined ? { body: inlineBody } : {}),
    ...(s3Ref !== undefined ? { s3Ref } : {}),
  };
  const versionItem: PromptVersionItem = {
    pk: `PRMPTVER#${promptKey}#${padPromptVersion(version)}`,
    sk: 'PRMPTVER',
    kind: 'PRMPTVER',
    promptKey,
    version,
    createdAt: now,
    ...(inlineBody !== undefined ? { body: inlineBody } : {}),
    ...(s3Ref !== undefined ? { s3Ref } : {}),
  };
  return { header, version: versionItem };
}
