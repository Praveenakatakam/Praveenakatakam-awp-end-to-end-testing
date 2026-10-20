/**
 * Grounding attack (R-133) — does every claim the plan and its emitted file make
 * trace to what the model was actually shown (the grounded context, R-117)?
 *
 * Critical (gates, R-129):
 *   (a) an assertion `fieldPath` the asserting service's own contract lacks, or a
 *       `matchesType` literal that contradicts that property's logicalType;
 *   (b) a payload key the publisher contract lacks / a required publisher
 *       property missing from the payload — WHEN the trigger path is a mapped
 *       path for the entity (Major otherwise: an event-driven trigger's request
 *       body is not the entity, OQ-15);
 *   (c) an assertion `clause` that is not a verbatim substring of the requirement;
 *   (d) an emitted file that reads env vars no API mapping names, or never reads
 *       a mapped service's env vars (so that service is never called).
 * Major:
 *   (e) a trigger or read-back path present in no API mapping (OQ-15).
 *
 * Structured checks (a)–(c) and the read-back half of (e) need a v2 plan; a
 * legacy plan gets only the file-level (d) and the trigger-path half of (e).
 */
import { envStem } from '@registry/functest';
import type { NormProp } from '@registry/core';
import type { DraftFinding } from './finding.js';
import { isLegacyPlan, planRef, type FunctionalUnderReview } from './subject.js';
import { locateClause, wireType } from './text.js';

const ENV_READ = /process\.env\.([A-Za-z_][A-Za-z0-9_]*)|process\.env\[\s*["']([^"']+)["']\s*\]/g;

type Resolution = { kind: 'ok'; prop: NormProp } | { kind: 'unverifiable'; parent: NormProp } | { kind: 'absent' };

/** `items.0.itemId` and `items[0].itemId` → the contract's `items[].itemId`; a trailing index names the element. */
function toSchemaPath(fieldPath: string): string {
  const path = fieldPath.replace(/\[\d+\]/g, '[]').replace(/\.\d+(?=\.|$)/g, '[]');
  return path.endsWith('[]') ? path.slice(0, -2) : path;
}

const isStructural = (p: NormProp) => ['object', 'array'].includes((p.logicalType ?? '').toLowerCase());

/**
 * Resolve a plan `fieldPath` against the asserting service's contract (R-133a).
 * With the flattened schema the WHOLE path is checked, nested segments included;
 * without it (a hand-built context) only the first segment is, as before.
 *   ok           — the path is a declared property;
 *   unverifiable — it descends into an object/array the contract never describes
 *                  (e.g. the item fields live in a sibling schema object), so it can
 *                  be neither confirmed nor refuted: Major, not Critical;
 *   absent       — anything else: an unknown name, or a child of a scalar or of a
 *                  structure that is described but lacks it.
 */
function resolveFieldPath(fieldPath: string, top: NormProp[], flat: NormProp[] | undefined): Resolution {
  if (!flat) {
    const prop = top.find((p) => p.name === fieldPath.split('.')[0]);
    return prop ? { kind: 'ok', prop } : { kind: 'absent' };
  }
  const path = toSchemaPath(fieldPath);
  const exact = flat.find((p) => p.name === path);
  if (exact) return { kind: 'ok', prop: exact };
  const ancestors = flat.filter((p) => path.startsWith(`${p.name}.`) || path.startsWith(`${p.name}[].`));
  const parent = ancestors.sort((a, b) => b.name.length - a.name.length)[0];
  if (!parent) return { kind: 'absent' };
  const described = flat.some((p) => p.name.startsWith(`${parent.name}.`) || p.name.startsWith(`${parent.name}[].`));
  return isStructural(parent) && !described ? { kind: 'unverifiable', parent } : { kind: 'absent' };
}

export function groundPlan(u: FunctionalUnderReview): DraftFinding[] {
  const { plan, context: ctx, file } = u;
  const ref = planRef(u);
  const target = { kind: 'functional' as const, ref, file: file.path };
  const out: DraftFinding[] = [];
  const finding = (rule: string, severity: DraftFinding['severity'], defect: string, failureScenario: string, evidence: string) =>
    out.push({ attack: 'grounding', severity, rule, target, defect, failureScenario, evidence });

  const publisherSource = plan.trigger.source;
  // The declared consumer (R-117c), never source order (T-59 F-07).
  const consumerSource = ctx.roles?.consumer ?? ctx.sources.find((s) => s !== publisherSource) ?? publisherSource;
  const sourceOf = (role: 'publisher' | 'consumer') => (role === 'publisher' ? publisherSource : consumerSource);
  const propsOf = (source: string) => ctx.schemasBySource[source] ?? [];
  const mappedPaths = ctx.apiTargets.map((t) => t.target.path);

  if (!isLegacyPlan(plan)) {
    // (a) fieldPath / matchesType against the ASSERTING service's own contract.
    plan.assertions.forEach((a, i) => {
      const source = sourceOf(a.service);
      const props = propsOf(source);
      const flat = ctx.flatSchemasBySource?.[source];
      const resolved = resolveFieldPath(a.fieldPath, props, flat);
      if (resolved.kind === 'unverifiable') {
        finding(
          'R-133a',
          'Major',
          `Assertion #${i + 1} reads ${a.service} field '${a.fieldPath}', but the ${source} contract declares '${resolved.parent.name}' as ${resolved.parent.logicalType} without describing its structure, so the path cannot be verified.`,
          `If '${a.fieldPath}' is not really served by ${source}, the read yields undefined and the assertion fails against a working system; nothing in the contract can confirm it either way.`,
          `plan.assertions[${i}].fieldPath = "${a.fieldPath}"; ${source}.${resolved.parent.name}: ${resolved.parent.logicalType} with no declared children`
        );
        return;
      }
      if (resolved.kind === 'absent') {
        finding(
          'R-133a',
          'Critical',
          `Assertion #${i + 1} reads ${a.service} field '${a.fieldPath}', which the ${source} contract does not define.`,
          `A correct ${source} never returns '${a.fieldPath}', so the read yields undefined and the assertion fails against a working system (or is meaningless).`,
          `plan.assertions[${i}].fieldPath = "${a.fieldPath}"; ${source} schema: ${(flat ?? props).map((p) => p.name).join(', ')}`
        );
        return;
      }
      const prop = resolved.prop;
      if (a.operator === 'matchesType' && a.expected?.from === 'literal') {
        const want = wireType(String(a.expected.value));
        const have = wireType(prop.logicalType);
        if (have && want !== have) {
          finding(
            'R-133a',
            'Critical',
            `Assertion #${i + 1} expects ${a.service} '${a.fieldPath}' to be ${String(a.expected.value)}, but the ${source} contract declares ${prop.logicalType}.`,
            `A ${source} that honours its contract returns a ${prop.logicalType}, so this assertion fails against a correct system.`,
            `plan.assertions[${i}].expected.value = "${String(a.expected.value)}"; ${source}.${prop.name}: ${prop.logicalType}`
          );
        }
      }
    });

    // (b) payload keys vs the publisher contract; severity depends on whether the write is mapped.
    const pubProps = propsOf(publisherSource);
    const triggerMapped = ctx.apiTargets.some((t) => t.source === publisherSource && t.target.path === plan.trigger.path);
    const severity = triggerMapped ? 'Critical' : 'Major';
    const payloadKeys = Object.keys(plan.trigger.payload ?? {});
    const unknown = payloadKeys.filter((k) => !pubProps.some((p) => p.name === k));
    const missing = pubProps.filter((p) => p.required && !payloadKeys.includes(p.name)).map((p) => p.name);
    const unmappedNote = triggerMapped ? '' : ` (the trigger path is unmapped, so the request shape is unverifiable — OQ-15)`;
    if (unknown.length) {
      finding(
        'R-133b',
        severity,
        `The trigger payload sends ${unknown.map((k) => `'${k}'`).join(', ')}, which the ${publisherSource} contract does not define${unmappedNote}.`,
        `The publisher rejects or ignores the unknown field(s), so the scenario the test describes never happens.`,
        `plan.trigger.payload keys: ${payloadKeys.join(', ')}`
      );
    }
    if (missing.length) {
      finding(
        'R-133b',
        severity,
        `The trigger payload omits required ${publisherSource} propert${missing.length === 1 ? 'y' : 'ies'} ${missing.map((k) => `'${k}'`).join(', ')}${unmappedNote}.`,
        `A publisher that validates its contract rejects the write, so the test fails at the trigger and never exercises propagation.`,
        `plan.trigger.payload keys: ${payloadKeys.join(', ') || '(none)'}; required: ${pubProps
          .filter((p) => p.required)
          .map((p) => p.name)
          .join(', ')}`
      );
    }

    // (c) clause must be verbatim.
    plan.assertions.forEach((a, i) => {
      if (!a.clause || !locateClause(ctx.requirement.text, a.clause)) {
        finding(
          'R-133c',
          'Critical',
          `Assertion #${i + 1} cites a clause that does not appear verbatim in ${ctx.requirement.id}.`,
          `The assertion verifies behaviour the requirement never states, so the test can pass while the actual requirement is broken.`,
          `plan.assertions[${i}].clause = "${a.clause}"`
        );
      }
    });
  }

  // (d) env vars the file reads vs the API mapping of every grounded source.
  const read = new Set<string>();
  for (const m of file.contents.matchAll(ENV_READ)) read.add(m[1] ?? m[2]);
  const expected = ctx.sources.map((source) => {
    const t = ctx.apiTargets.find((x) => x.source === source)?.target;
    return {
      source,
      mapped: Boolean(t),
      base: t?.baseUrlEnv ?? `${envStem(source)}_API_URL`,
      token: t?.tokenEnv ?? `${envStem(source)}_TOKEN`,
    };
  });
  const allowed = new Set(expected.flatMap((e) => [e.base, e.token]));
  const unexpected = [...read].filter((v) => !allowed.has(v)).sort();
  const neverRead = expected.filter((e) => e.mapped && !(read.has(e.base) && read.has(e.token)));
  if (unexpected.length || neverRead.length) {
    const mappedNames = expected.filter((e) => e.mapped).map((e) => `${e.source}: ${e.base}/${e.token}`);
    finding(
      'R-133d',
      'Critical',
      neverRead.length
        ? `The emitted file never reads the mapped env vars of ${neverRead.map((e) => e.source).join(', ')}, so it cannot call ${neverRead.length === 1 ? 'that service' : 'those services'}.`
        : `The emitted file reads env vars that no API mapping names.`,
      `Configured exactly as the API mapping says (${mappedNames.join('; ') || 'no mapped services'}), the suite either stays skipped forever or sends requests to the wrong service — ${neverRead.map((e) => e.base).join(', ') || 'the mapped base URLs'} ${neverRead.length ? 'is never used' : 'are bypassed'}.`,
      `${file.path} reads: ${[...read].sort().join(', ') || '(none)'}${unexpected.length ? `; not in any mapping: ${unexpected.join(', ')}` : ''}`
    );
  }

  // (d, second clause) a request sent to ANOTHER service's base URL. The file binds `publisherBase` and
  // `consumerBase` to env vars, sends the trigger to the first, and polls the read-back on the role's own.
  if (!isLegacyPlan(plan)) {
    const baseEnvOf = (source: string) => expected.find((e) => e.source === source)?.base;
    const wanted = { publisherBase: baseEnvOf(publisherSource), consumerBase: baseEnvOf(consumerSource) };
    const bound = new Map<string, string>();
    for (const m of file.contents.matchAll(/const\s+(publisherBase|consumerBase)\s*=\s*process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g)) bound.set(m[1], m[2]);
    const misbound = (['publisherBase', 'consumerBase'] as const).filter((v) => bound.has(v) && wanted[v] !== undefined && bound.get(v) !== wanted[v]);
    const triggerVar = /fetch\(\s*`\$\{(\w+)\}`/.exec(file.contents)?.[1];
    const pollVar = /url:\s*`\$\{(\w+)\}`/.exec(file.contents)?.[1];
    const readBackVar = plan.propagation.readBack.service === 'publisher' ? 'publisherBase' : 'consumerBase';
    const wrongTrigger = triggerVar !== undefined && triggerVar !== 'publisherBase';
    const wrongPoll = pollVar !== undefined && pollVar !== readBackVar;
    if (misbound.length || wrongTrigger || wrongPoll) {
      const what = [
        ...misbound.map((v) => `${v} is bound to ${bound.get(v)}, but the mapping names ${wanted[v]}`),
        ...(wrongTrigger ? [`the trigger is sent to ${triggerVar}, not publisherBase`] : []),
        ...(wrongPoll ? [`the read-back is polled on ${pollVar}, not ${readBackVar}`] : []),
      ];
      finding(
        'R-133d',
        'Critical',
        `The emitted file sends a request for one service to another service's base URL (${what.join('; ')}).`,
        `The write or the read-back goes to the wrong service, so the test fails against a correct system, or passes by exercising the wrong one.`,
        `${file.path}: ${what.join('; ')}`
      );
    }
  }

  // (e) paths that no mapping knows about.
  if (!mappedPaths.includes(plan.trigger.path)) {
    finding(
      'R-133e',
      'Major',
      `The trigger ${plan.trigger.method} ${plan.trigger.path} is in no API mapping for '${ctx.entity}'.`,
      `Nothing confirms the publisher exposes this write; if the path is wrong the test fails at the trigger and never exercises propagation.`,
      `mapped paths: ${mappedPaths.join(', ') || '(none)'}`
    );
  }
  if (!isLegacyPlan(plan)) {
    const rb = plan.propagation.readBack;
    const rbSource = sourceOf(rb.service);
    const rbMapped = ctx.apiTargets.find((t) => t.source === rbSource)?.target.path;
    if (rbMapped !== rb.path) {
      finding(
        'R-133e',
        'Major',
        `The read-back ${rb.path} is not the mapped read path of ${rbSource}${rbMapped ? ` (${rbMapped})` : ' (unmapped)'}.`,
        `The poll reads a path the ${rbSource} may not serve, so the record is never found and the test fails (or times out) against a correct system.`,
        `plan.propagation.readBack.path = "${rb.path}"`
      );
    }
  }

  return out;
}
