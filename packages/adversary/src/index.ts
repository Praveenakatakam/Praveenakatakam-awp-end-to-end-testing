/**
 * @registry/adversary — the adversarial review stage (§3.12).
 *
 * Attacks the artifact sets produced by the §3.9 and §3.11 generators before
 * they are persisted, and before a human ever looks at them: deterministic
 * grounding, vacuity and mutation attacks (which may withhold a §3.11 plan,
 * R-129) plus a report-only LLM critic (R-130). Pure and offline (NFR-10): the
 * critic (`CriticClient`) and its cache are injected — the Bedrock-backed client
 * lives in the functions package so this core never imports the SDK or AWS.
 */
export * from './finding.js';
export * from './verdict.js';
export * from './prompts.js';
export * from './posture-lint.js';
export * from './subject.js';
export * from './grounding.js';
export * from './vacuity.js';
export * from './mutate-testgen.js';
export * from './mutate-functest.js';
export * from './critic.js';
export * from './review.js';
export * from './report.js';
