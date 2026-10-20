/**
 * What the attacks look at. A §3.11 plan is reviewed together with the exact
 * grounded context it was synthesised from (R-117) and the file the emitter
 * rendered from it — never one without the others.
 */
import type { FunctionalTestPlan, GroundedContext } from '@registry/functest';

export interface EmittedFile {
  /** Repo-relative path under `generated-tests/`. */
  path: string;
  contents: string;
}

export interface FunctionalUnderReview {
  plan: FunctionalTestPlan;
  context: GroundedContext;
  file: EmittedFile;
}

/** `source/requirementId` — the manifest reference used as a finding's target. */
export function planRef(u: FunctionalUnderReview): string {
  return `${u.context.requirement.source}/${u.context.requirement.id}`;
}

/**
 * A plan stored before PLAN_SCHEMA v2 (no structured fields). Only file-level
 * checks apply to it; every structured check treats it as having no assertions.
 */
export function isLegacyPlan(plan: FunctionalTestPlan): boolean {
  return typeof (plan as { planSchemaVersion?: unknown }).planSchemaVersion !== 'number';
}
