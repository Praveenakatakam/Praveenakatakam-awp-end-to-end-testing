/**
 * Render one `FunctionalTestPlan` → an executable, env-gated Vitest file
 * (R-117b, R-122, R-123). Deterministic: same plan in → byte-identical file out
 * (R-119a), no timestamps / run ids / random values — the "lockfile" render half
 * of D-52.
 *
 * v2 (D-74, superseding D-70's `it.todo` assertions): the trigger is sent WITH
 * its concrete payload, propagation is a bounded poll of the read-back endpoint,
 * and every plan assertion renders as a real `expect()`. Each service's base-URL
 * and token come from the env-var names stamped from its API mapping (D-31), not
 * fixed names. The suite stays `describe.skipIf`-gated on those env vars, exactly
 * like conformance (R-83a, D-26), so it never fails in CI without live apps.
 * Running these stays out of scope (D-56); this component generates and stores them.
 */
import { readPath, type Expected, type FunctionalTestPlan, type PlanAssertion, type PlanTarget, type Role } from './plan.js';

const HEADER =
  '// GENERATED — DO NOT EDIT. Regenerate via `npm run generate-tests -- --functional` (see generated-tests/functional/manifest.json).';

/** Extra per-test time beyond the propagation timeout, for the trigger + read-back requests. */
const REQUEST_HEADROOM_SECONDS = 30;

/** ODCS logicalTypes whose JSON wire form is a string. */
const STRING_WIRE_TYPES = new Set(['date', 'timestamp', 'time']);

/** Collapse a string onto one line so it is safe inside a `//` comment. */
function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function comment(lines: string[], indent = ''): string {
  return lines.map((l) => `${indent}// ${oneLine(l)}`).join('\n');
}

function target(plan: FunctionalTestPlan, role: Role): PlanTarget {
  const t = plan.targets.find((x) => x.role === role);
  if (!t) throw new Error(`plan for ${plan.requirementIds.join(', ')} has no '${role}' target (unstamped plan?)`);
  return t;
}

/** The JS expression holding the record a service's assertions read from. */
function subject(plan: FunctionalTestPlan, service: Role): string {
  if (service === plan.propagation.readBack.service) return 'readBackRecord';
  return service === 'publisher' ? 'published' : 'undefined';
}

function expectedExpr(plan: FunctionalTestPlan, e: Expected | undefined): string {
  if (!e) return 'undefined';
  if (e.from === 'literal') return JSON.stringify(e.value);
  // Never render toEqual(undefined): it passes whenever the consumer field is missing too. validatePlan
  // rejects this; the emitter refuses it as well, for a plan that bypassed validation.
  if (readPath(plan.trigger.payload, e.path) === undefined) {
    throw new Error(`plan for ${plan.requirementIds.join(', ')}: expected.path '${e.path}' is not a trigger.payload key`);
  }
  return `at(payload, ${JSON.stringify(e.path)})`;
}

function renderAssertion(plan: FunctionalTestPlan, a: PlanAssertion, i: number): string {
  const actual = `at(${subject(plan, a.service)}, ${JSON.stringify(a.fieldPath)})`;
  const message = JSON.stringify(`[${a.service}] ${a.fieldPath} — ${oneLine(a.clause)}`);
  let check: string;
  if (a.operator === 'exists') {
    // "Exists" means present AND not null, unless the contract marks the field nullable:
    // toBeDefined() alone passes on null, so a consumer that nulls a required field stays green.
    const nullable = (plan.nullable ?? []).includes(`${a.service}:${a.fieldPath}`);
    check = nullable
      ? `expect(${actual}, ${message}).toBeDefined();`
      : `expect(${actual}, ${message}).toBeDefined();\n    expect(${actual}, ${message}).not.toBeNull();`;
  } else if (a.operator === 'equals') {
    check = `expect(${actual}, ${message}).toEqual(${expectedExpr(plan, a.expected)});`;
  } else {
    const declared = a.expected?.from === 'literal' ? String(a.expected.value) : '';
    const wire = STRING_WIRE_TYPES.has(declared) ? 'string' : declared;
    const nullable = (plan.nullable ?? []).includes(`${a.service}:${a.fieldPath}`);
    check = `expect(typeMatches(${actual}, ${JSON.stringify(wire)}, ${nullable}), \`\${${message}}: got \${logicalTypeOf(${actual})}\`).toBe(true);`;
  }
  return `    // assertion #${i + 1} [${a.service}] ${a.operator} — "${oneLine(a.clause)}"\n    ${check}`;
}

export function emitFunctionalTest(plan: FunctionalTestPlan, index: number): string {
  const reqs = plan.requirementIds.join(', ');
  const pub = target(plan, 'publisher');
  const con = target(plan, 'consumer');
  const readBack = plan.propagation.readBack;
  const readBackTarget = readBack.service === 'publisher' ? pub : con;
  const readBackBase = readBack.service === 'publisher' ? 'publisherBase' : 'consumerBase';
  const readBackToken = readBack.service === 'publisher' ? 'publisherToken' : 'consumerToken';

  const setup = plan.setup.length
    ? comment(['Setup / preconditions:', ...plan.setup.map((s) => `  - ${s.description}`)])
    : comment(['Setup / preconditions: none']);
  const unmapped = plan.targets.filter((t) => !t.mapped).map((t) => `${t.role} '${t.source}'`);
  const unmappedNote = unmapped.length
    ? `\n${comment([`No API mapping for ${unmapped.join(', ')} — env names are conventional (OQ-15).`])}`
    : '';
  const payload = JSON.stringify(plan.trigger.payload, null, 2).replace(/\n/g, '\n    ');
  const assertions = plan.assertions.map((a, i) => renderAssertion(plan, a, i)).join('\n');
  const readsPublished = plan.assertions.some((a) => subject(plan, a.service) === 'published');
  const title = `functional: ${plan.title}`;
  const itName = `${plan.trigger.method} ${plan.trigger.path} → CDC → ${readBack.service} reflects change`;
  const testTimeoutMs = (plan.propagation.timeoutSeconds + REQUEST_HEADROOM_SECONDS) * 1000;

  return `${HEADER}
// Manifest plan #${index} — functional test for ${reqs}.
// inputHash ${plan.inputHash.slice(0, 16)} — regenerated only when grounded inputs change (R-119).
import { describe, it, expect } from "vitest";

const publisherBase = process.env.${pub.baseUrlEnv};
const publisherToken = process.env.${pub.tokenEnv};
const consumerBase = process.env.${con.baseUrlEnv};
const consumerToken = process.env.${con.tokenEnv};
// Skipped (not failed) when cross-service credentials are absent — R-83a, D-26.
const ready = Boolean(publisherBase && publisherToken && consumerBase && consumerToken);${unmappedNote}

/** Read a dotted path ("a.b") from a value. */
function at(value: unknown, path: string): unknown {
  return path.replace(/\\[(\\d+)\\]/g, ".$1").split(".").reduce<any>((o, k) => (o == null ? o : o[k]), value);
}

/** A value's type in ODCS logicalType terms. */
function logicalTypeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

/** Does a value satisfy a declared logicalType? \`number\` accepts integers; null only where the contract allows it. */
function typeMatches(value: unknown, declared: string, nullable: boolean): boolean {
  if (value === null) return nullable;
  const actual = logicalTypeOf(value);
  return actual === declared || (declared === "number" && actual === "integer");
}

/** The record array: the body itself, or a tRPC envelope's result.data (result.data.json under superjson). */
function recordsOf(body: unknown): unknown[] {
  const data = (body as any)?.result?.data;
  return ([body, data, data?.json].find(Array.isArray) as unknown[] | undefined) ?? [];
}

/** Poll a read endpoint until a record whose \`matchOn\` equals \`value\` appears, or the deadline passes. */
async function pollUntil(opts: {
  url: string;
  token: string;
  recordsAt: string;
  matchOn: string;
  value: unknown;
  timeoutSeconds: number;
  pollIntervalSeconds: number;
}): Promise<unknown> {
  const deadline = Date.now() + opts.timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    const res = await fetch(opts.url, { headers: { Authorization: \`Bearer \${opts.token}\` } });
    if (res.ok) {
      const body: unknown = await res.json();
      const records = opts.recordsAt ? at(body, opts.recordsAt) : recordsOf(body);
      const found = (Array.isArray(records) ? records : []).find((r) => at(r, opts.matchOn) === opts.value);
      if (found !== undefined) return found;
    }
    await new Promise((resolve) => setTimeout(resolve, opts.pollIntervalSeconds * 1000));
  }
  return undefined;
}

${setup}
describe.skipIf(!ready)(${JSON.stringify(title)}, () => {
  it(${JSON.stringify(itName)}, async () => {
${comment([`TRIGGER (${plan.trigger.source}/${plan.trigger.entity}): ${plan.trigger.method} ${plan.trigger.path}`], '    ')}
    const payload = ${payload};
    const res = await fetch(\`\${publisherBase}\` + ${JSON.stringify(plan.trigger.path)}, {
      method: ${JSON.stringify(plan.trigger.method)},
      headers: { Authorization: \`Bearer \${publisherToken}\`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(res.ok, ${JSON.stringify(`${plan.trigger.method} ${plan.trigger.path} → `)} + res.status).toBe(true);${readsPublished ? '\n    // Publisher assertions read what the publisher accepted: the payload sent, overlaid with the response when that is a JSON object.\n    const responseBody: unknown = await res.json().catch(() => undefined);\n    const published: unknown = { ...payload, ...(responseBody !== null && typeof responseBody === "object" && !Array.isArray(responseBody) ? responseBody : {}) };' : ''}

${comment([`PROPAGATION (cdc): ${plan.propagation.waitFor}`], '    ')}
    const readBackRecord = await pollUntil({
      url: \`\${${readBackBase}}\` + ${JSON.stringify(readBack.path)},
      token: ${readBackToken} as string,
      recordsAt: ${JSON.stringify(readBackTarget.recordsAt)},
      matchOn: ${JSON.stringify(readBack.matchOn)},
      value: at(payload, ${JSON.stringify(readBack.matchFrom ?? readBack.matchOn)}),
      timeoutSeconds: ${plan.propagation.timeoutSeconds},
      pollIntervalSeconds: ${plan.propagation.pollIntervalSeconds},
    });
    expect(readBackRecord, ${JSON.stringify(`${readBack.service} never reflected ${readBack.matchOn} within ${plan.propagation.timeoutSeconds}s`)}).toBeDefined();

${assertions}
  }, ${testTimeoutMs});
});
`;
}
