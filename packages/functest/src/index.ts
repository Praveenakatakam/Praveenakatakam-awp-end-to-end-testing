/**
 * @registry/functest — LLM-powered cross-service functional test generator (§3.11).
 *
 * catalog (contracts + EARS requirements) → grounded LLM plan synthesis →
 * cached, deterministically-rendered Vitest scaffolds. Pure and offline (NFR-8):
 * the LLM (`LlmClient`) and the plan cache (`PlanCache`) are injected — the
 * Anthropic-backed client and the S3/DynamoDB cache live in the functions
 * package so this core never imports the SDK or AWS. Consumed by the async
 * `POST /generate-functional-tests` worker and the `generate-tests --functional`
 * CLI. Running the emitted tests is out of scope (D-56).
 */
export * from './generate.js';
