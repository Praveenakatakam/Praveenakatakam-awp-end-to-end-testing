/**
 * T-50a/T-51a (shared tooling) — the deterministic finalize step of the
 * adversarial review skills (.claude/skills/adversarial-review-spec.md §5–§8,
 * AR-03, AR-05, AR-09): posture lint, ids, verdict, review.md layout, blind-pass
 * ordering, and the blind-safe input extraction.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  finalizeReview,
  renderReviewMarkdown,
  finalizeRunDir,
  blindInputs,
  parseBlindIds,
  foreignBlindIds,
  renderDroppedMarkdown,
  snapshotBlindInputs,
  type RawReview,
} from '../adversarial-review-finalize.js';

const raw = (over: Partial<RawReview> = {}): RawReview => ({
  skill: 'adversarial-test-review',
  version: '0.1',
  model: 'claude-opus-5-5',
  scope: 'generated-tests @ c473e83',
  needsDecision: [],
  findings: [],
  uncovered: [],
  discardedInstructions: [],
  ...over,
});

const defect = {
  severity: 'Critical',
  target: 'packages/testgen/src/generate.ts:39',
  defect: 'resolveCompatPair assigns publisher/consumer by alphabetical source label.',
  failureScenario: 'With sources `consumer` and `publisher`, the compat test checks the publisher’s required set against the consumer, so a dropped consumer-required field passes.',
  evidence: 'packages/testgen/src/generate.ts:37-41',
};

// ---- lint + ids (spec §5, §6, AR-03) ---------------------------------------

describe('finalizeReview — posture lint and ids', () => {
  it('drops praise, suggestions and empty defects/scenarios; keeps an unevidenced defect, tagged', () => {
    const { review } = finalizeReview(
      raw({
        findings: [
          defect,
          { severity: 'Minor', target: 'a.ts:1', defect: 'Nicely structured module, looks good.', failureScenario: '' },
          { severity: 'Minor', target: 'a.ts:2', defect: 'Consider extracting a helper.', failureScenario: 'Duplication may drift.' },
          { severity: 'Major', target: 'b.ts:3', defect: '', failureScenario: 'x' },
          { severity: 'Major', target: 'c.ts:4', defect: 'The poll has no deadline.', failureScenario: 'A stuck consumer hangs the suite.' },
        ],
      })
    );
    expect(review.droppedByPostureLint).toBe(3);
    expect(review.findings.map((f) => f.target)).toEqual(['packages/testgen/src/generate.ts:39', 'c.ts:4']);
    expect(review.findings[1].unevidenced).toBe(true);
    expect(review.findings[0].unevidenced).toBeUndefined();
  });

  it('counts malformed findings (unknown severity / no target) instead of throwing', () => {
    const { review } = finalizeReview(raw({ findings: [defect, { ...defect, severity: 'Blocker' }, { ...defect, target: '' }] as never }));
    expect(review.malformed).toBe(2);
    expect(review.findings).toHaveLength(1);
  });

  it('assigns F-nn after a deterministic sort: Critical → Major → Minor, then target', () => {
    const findings = [
      { ...defect, severity: 'Minor', target: 'z.ts:1' },
      { ...defect, severity: 'Critical', target: 'm.ts:1' },
      { ...defect, severity: 'Major', target: 'a.ts:1' },
      { ...defect, severity: 'Critical', target: 'b.ts:1' },
    ];
    const one = finalizeReview(raw({ findings })).review.findings;
    const two = finalizeReview(raw({ findings: [...findings].reverse() })).review.findings;
    expect(one).toEqual(two);
    expect(one.map((f) => `${f.id} ${f.severity} ${f.target}`)).toEqual([
      'F-01 Critical b.ts:1',
      'F-02 Critical m.ts:1',
      'F-03 Major a.ts:1',
      'F-04 Minor z.ts:1',
    ]);
  });

  it('keeps every dropped finding verbatim, with its reason, for dropped.md (AR-17)', () => {
    const praise = { severity: 'Minor', target: 'a.ts:1', defect: 'Nicely structured module, looks good.', failureScenario: 'n/a' };
    const suggestion = { severity: 'Minor', target: 'a.ts:2', defect: 'Consider extracting a helper.', failureScenario: 'Duplication may drift.' };
    const empty = { severity: 'Major', target: 'b.ts:3', defect: 'Real defect?', failureScenario: '' };
    const { dropped } = finalizeReview(
      raw({ findings: [defect, praise, suggestion, empty, { ...defect, severity: 'Blocker' }, { ...defect, target: '' }] as never })
    );
    expect(dropped.postureLint.map((d) => d.finding)).toEqual([praise, suggestion, empty]);
    expect(dropped.postureLint.map((d) => d.reason)).toEqual([
      expect.stringMatching(/^praise or suggestion \(matched .*looks/),
      expect.stringMatching(/^praise or suggestion \(matched .*consider/),
      'empty failure scenario',
    ]);
    expect(dropped.malformed.map((d) => d.reason)).toEqual(['unknown severity "Blocker"', 'no target']);
  });

  it('keeps an in-product reference (AR-08)', () => {
    const { review } = finalizeReview(raw({ findings: [{ ...defect, inProductRef: 'A-07' }] }));
    expect(review.findings[0].inProductRef).toBe('A-07');
  });
});

// ---- verdict (spec §7) -----------------------------------------------------

describe('finalizeReview — verdict', () => {
  const v = (sev: string[]) =>
    finalizeReview(raw({ findings: sev.map((severity, i) => ({ ...defect, severity, target: `f${i}.ts` })) })).review.verdict;

  it('applies the fixed rule, first match wins', () => {
    expect(v(['Minor', 'Critical'])).toBe('FAIL — Critical');
    expect(v(['Minor', 'Major'])).toBe('FAIL — Major');
    expect(v(['Minor'])).toBe('PASS WITH NOTES');
    expect(v([])).toBe('PASS');
  });

  it('needs-your-decision items never change the verdict', () => {
    const r = finalizeReview(raw({ needsDecision: [{ item: 'A-03', detail: 'disagree: …', evidence: 'x' }] })).review;
    expect(r.verdict).toBe('PASS');
    expect(r.needsDecision[0].id).toBe('D-01');
  });
});

// ---- blind-pass accounting (AR-15) -----------------------------------------

describe('foreignBlindIds', () => {
  it('reports rows numbered with a prefix other than X-', () => {
    const md = ['| ID | File |', '|---|---|', '| B-01 | a.ts |', '| B-02 | b.ts |', '| X-03 | c.ts |'].join('\n');
    expect(foreignBlindIds(md)).toEqual(['B-01', 'B-02']);
  });
  it('is empty when every row uses X-nn', () => {
    expect(foreignBlindIds(['| X-01 | a |', '| X-02 | b |'].join('\n'))).toEqual([]);
  });
});

describe('parseBlindIds', () => {
  it('reads X-nn ids from table rows only, deduplicated and naturally sorted', () => {
    const md = [
      '| ID | Side | Behaviour |',
      '|---|---|---|',
      '| X-10 | consumer | a |',
      '| X-2 | consumer | b |',
      '| X-2 | generator | dup |',
      'Prose mentioning X-99 is not an item.',
    ].join('\n');
    expect(parseBlindIds(md)).toEqual(['X-2', 'X-10']);
  });
});

describe('finalizeReview — blind accounting (AR-15)', () => {
  const blindIds = ['X-01', 'X-02', 'X-03', 'X-04'];

  it('reports blind items Pass 2 never assessed as uncovered, plus a needs-decision item', () => {
    const { review } = finalizeReview(
      raw({
        covered: [{ behaviour: 'X-01', by: 'generated-tests/compat/TaskPublished.generated.test.ts:12' }],
        uncovered: [{ behaviour: 'X-02 consumer reflects title', quote: 'SHALL …', coveredBy: '—' }],
      }),
      { blindIds }
    );
    expect(review.blindAccounting).toEqual({
      total: 4,
      covered: ['X-01'],
      uncovered: ['X-02'],
      notAssessed: ['X-03', 'X-04'],
      unknown: [],
    });
    expect(review.uncovered.map((u) => u.behaviour)).toEqual(['X-02 consumer reflects title', 'X-03', 'X-04']);
    expect(review.uncovered[2].coveredBy).toBe('not assessed by Pass 2');
    expect(review.needsDecision.map((d) => d.item)).toEqual(['Blind items not assessed']);
    expect(review.needsDecision[0].detail).toContain('X-03, X-04');
  });

  it('never changes the verdict (spec §7)', () => {
    expect(finalizeReview(raw(), { blindIds }).review.verdict).toBe('PASS');
  });

  it('an item listed as both covered and uncovered counts as uncovered', () => {
    const { review } = finalizeReview(
      raw({
        covered: [{ behaviour: 'X-01', by: 'a.ts:1' }],
        uncovered: [{ behaviour: 'X-01', quote: 'q', coveredBy: '—' }],
      }),
      { blindIds: ['X-01'] }
    );
    expect(review.blindAccounting?.covered).toEqual([]);
    expect(review.blindAccounting?.uncovered).toEqual(['X-01']);
    expect(review.covered).toBeUndefined();
  });

  it('flags X-nn ids Pass 2 cited that the blind pass never wrote', () => {
    const { review } = finalizeReview(
      raw({
        covered: [{ behaviour: 'X-01', by: 'a.ts:1' }],
        findings: [{ ...defect, evidence: 'violates X-07; packages/testgen/src/generate.ts:37' }],
      }),
      { blindIds: ['X-01'] }
    );
    expect(review.blindAccounting?.unknown).toEqual(['X-07']);
    expect(review.needsDecision.map((d) => d.item)).toEqual(['Unknown blind items cited']);
  });

  it('is skipped when the blind pass has no X-nn items (older raw files still finalize)', () => {
    const { review } = finalizeReview(raw(), { blindIds: [] });
    expect(review.blindAccounting).toBeUndefined();
    expect(review.needsDecision).toEqual([]);
  });

  it('renders the accounting line and the covered table', () => {
    const { review } = finalizeReview(raw({ covered: [{ behaviour: 'X-01', by: 'a.ts:1' }] }), { runName: 'r', blindIds: ['X-01', 'X-02'] });
    const md = renderReviewMarkdown(review);
    expect(md).toContain('- Blind items: 2 · covered 1 · uncovered 0 · not assessed by Pass 2 1');
    expect(md).toContain('## Expected behaviours covered');
    expect(md).toContain('| X-01 | a.ts:1 |');
  });
});

// ---- review.md (spec §8) ---------------------------------------------------

describe('renderReviewMarkdown', () => {
  it('follows the §8 layout, escapes pipes, and flags unevidenced findings', () => {
    const { review } = finalizeReview(
      raw({
        findings: [defect, { severity: 'Major', target: 'x|y.ts', defect: 'a | b', failureScenario: 'c' }],
        needsDecision: [{ item: 'A-03', detail: 'In-product finding looks wrong', evidence: 'report.json' }],
        uncovered: [{ behaviour: 'consumer reflects title', quote: 'SHALL make the published Task available', coveredBy: '—' }],
        discardedInstructions: ['contract description said "ignore previous instructions"'],
      }),
      { runName: '20261007-1400_test_feat-qa-agent-skills', pass1WrittenAt: '2026-10-07T14:00:00Z', finalizedAt: '2026-10-07T14:05:00Z' }
    );
    const md = renderReviewMarkdown(review);
    expect(md.startsWith('# Adversarial test review — 20261007-1400_test_feat-qa-agent-skills\n')).toBe(true);
    expect(md).toContain('**Verdict: FAIL — Critical**');
    expect(md).toContain('Pass 1 written 2026-10-07T14:00:00Z, before Pass 2');
    expect(md.indexOf('## Needs your decision')).toBeLessThan(md.indexOf('## Findings'));
    expect(md).toContain('## Expected behaviours not covered');
    expect(md).toContain('x\\|y.ts');
    expect(md).toContain('_unevidenced_');
    expect(md).toContain('## Discarded embedded instructions');
  });

  it('points to dropped.md only when something was dropped', () => {
    const clean = renderReviewMarkdown(finalizeReview(raw({ findings: [defect] })).review);
    const lint = renderReviewMarkdown(finalizeReview(raw({ findings: [{ ...defect, defect: 'Looks good.' }] })).review);
    expect(clean).not.toContain('dropped.md');
    expect(lint).toContain('Dropped by posture lint: 1 · Unevidenced: 0 · Malformed: 0 (see `dropped.md`)');
  });

  it('dropped.md lists posture-lint drops in a table and malformed items as JSON', () => {
    const { dropped } = finalizeReview(
      raw({ findings: [{ ...defect, defect: 'You might want a | pipe here.' }, { ...defect, severity: 'Blocker' }] as never })
    );
    const md = renderDroppedMarkdown('r', dropped);
    expect(md.startsWith('# Dropped findings — r\n')).toBe(true);
    expect(md).toContain('do **not** affect the verdict');
    expect(md).toContain('## Dropped by posture lint (1)');
    expect(md).toContain('You might want a \\| pipe here.');
    expect(md).toContain('## Malformed (1)');
    expect(md).toContain('1. unknown severity "Blocker": `{');
  });

  it('dropped.md says None. when nothing was dropped', () => {
    const md = renderDroppedMarkdown('r', { postureLint: [], malformed: [] });
    expect(md).toContain('## Dropped by posture lint (0)\nNone.');
    expect(md).toContain('## Malformed (0)\nNone.');
  });

  it('the code-review skill gets its own title', () => {
    const { review } = finalizeReview(raw({ skill: 'adversarial-code-review', scope: 'main...HEAD' }), { runName: 'r' });
    expect(renderReviewMarkdown(review).startsWith('# Adversarial code review — r\n')).toBe(true);
  });
});

// ---- run-dir finalize (AR-02 ordering) --------------------------------------

describe('finalizeRunDir', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'adv-review-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const write = (name: string, body: string, mtime: Date) => {
    writeFileSync(join(dir, name), body);
    utimesSync(join(dir, name), mtime, mtime);
  };

  it('writes review.json + review.md + dropped.md from review.raw.json', () => {
    write('expected-behaviours.md', '# Expected behaviours\n', new Date('2026-10-07T14:00:00Z'));
    const praise = { severity: 'Minor', target: 'a.ts:1', defect: 'Great coverage overall.', failureScenario: 'none' };
    write('review.raw.json', JSON.stringify(raw({ findings: [defect, praise] })), new Date('2026-10-07T14:04:00Z'));
    const r = finalizeRunDir(dir);
    expect(r.verdict).toBe('FAIL — Critical');
    expect(JSON.parse(readFileSync(join(dir, 'review.json'), 'utf8')).findings[0].id).toBe('F-01');
    expect(readFileSync(join(dir, 'review.md'), 'utf8')).toContain('**Verdict: FAIL — Critical**');
    expect(readFileSync(join(dir, 'review.md'), 'utf8')).not.toContain('Great coverage overall.');
    expect(readFileSync(join(dir, 'dropped.md'), 'utf8')).toContain('Great coverage overall.');
  });

  it('refuses when the blind pass is missing (AR-02)', () => {
    write('review.raw.json', JSON.stringify(raw()), new Date('2026-10-07T14:04:00Z'));
    expect(() => finalizeRunDir(dir)).toThrow(/blind pass .*missing/i);
  });

  it('refuses when the blind pass was written AFTER the reconcile pass (AR-02)', () => {
    write('review.raw.json', JSON.stringify(raw()), new Date('2026-10-07T14:00:00Z'));
    write('expected-behaviours.md', '# late\n', new Date('2026-10-07T14:09:00Z'));
    expect(() => finalizeRunDir(dir)).toThrow(/blind pass .*after/i);
  });

  it('refuses a raw review that is not JSON', () => {
    write('expected-behaviours.md', '# ok\n', new Date('2026-10-07T14:00:00Z'));
    write('review.raw.json', 'not json', new Date('2026-10-07T14:04:00Z'));
    expect(() => finalizeRunDir(dir)).toThrow(/review\.raw\.json/);
  });

  it('accounts for the blind pass X-nn rows (AR-15)', () => {
    write('expected-behaviours.md', '| ID | Side |\n|---|---|\n| X-01 | consumer |\n| X-02 | generator |\n', new Date('2026-10-07T14:00:00Z'));
    write('review.raw.json', JSON.stringify(raw({ covered: [{ behaviour: 'X-01', by: 'a.ts:1' }] })), new Date('2026-10-07T14:04:00Z'));
    const r = finalizeRunDir(dir);
    expect(r.blindAccounting?.notAssessed).toEqual(['X-02']);
    expect(readFileSync(join(dir, 'review.md'), 'utf8')).toContain('not assessed by Pass 2 1');
  });

  describe('preflight snapshot (AR-16)', () => {
    let generated: string;
    const manifest = (hash: string) =>
      writeFileSync(
        join(generated, 'manifest.json'),
        JSON.stringify({ tests: [{ kind: 'conformance', source: 'get-ready', entity: 'TaskPublished', contractId: 'urn:g', contentHash: hash }] })
      );
    beforeEach(() => {
      generated = mkdtempSync(join(tmpdir(), 'adv-gen-'));
      manifest('g1');
      snapshotBlindInputs(generated, dir);
      write('expected-behaviours.md', '# ok\n', new Date('2026-10-07T14:00:00Z'));
      write('review.raw.json', JSON.stringify(raw()), new Date('2026-10-07T14:04:00Z'));
    });
    afterEach(() => rmSync(generated, { recursive: true, force: true }));

    it('writes blind-inputs.json with the generated dir and the blind-safe inputs', () => {
      const snap = JSON.parse(readFileSync(join(dir, 'blind-inputs.json'), 'utf8'));
      expect(snap.inputs).toEqual(blindInputs(generated));
      expect(snap.generatedDir).toBe(generated);
    });

    it('finalizes when the generated tree is unchanged', () => {
      expect(finalizeRunDir(dir).verdict).toBe('PASS');
    });

    it('refuses when the generated tree changed after preflight', () => {
      manifest('g2');
      expect(() => finalizeRunDir(dir)).toThrow(/changed since the preflight snapshot/);
    });
  });
});

// ---- blind-safe inputs (AR-05) ---------------------------------------------

describe('blindInputs', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'adv-blind-'));
    mkdirSync(join(dir, 'functional'));
    writeFileSync(
      join(dir, 'manifest.json'),
      JSON.stringify({
        tests: [
          { kind: 'conformance', source: 'get-ready', entity: 'TaskPublished', contractId: 'urn:g', contentHash: 'g1', jsonSchema: { SECRET: 'schema' } },
          {
            kind: 'compat',
            entity: 'TaskPublished',
            publisher: { source: 'create', contractId: 'urn:c', contentHash: 'c1' },
            consumer: { source: 'get-ready', contractId: 'urn:g', contentHash: 'g1' },
            consumerRequired: [{ name: 'LEAK' }],
          },
        ],
        skipped: [
          { kind: 'conformance', target: 'deliver/urn:d:result-package', reason: "LEAK no API mapping for entity 'ResultPackage'" },
          { kind: 'conformance', target: 'score/urn:s:result-package', reason: 'LEAK validation: invalid' },
          { kind: 'conformance', target: 'get-ready/urn:g', reason: 'LEAK duplicate of a tested contract' },
          { kind: 'compat', target: 'ClassAssignment', reason: 'LEAK no declared publisher/consumer roles' },
          { kind: 'compat', target: 'TaskPublished', reason: 'LEAK duplicate of a tested entity' },
        ],
        adversarial: { findings: [{ defect: 'LEAK' }] },
      })
    );
    writeFileSync(
      join(dir, 'functional', 'manifest.json'),
      JSON.stringify({ plans: [{ requirementIds: ['CRE-R-24'], title: 'LEAK', assertions: [{ assertion: 'LEAK' }] }], skipped: [{ requirement: 'create/CRE-R-9', reason: 'LEAK' }] })
    );
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('extracts only ids and content hashes — never assertions, schemas, titles, reasons or findings', () => {
    const b = blindInputs(dir);
    expect(b).toEqual({
      requirements: ['CRE-R-24', 'create/CRE-R-9'],
      contracts: [
        { source: 'create', id: 'urn:c', contentHash: 'c1' },
        { source: 'get-ready', id: 'urn:g', contentHash: 'g1' },
      ],
      skippedContracts: [
        { source: 'deliver', id: 'urn:d:result-package' },
        { source: 'score', id: 'urn:s:result-package' },
      ],
      entities: ['ClassAssignment', 'TaskPublished'],
    });
    expect(JSON.stringify(b)).not.toMatch(/LEAK|SECRET/);
  });

  it('lists contracts and entities that appear only as skips, ids and names only, never a reason (review 20261013-1055)', () => {
    const b = blindInputs(dir);
    expect(b.skippedContracts.map((c) => `${c.source}/${c.id}`)).toEqual(['deliver/urn:d:result-package', 'score/urn:s:result-package']);
    expect(b.entities).toContain('ClassAssignment');
    // A contract that is already tested is not repeated as skipped.
    expect(b.skippedContracts.some((c) => c.source === 'get-ready')).toBe(false);
  });

  it('is unchanged by a manifest with no skips', () => {
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ tests: [] }));
    expect(blindInputs(dir).skippedContracts).toEqual([]);
  });
});
