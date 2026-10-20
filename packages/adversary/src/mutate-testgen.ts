/**
 * §3.9 mutation attack — executed / manifest tier (R-135, D-71).
 *
 * For each compat-eligible entity, break the catalog pair in ways the generated
 * compat test MUST notice, regenerate with the SAME generator core, and evaluate
 * the result:
 *   M1 delete a consumer-required property from the publisher      → must go red
 *   M2 change that property's logicalType in the publisher         → must go red
 *   M3 rename that property in the publisher                       → must go red
 *   M4 make the consumer require a property the publisher lacks    → must go red
 *   C1 add a publisher-only optional property (control, E-26)      → must stay green
 * A surviving M-mutant or a red C1 is a Critical GENERATOR finding: the defect is
 * in `packages/testgen`, not in one emitted test, so §3.9 tests are never
 * withheld for it (R-129).
 *
 * Roles come from the caller (`roles`), never from the generator under test —
 * otherwise a role-inversion bug would grade itself. Live data passes the
 * declared flows (`resolveRoles`, R-135 v0.8.0); fixtures declare their own.
 * A flow's field map (R-84c) is honoured: M1–M3 act on the PUBLISHER property
 * mapped to each consumer-required one.
 *
 * Mutated contracts are re-serialised as JSON (valid YAML); untouched contracts
 * keep their original bytes. `evaluate` is the tier seam: the manifest tier
 * (here) evaluates the compat manifest entry with the emitted test's semantics;
 * the executed tier (CLI, T-47) runs the emitted file under Vitest.
 */
import { parseAndValidate, type EntityFlows } from '@registry/core';
import { generateArtifacts, type CatalogContract, type CompatTest } from '@registry/testgen';
import type { DraftFinding } from './finding.js';

export type Roles = Record<string, { publisher: string; consumer: string; fields?: Record<string, string> }>;
export type CompatOutcome = 'green' | 'red' | 'absent';
export type CompatEvaluator = (catalog: CatalogContract[], entity: string) => CompatOutcome | Promise<CompatOutcome>;

/** Evaluate many cases at once (the executed tier runs one Vitest process per batch). */
export type BatchEvaluator = (cases: { catalog: CatalogContract[]; entity: string }[]) => Promise<CompatOutcome[]>;

export interface CompatMutant {
  /** `<operator>:<property>`, e.g. `M1:sourcedId`. */
  id: string;
  operator: 'M1' | 'M2' | 'M3' | 'M4' | 'C1';
  entity: string;
  expect: 'red' | 'green';
  /** One-line description used in findings. */
  description: string;
  catalog: CatalogContract[];
}

export interface TestgenMutationResult {
  tier: 'manifest' | 'executed';
  findings: DraftFinding[];
  entities: { entity: string; applicable: boolean; total: number; killed: number; survivors: string[] }[];
}

export const GENERATOR_REF = 'packages/testgen';
const M4_PROPERTY = 'advM4Required';
const C1_PROPERTY = 'advC1Extra';

interface OdcsProp {
  name: string;
  logicalType?: string;
  required?: boolean;
  [k: string]: unknown;
}

/** Evaluate a compat manifest entry exactly as the emitted test does (R-84). */
export function compatOutcome(t: CompatTest): Exclude<CompatOutcome, 'absent'> {
  const pub = new Map(t.publisherProps.map((p) => [p.name, p.logicalType]));
  return t.consumerRequired.every((r) => {
    const name = t.fieldMap?.[r.name] ?? r.name;
    return pub.has(name) && pub.get(name) === r.logicalType;
  })
    ? 'green'
    : 'red';
}

/** Manifest tier over a generator run with `flows` (seed 6 feeds it a mis-declared flow). */
export function manifestTierEvaluatorWith(flows?: EntityFlows): CompatEvaluator {
  return (catalog, entity) => {
    const t = generateArtifacts(catalog, flows).manifest.tests.find((x) => x.kind === 'compat' && x.entity === entity) as
      | CompatTest
      | undefined;
    return t ? compatOutcome(t) : 'absent';
  };
}

/** Manifest tier: run the real generator core (declared flows), evaluate the entity's compat entry. */
export const manifestTierEvaluator: CompatEvaluator = manifestTierEvaluatorWith();

function propsOf(rawYaml: string): OdcsProp[] {
  const doc = parseAndValidate(rawYaml).parsed as { schema?: { properties?: OdcsProp[] }[] } | undefined;
  return doc?.schema?.[0]?.properties ?? [];
}

/** Return `contract` with schema[0].properties transformed, re-serialised as JSON. */
function withProps(contract: CatalogContract, edit: (props: OdcsProp[]) => OdcsProp[]): CatalogContract {
  const doc = structuredClone(parseAndValidate(contract.rawYaml).parsed) as { schema: { properties: OdcsProp[] }[] };
  doc.schema[0].properties = edit(doc.schema[0].properties ?? []);
  return { ...contract, rawYaml: JSON.stringify(doc, null, 2) };
}

function replace(catalog: CatalogContract[], next: CatalogContract): CatalogContract[] {
  return catalog.map((c) => (c.source === next.source && c.id === next.id ? next : c));
}

const otherType = (t: string | undefined) => (t === 'string' ? 'integer' : 'string');

export function compatMutants(catalog: CatalogContract[], entity: string, roles: Roles): CompatMutant[] {
  const r = roles[entity];
  const pub = r && catalog.find((c) => c.entity === entity && c.source === r.publisher);
  const con = r && catalog.find((c) => c.entity === entity && c.source === r.consumer);
  if (!pub || !con) return [];

  const pubNames = new Set(propsOf(pub.rawYaml).map((p) => p.name));
  // Consumer property → the publisher property that satisfies it (R-84c).
  const conToPub = new Map(Object.entries(r.fields ?? {}).map(([p, c]) => [c, p]));
  const pubNameOf = (conName: string) => conToPub.get(conName) ?? conName;
  const required = propsOf(con.rawYaml)
    .filter((p) => p.required === true && pubNames.has(pubNameOf(p.name)))
    .map((p) => p.name)
    .sort();

  const out: CompatMutant[] = [];
  for (const conName of required) {
    const name = pubNameOf(conName);
    const via = name === conName ? '' : ` (publisher '${name}')`;
    out.push({
      id: `M1:${conName}`,
      operator: 'M1',
      entity,
      expect: 'red',
      description: `the publisher drops consumer-required '${conName}'${via}`,
      catalog: replace(
        catalog,
        withProps(pub, (ps) => ps.filter((p) => p.name !== name))
      ),
    });
    out.push({
      id: `M2:${conName}`,
      operator: 'M2',
      entity,
      expect: 'red',
      description: `the publisher retypes consumer-required '${conName}'${via}`,
      catalog: replace(
        catalog,
        withProps(pub, (ps) => ps.map((p) => (p.name === name ? { ...p, logicalType: otherType(p.logicalType) } : p)))
      ),
    });
    out.push({
      id: `M3:${conName}`,
      operator: 'M3',
      entity,
      expect: 'red',
      description: `the publisher renames consumer-required '${conName}'${via} to '${name}Renamed'`,
      catalog: replace(
        catalog,
        withProps(pub, (ps) => ps.map((p) => (p.name === name ? { ...p, name: `${name}Renamed` } : p)))
      ),
    });
  }
  out.push({
    id: `M4:${M4_PROPERTY}`,
    operator: 'M4',
    entity,
    expect: 'red',
    description: `the consumer starts requiring '${M4_PROPERTY}', which the publisher lacks`,
    catalog: replace(
      catalog,
      withProps(con, (ps) => [...ps, { name: M4_PROPERTY, logicalType: 'string', required: true }])
    ),
  });
  out.push({
    id: `C1:${C1_PROPERTY}`,
    operator: 'C1',
    entity,
    expect: 'green',
    description: `the publisher adds an extra optional property '${C1_PROPERTY}'`,
    catalog: replace(
      catalog,
      withProps(pub, (ps) => [...ps, { name: C1_PROPERTY, logicalType: 'string', required: false }])
    ),
  });
  return out;
}

/** Per-case evaluation, one case at a time (the manifest tier's natural shape). */
export async function mutateTestgen(
  catalog: CatalogContract[],
  roles: Roles,
  evaluate: CompatEvaluator = manifestTierEvaluator,
  tier: 'manifest' | 'executed' = 'manifest'
): Promise<TestgenMutationResult> {
  const sequential: BatchEvaluator = async (cases) => {
    const out: CompatOutcome[] = [];
    for (const c of cases) out.push(await evaluate(c.catalog, c.entity));
    return out;
  };
  return mutateTestgenBatched(catalog, roles, sequential, tier);
}

/**
 * Two batches in total, whatever the number of entities: every baseline first
 * (to decide applicability), then every mutant of every applicable entity. The
 * executed tier turns each batch into ONE Vitest process (design §12.5).
 */
export async function mutateTestgenBatched(
  catalog: CatalogContract[],
  roles: Roles,
  runBatch: BatchEvaluator,
  tier: 'manifest' | 'executed' = 'manifest'
): Promise<TestgenMutationResult> {
  const findings: DraftFinding[] = [];
  const entities: TestgenMutationResult['entities'] = [];
  const names = Object.keys(roles).sort();
  if (names.length === 0) return { tier, findings, entities };

  const baselines = await runBatch(names.map((entity) => ({ catalog, entity })));
  const applicable = names.filter((_, i) => baselines[i] === 'green');
  const mutantsByEntity = new Map(applicable.map((e) => [e, compatMutants(catalog, e, roles)]));
  const flat = applicable.flatMap((e) => mutantsByEntity.get(e)!);
  const outcomes = flat.length ? await runBatch(flat.map((m) => ({ catalog: m.catalog, entity: m.entity }))) : [];
  const outcomeOf = new Map(flat.map((m, i) => [m, outcomes[i]]));

  for (const entity of names) {
    if (!applicable.includes(entity)) {
      // A red baseline is the compat test doing its job (E-25); an absent one has no test to attack.
      entities.push({ entity, applicable: false, total: 0, killed: 0, survivors: [] });
      continue;
    }
    const mutants = mutantsByEntity.get(entity)!;
    const survivors: string[] = [];
    for (const m of mutants) {
      const outcome = outcomeOf.get(m)!;
      if (outcome === m.expect) continue;
      survivors.push(m.id);
      const control = m.operator === 'C1';
      findings.push({
        attack: 'mutation',
        severity: 'Critical',
        rule: 'R-135',
        target: { kind: 'generator', ref: GENERATOR_REF },
        mutant: m.id,
        defect: control
          ? `The generated compat test for '${entity}' fails when ${m.description} — a false positive.`
          : `The generated compat test for '${entity}' stays ${outcome} when ${m.description}.`,
        failureScenario: control
          ? `A publisher that only ADDS a field the consumer ignores (allowed, E-26) turns the compat suite red and blocks a compatible change.`
          : `A publisher release where ${m.description} breaks the ${roles[entity].consumer} consumer, yet the regenerated compat test does not fail.`,
        evidence: `mutant ${m.id} (${tier} tier): expected ${m.expect}, got ${outcome}; roles publisher=${roles[entity].publisher}, consumer=${roles[entity].consumer}`,
      });
    }
    entities.push({ entity, applicable: true, total: mutants.length, killed: mutants.length - survivors.length, survivors });
  }
  return { tier, findings, entities };
}
