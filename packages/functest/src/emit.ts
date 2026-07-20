/**
 * Render one `FunctionalTestPlan` → an executable-but-skipped Vitest file
 * (R-122, R-123). Deterministic: same plan in → byte-identical file out (R-119a),
 * no timestamps / run ids / random values — the "lockfile" render half of D-52.
 *
 * The emitted file is a grounded SCAFFOLD, not a self-checking test: the plan is
 * an LLM-authored description, so setup/propagation/assertions render as a
 * documented scenario plus a real `fetch` for the trigger, guarded by
 * `describe.skipIf` on the four cross-service env vars — exactly like conformance
 * (R-83a, D-26), so it never fails in CI without live apps. Assertions become
 * `it.todo` a future runner (or a human) fills in. Running these stays out of
 * scope (D-56); this component generates and stores them.
 */
import type { FunctionalTestPlan } from "./plan.js";

const HEADER =
  "// GENERATED — DO NOT EDIT. Regenerate via `npm run generate-tests -- --functional` (see generated-tests/functional/manifest.json).";

function comment(lines: string[], indent = ""): string {
  return lines.map((l) => `${indent}// ${l}`).join("\n");
}

export function emitFunctionalTest(plan: FunctionalTestPlan, index: number): string {
  const reqs = plan.requirementIds.join(", ");
  const setup = plan.setup.length
    ? comment(["Setup / preconditions:", ...plan.setup.map((s) => `  - ${s.description}`)])
    : comment(["Setup / preconditions: none"]);
  const assertionTodos = plan.assertions
    .map((a) => `  it.todo(${JSON.stringify(`[${a.service}] ${a.assertion}`)});`)
    .join("\n");
  const title = `functional: ${plan.title}`;
  const itName = `${plan.trigger.method} ${plan.trigger.path} → CDC → consumer reflects change`;

  return `${HEADER}
// Manifest plan #${index} — functional test for ${reqs}.
// inputHash ${plan.inputHash.slice(0, 16)} — regenerated only when grounded inputs change (R-119).
import { describe, it, expect } from "vitest";

const publisherBase = process.env.PUBLISHER_API_URL;
const publisherToken = process.env.PUBLISHER_TOKEN;
const consumerBase = process.env.CONSUMER_API_URL;
const consumerToken = process.env.CONSUMER_TOKEN;
// Skipped (not failed) when cross-service credentials are absent — R-83a, D-26.
const ready = Boolean(publisherBase && publisherToken && consumerBase && consumerToken);

${setup}
describe.skipIf(!ready)(${JSON.stringify(title)}, () => {
  it(${JSON.stringify(itName)}, async () => {
${comment(
  [
    `TRIGGER (${plan.trigger.source}/${plan.trigger.entity}): ${plan.trigger.method} ${plan.trigger.path}`,
    `payload shape: ${plan.trigger.payloadShape}`,
  ],
  "    ",
)}
    const res = await fetch(\`\${publisherBase}${plan.trigger.path}\`, {
      method: ${JSON.stringify(plan.trigger.method)},
      headers: { Authorization: \`Bearer \${publisherToken}\`, "Content-Type": "application/json" },
      // body: JSON.stringify(/* ${plan.trigger.payloadShape} */),
    });
    expect(res.ok, \`${plan.trigger.method} ${plan.trigger.path} → \${res.status}\`).toBe(true);
${comment([`PROPAGATION (cdc): ${plan.propagation.waitFor}`], "    ")}
  });

${comment(["Post-propagation assertions — a runner fills these in (D-56):"], "  ")}
${assertionTodos}
});
`;
}
