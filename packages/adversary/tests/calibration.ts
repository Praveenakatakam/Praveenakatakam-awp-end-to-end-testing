/**
 * Loader for the adversarial calibration set (T-48 · R-145). Reads seed folders
 * under `__fixtures__/calibration/`, resolving `extends` + `addAssertions`, and
 * returns real contracts, plans, grounded contexts and emitted files — the same
 * objects the adversarial stage sees in production. Test-only.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ground,
  stampPlan,
  emitFunctionalTests,
  type ContractInput,
  type FunctionalTestPlan,
  type GroundedContext,
  type PlanBody,
  type RequirementInput,
} from '@registry/functest';
import type { CatalogContract } from '@registry/testgen';
import type { EntityApiTarget, EntityFlows } from '@registry/core';

export const CALIBRATION_DIR = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'calibration');

const read = (...p: string[]) => readFileSync(join(CALIBRATION_DIR, ...p), 'utf8');
const readJson = <T>(...p: string[]): T => JSON.parse(read(...p)) as T;

export const CALIBRATION_API_MAP = readJson<{ map: Record<string, Record<string, EntityApiTarget>> }>('api-map.json').map;

/** The model/prompt identity calibration plans are grounded under (any stable values). */
const MODEL = 'calibration-model';
const PROMPT = 'v2';

interface SeedContractRef {
  source: string;
  entity: string;
  id: string;
  contentHash: string;
  file: string;
}

interface RawSeed {
  id: string;
  title: string;
  provenance: string;
  extends?: string;
  addAssertions?: PlanBody['assertions'];
  requirement?: RequirementInput;
  contracts?: SeedContractRef[];
  plan?: PlanBody;
  planFile?: string;
  emittedFile?: string;
}

export interface FunctionalSeed {
  id: string;
  path: string;
  requirement: RequirementInput;
  contracts: ContractInput[];
  context: GroundedContext;
  /** The stored plan: a stamped v2 plan, or the verbatim legacy v1 plan. */
  plan: FunctionalTestPlan;
  /** The unstamped body as the LLM would return it (v2 seeds only). */
  body?: PlanBody;
  /** True for the verbatim committed v1 plan (no structured fields). */
  legacy: boolean;
  /** Emitted test file text: verbatim for legacy seeds, else rendered by the real emitter. */
  file: { path: string; contents: string };
}

function resolveRaw(path: string): RawSeed & { requirement: RequirementInput; contracts: SeedContractRef[] } {
  const raw = readJson<RawSeed>(path, 'seed.json');
  if (!raw.extends) {
    if (!raw.requirement || !raw.contracts) throw new Error(`seed ${path} lacks requirement/contracts`);
    return raw as RawSeed & { requirement: RequirementInput; contracts: SeedContractRef[] };
  }
  const base = resolveRaw(join(dirname(path), raw.extends));
  const plan = base.plan ? { ...base.plan, assertions: [...base.plan.assertions, ...(raw.addAssertions ?? [])] } : undefined;
  return { ...base, id: raw.id, title: raw.title, provenance: raw.provenance, plan, extends: undefined };
}

function contractInputs(refs: SeedContractRef[]): ContractInput[] {
  return refs.map((c) => ({ source: c.source, entity: c.entity, id: c.id, contentHash: c.contentHash, rawYaml: read(c.file) }));
}

export function loadFunctionalSeed(path: string): FunctionalSeed {
  const raw = resolveRaw(path);
  const contracts = contractInputs(raw.contracts);
  const g = ground(raw.requirement, contracts, CALIBRATION_API_MAP, MODEL, PROMPT);
  if (!g.ok) throw new Error(`seed ${raw.id} does not ground: ${g.reason}`);

  if (raw.planFile) {
    const plan = readJson<FunctionalTestPlan>(path, raw.planFile);
    if (!raw.emittedFile) throw new Error(`legacy seed ${raw.id} needs emittedFile`);
    return {
      id: raw.id,
      path,
      requirement: raw.requirement,
      contracts,
      context: g.context,
      plan,
      legacy: true,
      file: { path: `functional/${raw.emittedFile.replace(/\.txt$/, '')}`, contents: read(path, raw.emittedFile) },
    };
  }
  if (!raw.plan) throw new Error(`seed ${raw.id} has neither plan nor planFile`);
  const plan = stampPlan(raw.plan, g.context);
  const [file] = emitFunctionalTests([plan]);
  return { id: raw.id, path, requirement: raw.requirement, contracts, context: g.context, plan, body: raw.plan, legacy: false, file };
}

export interface TestgenSeed {
  path: string;
  /** The TRUE roles — the mutation oracle's ground truth. */
  roles: Record<string, { publisher: string; consumer: string; fields?: Record<string, string> }>;
  /** Flows fed to the generator UNDER TEST, when they differ from the truth (v0.8.0 seed 6). */
  generatorFlows?: EntityFlows;
  catalog: CatalogContract[];
}

export function loadTestgenSeed(path: string): TestgenSeed {
  const raw = readJson<{
    roles: TestgenSeed['roles'];
    generatorFlows?: EntityFlows;
    contracts: (Omit<CatalogContract, 'rawYaml'> & { file: string })[];
  }>(path, 'catalog.json');
  return {
    path,
    roles: raw.roles,
    ...(raw.generatorFlows ? { generatorFlows: raw.generatorFlows } : {}),
    catalog: raw.contracts.map(({ file, ...c }) => ({ ...c, rawYaml: read(file) })),
  };
}

export interface ConformanceSeed {
  path: string;
  entry: unknown;
  file: { path: string; contents: string };
}

export function loadConformanceSeed(path: string): ConformanceSeed {
  return {
    path,
    entry: readJson(path, 'manifest-entry.json'),
    file: { path: 'conformance/get-ready.TaskPublished.generated.test.ts', contents: read(path, 'file.generated.test.ts.txt') },
  };
}

export interface AnswerKeyExpectation {
  attack?: string;
  rule?: string;
  severity?: string;
  targetKind?: string;
  mutant?: string;
}

export interface AnswerKeySeed {
  seed: string;
  kind: 'functional' | 'testgen' | 'conformance';
  path: string;
  tag: string;
  expect: AnswerKeyExpectation[];
  forbid?: AnswerKeyExpectation[];
  critic?: string[];
}

export const ANSWER_KEY = readJson<{ seeds: AnswerKeySeed[] }>('answer-key.json').seeds;

export function seedExists(path: string): boolean {
  return existsSync(join(CALIBRATION_DIR, path));
}
