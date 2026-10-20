/**
 * T-41a — adversary core: finding shape + ordering (R-128, R-131), verdict rule
 * (R-132), the critic persona (R-138, D-75), and the posture lint (R-140,
 * D-78, D-79).
 */
import { describe, it, expect } from 'vitest';
import {
  finalizeFindings,
  countFindings,
  verdictOf,
  PERSONA,
  CRITIC_PROMPTS,
  CRITIC_PROMPT_VERSION,
  CRITIC_BLIND_SCHEMA,
  CRITIC_FINDINGS_SCHEMA,
  lintCriticFindings,
  type DraftFinding,
  type Finding,
} from '../src/index.js';

const USER_PERSONA =
  'You are an adversarial reviewer with a single job: find defects, broken logic, and reasons this code will fail. Do not praise or suggest improvements.';

function draft(over: Partial<DraftFinding> = {}): DraftFinding {
  return {
    attack: 'vacuity',
    severity: 'Critical',
    rule: 'R-134a',
    target: { kind: 'functional', ref: 'create/CRE-R-24', file: 'functional/cre-r-24-taskpublished.generated.test.ts' },
    defect: 'The only executable check is res.ok.',
    failureScenario: 'The consumer never receives the event; the test is still green.',
    evidence: 'functional/cre-r-24-taskpublished.generated.test.ts:28',
    ...over,
  };
}

// ---- Findings (R-128, R-131) -----------------------------------------------

describe('finalizeFindings', () => {
  it('assigns A-nn ids after a deterministic sort, independent of input order', () => {
    const a = draft({ target: { kind: 'functional', ref: 'b/R-2' }, severity: 'Major' });
    const b = draft({ target: { kind: 'functional', ref: 'a/R-1' } });
    const c = draft({ target: { kind: 'compat', ref: 'org' }, attack: 'mutation', rule: 'R-135' });
    const one = finalizeFindings([a, b, c]);
    const two = finalizeFindings([c, b, a]);
    expect(one).toEqual(two);
    expect(one.map((f) => f.id)).toEqual(['A-01', 'A-02', 'A-03']);
    // compat < functional by target kind; then by ref
    expect(one.map((f) => f.target.ref)).toEqual(['org', 'a/R-1', 'b/R-2']);
  });

  it('orders Critical before Major before Minor within one target', () => {
    const t = { kind: 'functional' as const, ref: 'x/R-1' };
    const out = finalizeFindings([
      draft({ target: t, severity: 'Minor' }),
      draft({ target: t, severity: 'Critical' }),
      draft({ target: t, severity: 'Major' }),
    ]);
    expect(out.map((f) => f.severity)).toEqual(['Critical', 'Major', 'Minor']);
  });

  it('every finalized finding carries the R-128 fields', () => {
    const [f] = finalizeFindings([draft()]);
    for (const k of ['id', 'attack', 'severity', 'target', 'defect', 'failureScenario', 'evidence'] as const) {
      expect(f[k], k).toBeDefined();
    }
  });

  it('counts findings by attack × severity, with zeros for every cell', () => {
    const counts = countFindings(finalizeFindings([draft(), draft({ attack: 'grounding', severity: 'Major' })]));
    expect(counts.vacuity.Critical).toBe(1);
    expect(counts.grounding.Major).toBe(1);
    expect(counts.mutation).toEqual({ Critical: 0, Major: 0, Minor: 0 });
    expect(counts.critic).toEqual({ Critical: 0, Major: 0, Minor: 0 });
  });
});

// ---- Verdict (R-132) -------------------------------------------------------

describe('verdictOf', () => {
  const crit = () => finalizeFindings([draft()]);
  const major = () => finalizeFindings([draft({ severity: 'Major' })]);
  const minor = () => finalizeFindings([draft({ severity: 'Minor' })]);

  it('FAIL — withheld when any plan was withheld (wins over everything)', () => {
    expect(verdictOf(minor(), 1)).toBe('FAIL — withheld');
  });
  it('FAIL — review findings for a Critical or Major with nothing withheld', () => {
    expect(verdictOf(crit(), 0)).toBe('FAIL — review findings');
    expect(verdictOf(major(), 0)).toBe('FAIL — review findings');
  });
  it('PASS WITH NOTES for Minor only', () => {
    expect(verdictOf(minor(), 0)).toBe('PASS WITH NOTES');
  });
  it('PASS for no findings', () => {
    expect(verdictOf([], 0)).toBe('PASS');
  });
  it('a critic Critical alone still fails the review (report-only ≠ ignored)', () => {
    expect(verdictOf(finalizeFindings([draft({ attack: 'critic' })]), 0)).toBe('FAIL — review findings');
  });
});

// ---- Persona + prompts (R-138, D-75) ---------------------------------------

describe('critic prompts', () => {
  it("PERSONA is the user's sentence, verbatim", () => {
    expect(PERSONA).toBe(USER_PERSONA);
  });

  it('every prompt version: both passes begin with the persona', () => {
    const versions = Object.keys(CRITIC_PROMPTS);
    expect(versions).toContain(CRITIC_PROMPT_VERSION);
    for (const v of versions) {
      expect(CRITIC_PROMPTS[v].blind.startsWith(USER_PERSONA), `${v}.blind`).toBe(true);
      expect(CRITIC_PROMPTS[v].reconcile.startsWith(USER_PERSONA), `${v}.reconcile`).toBe(true);
    }
  });

  it('forced-tool schemas are closed objects', () => {
    for (const s of [CRITIC_BLIND_SCHEMA, CRITIC_FINDINGS_SCHEMA] as { type?: string; additionalProperties?: boolean }[]) {
      expect(s.type).toBe('object');
      expect(s.additionalProperties).toBe(false);
    }
  });
});

// ---- Posture lint (R-140, D-78, D-79) --------------------------------------

describe('lintCriticFindings', () => {
  const evidenced = {
    severity: 'Major',
    defect: 'The consumer assertion compares itemCount, which the consumer contract does not define.',
    failureScenario: 'get-ready stores totalItemCount; at(record, "itemCount") is undefined and the test fails on a correct system.',
    evidence: 'manifest.json /plans/0/assertions/5',
  };

  it('keeps an evidenced defect and tags it as a critic finding on the given target', () => {
    const { kept, droppedByPostureLint, malformed } = lintCriticFindings({ findings: [evidenced] }, 'create/CRE-R-24');
    expect(droppedByPostureLint).toBe(0);
    expect(malformed).toBe(0);
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ attack: 'critic', severity: 'Major', target: { kind: 'functional', ref: 'create/CRE-R-24' } });
    expect(kept[0].unevidenced).toBeUndefined();
  });

  it('keeps a defect with a failure scenario but no evidence, tagged unevidenced (D-79)', () => {
    const { evidence: _drop, ...noEvidence } = evidenced;
    const { kept } = lintCriticFindings({ findings: [noEvidence] }, 'create/CRE-R-24');
    expect(kept).toHaveLength(1);
    expect(kept[0].unevidenced).toBe(true);
    expect(kept[0].evidence).toBeUndefined();
  });

  it('drops praise and improvement suggestions, even when a scenario is attached (D-75, D-78)', () => {
    const raw = {
      findings: [
        { severity: 'Minor', defect: 'The test is well-structured and looks good.', failureScenario: '' },
        { severity: 'Minor', defect: 'Consider renaming the describe block for clarity.', failureScenario: 'Readers may be confused.' },
        { severity: 'Minor', defect: 'I would recommend adding a retry helper.', failureScenario: 'A flaky network may fail it.' },
        evidenced,
      ],
    };
    const { kept, droppedByPostureLint } = lintCriticFindings(raw, 'create/CRE-R-24');
    expect(droppedByPostureLint).toBe(3);
    expect(kept.map((f) => f.defect)).toEqual([evidenced.defect]);
  });

  it('drops a finding with an empty defect or an empty failure scenario', () => {
    const raw = {
      findings: [
        { ...evidenced, defect: '  ' },
        { ...evidenced, failureScenario: '' },
      ],
    };
    expect(lintCriticFindings(raw, 'r').droppedByPostureLint).toBe(2);
  });

  it('counts structurally malformed output instead of throwing (R-141)', () => {
    expect(lintCriticFindings('not an object', 'r')).toEqual({ kept: [], droppedByPostureLint: 0, malformed: 1 });
    const bad = lintCriticFindings({ findings: [{ ...evidenced, severity: 'Catastrophic' }, evidenced] }, 'r');
    expect(bad.malformed).toBe(1);
    expect(bad.kept).toHaveLength(1);
  });

  it('kept findings are finalizable (they satisfy the R-128 shape)', () => {
    const { kept } = lintCriticFindings({ findings: [evidenced] }, 'create/CRE-R-24');
    const [f]: Finding[] = finalizeFindings(kept);
    expect(f.id).toBe('A-01');
  });
});
