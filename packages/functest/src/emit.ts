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
 *
 * v2 (R-66): optional `apiTargets` drive the env-var names per grounded source,
 * and v2 plan fields (rationale, examplePayload, propagation channel, property
 * assertions, negativeCases) render as comments / `it.todo` entries when present.
 */
import type { FunctionalTestPlan, PlanAssertion } from './plan.js';
import type { EntityApiTarget } from '@registry/core';

const HEADER =
  '// GENERATED — DO NOT EDIT. Regenerate via `npm run generate-tests -- --functional` (see generated-tests/functional/manifest.json).';

function comment(lines: string[], indent = ''): string {
  return lines.map((l) => `${indent}// ${l}`).join('\n');
}

/** Split free text into comment-safe lines (LLM fields may contain newlines). */
function lines(text: string): string[] {
  return text.split(/\r?\n/);
}

/** Per-source env-var coordinates for the emitted test (R-66). */
export interface EmitApiTarget {
  source: string;
  target: Pick<EntityApiTarget, 'baseUrlEnv' | 'tokenEnv'>;
}

export interface EmitOptions {
  /**
   * Grounded API targets (per source). When given, env-var names come from each
   * target's `baseUrlEnv` / `tokenEnv` instead of the hardcoded v1
   * `PUBLISHER_*` / `CONSUMER_*` pair (R-66). Omit for the legacy v1 header.
   */
  apiTargets?: EmitApiTarget[];
}

/** `get-ready` → `getReady`; always a valid JS identifier prefix. */
function camel(source: string): string {
  const parts = source.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const id = parts.map((p, i) => (i === 0 ? p.charAt(0).toLowerCase() + p.slice(1) : p.charAt(0).toUpperCase() + p.slice(1))).join('');
  return /^[A-Za-z_$]/.test(id) ? id : `_${id}`;
}

/** `get-ready` → `GET_READY` (fallback env-var stem for an unmapped trigger source). */
function upperSnake(source: string): string {
  // Split + filter instead of a `/^_+|_+$/` trim: linear on any input (CodeQL js/polynomial-redos).
  return source.split(/[^A-Za-z0-9]/).filter(Boolean).join('_').toUpperCase();
}

interface EnvPair {
  source: string;
  base: string;
  token: string;
  baseUrlEnv: string;
  tokenEnv: string;
}

/**
 * Resolve the env-var pairs: trigger source first (so the v1 publisher/consumer
 * order is reproduced for a publisher trigger), then the remaining targets in
 * the given order. A trigger source with no API target gets a derived
 * `<SOURCE>_API_URL` / `<SOURCE>_TOKEN` pair so the trigger fetch has a base.
 */
function envPairs(plan: FunctionalTestPlan, opts: EmitOptions): EnvPair[] {
  const legacy: EmitApiTarget[] = [
    { source: 'publisher', target: { baseUrlEnv: 'PUBLISHER_API_URL', tokenEnv: 'PUBLISHER_TOKEN' } },
    { source: 'consumer', target: { baseUrlEnv: 'CONSUMER_API_URL', tokenEnv: 'CONSUMER_TOKEN' } },
  ];
  if (!opts.apiTargets) {
    return legacy.map((t) => ({
      source: t.source,
      base: `${t.source}Base`,
      token: `${t.source}Token`,
      baseUrlEnv: t.target.baseUrlEnv,
      tokenEnv: t.target.tokenEnv,
    }));
  }
  const targets = [...opts.apiTargets];
  const triggerIdx = targets.findIndex((t) => t.source === plan.trigger.source);
  const trigger =
    triggerIdx >= 0
      ? targets.splice(triggerIdx, 1)[0]
      : {
          source: plan.trigger.source,
          target: {
            baseUrlEnv: `${upperSnake(plan.trigger.source)}_API_URL`,
            tokenEnv: `${upperSnake(plan.trigger.source)}_TOKEN`,
          },
        };
  return [trigger, ...targets].map((t) => ({
    source: t.source,
    base: `${camel(t.source)}Base`,
    token: `${camel(t.source)}Token`,
    baseUrlEnv: t.target.baseUrlEnv,
    tokenEnv: t.target.tokenEnv,
  }));
}

/** `[service] assertion`, or `[service] field = expected — assertion` for property checks. */
function assertionLabel(a: PlanAssertion): string {
  if (a.field === undefined) return `[${a.service}] ${a.assertion}`;
  const check = a.expected === undefined ? a.field : `${a.field} = ${a.expected}`;
  return `[${a.service}] ${check} — ${a.assertion}`;
}

/**
 * Render one plan. `opts.apiTargets` (R-66) switches env-var names to the
 * grounded targets; without it the v1 publisher/consumer header is emitted, and
 * a v1 plan (no v2 fields) renders byte-identically to the pre-v0.4.0 emitter.
 */
export function emitFunctionalTest(plan: FunctionalTestPlan, index: number, opts: EmitOptions = {}): string {
  const reqs = plan.requirementIds.join(', ');
  const setup = plan.setup.length
    ? comment(['Setup / preconditions:', ...plan.setup.map((s) => `  - ${s.description}`)])
    : comment(['Setup / preconditions: none']);
  const rationale = plan.rationale !== undefined ? `${comment(['Rationale:', ...lines(plan.rationale).map((l) => `  ${l}`)])}\n` : '';
  const todos = [
    ...plan.assertions.map((a) => `  it.todo(${JSON.stringify(assertionLabel(a))});`),
    ...(plan.negativeCases ?? []).map(
      (n) => `  it.todo(${JSON.stringify(`[negative] ${n.description} → ${n.expectedOutcome}`)});`
    ),
  ].join('\n');
  const title = `functional: ${plan.title}`;

  const pairs = envPairs(plan, opts);
  const trigger = pairs[0].source === plan.trigger.source ? pairs[0] : pairs.find((p) => p.source === 'publisher') ?? pairs[0];
  const observers = opts.apiTargets
    ? [...new Set(plan.assertions.map((a) => a.service).filter((s) => s !== plan.trigger.source))]
    : [];
  const observerLabel = observers.length ? observers.join(', ') : 'consumer';
  const kind = plan.propagation.kind;
  const itName = `${plan.trigger.method} ${plan.trigger.path} → ${kind.toUpperCase()} → ${observerLabel} reflects change`;

  const envDecls = pairs
    .flatMap((p) => [`const ${p.base} = process.env.${p.baseUrlEnv};`, `const ${p.token} = process.env.${p.tokenEnv};`])
    .join('\n');
  const ready = pairs.flatMap((p) => [p.base, p.token]).join(' && ');
  const example =
    plan.trigger.examplePayload !== undefined
      ? `\n${comment(['example body:', ...lines(plan.trigger.examplePayload).map((l) => `  ${l}`)], '      ')}`
      : '';
  const channel = plan.propagation.channel !== undefined ? ` [channel: ${plan.propagation.channel}]` : '';

  return `${HEADER}
// Manifest plan #${index} — functional test for ${reqs}.
// inputHash ${plan.inputHash.slice(0, 16)} — regenerated only when grounded inputs change (R-119).
import { describe, it, expect } from "vitest";

${envDecls}
// Skipped (not failed) when cross-service credentials are absent — R-83a, D-26.
const ready = Boolean(${ready});

${rationale}${setup}
describe.skipIf(!ready)(${JSON.stringify(title)}, () => {
  it(${JSON.stringify(itName)}, async () => {
${comment(
  [
    `TRIGGER (${plan.trigger.source}/${plan.trigger.entity}): ${plan.trigger.method} ${plan.trigger.path}`,
    `payload shape: ${plan.trigger.payloadShape}`,
  ],
  '    '
)}
    const res = await fetch(\`\${${trigger.base}}${plan.trigger.path}\`, {
      method: ${JSON.stringify(plan.trigger.method)},
      headers: { Authorization: \`Bearer \${${trigger.token}}\`, "Content-Type": "application/json" },
      // body: JSON.stringify(/* ${plan.trigger.payloadShape} */),${example}
    });
    expect(res.ok, \`${plan.trigger.method} ${plan.trigger.path} → \${res.status}\`).toBe(true);
${comment([`PROPAGATION (${kind}): ${plan.propagation.waitFor}${channel}`], '    ')}
  });

${comment(['Post-propagation assertions — a runner fills these in (D-56):'], '  ')}
${todos}
});
`;
}
