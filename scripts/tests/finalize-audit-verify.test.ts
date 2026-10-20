/**
 * AR-18 (finalize runs the citation audit) and AR-19 (Pass 3 verification): both are informational and
 * neither may change the verdict. Run folders are real temp directories; cited paths are real repo files.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finalizeReview, finalizeRunDir, readVerification, renderReviewMarkdown, type FindingVerification, type RawReview } from '../adversarial-review-finalize.js';

const raw = (over: Partial<RawReview> = {}): RawReview => ({
  skill: 'adversarial-code-review',
  version: '0.5',
  model: 'claude-fable-5-1',
  scope: 'main @ abc1234',
  needsDecision: [],
  findings: [],
  uncovered: [],
  discardedInstructions: [],
  ...over,
});

const REAL = 'packages/core/src/compare.ts:10';
const finding = (severity: string, target = REAL, defect = `A defect in ${target}.`) => ({
  severity,
  target,
  defect,
  failureScenario: 'A concrete failure.',
  evidence: `see ${target}`,
});

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'adv-audit-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const write = (name: string, body: string, mtime: Date) => {
  writeFileSync(join(dir, name), body);
  utimesSync(join(dir, name), mtime, mtime);
};
const T = (s: string) => new Date(`2026-10-15T${s}Z`);
const setup = (r: RawReview, verification?: unknown, verificationAt = T('10:30:00')) => {
  write('expected-behaviours.md', '# Expected behaviours\n', T('10:00:00'));
  write('review.raw.json', JSON.stringify(r), T('10:10:00'));
  if (verification !== undefined) write('verification.json', typeof verification === 'string' ? verification : JSON.stringify(verification), verificationAt);
};
const md = () => readFileSync(join(dir, 'review.md'), 'utf8');

// ---- AR-18 ------------------------------------------------------------------

describe('finalize runs the citation audit and lists hard failures (AR-18)', () => {
  it('lists a fabricated file, line and rule id, and still applies the verdict from the findings alone', () => {
    setup(
      raw({
        findings: [
          finding('Minor', 'packages/core/src/does-not-exist.ts:5'),
          { ...finding('Minor'), evidence: 'violates R-9999 at packages/core/src/compare.ts:99999' },
        ],
      })
    );
    const review = finalizeRunDir(dir);
    expect(review.verdict).toBe('PASS WITH NOTES');
    expect(review.citationAudit?.hard.map((i) => i.problem.replace(/\d+ lines/, 'N lines')).sort()).toEqual(
      ['file does not exist', 'line out of range (file has N lines)', 'rule id is not defined in specs/'].sort()
    );
    expect(md()).toContain('## Citations not verified');
    expect(md()).toContain('does-not-exist.ts');
    expect(md()).toContain('R-9999');
    expect(md()).toMatch(/Citation audit: \d+ items checked · 3 NOT FOUND/);
  });

  it('says None. and reports zero NOT FOUND when every citation resolves', () => {
    setup(raw({ findings: [finding('Major')] }));
    finalizeRunDir(dir);
    expect(md()).toMatch(/## Citations not verified[\s\S]*None\./);
    expect(md()).toMatch(/Citation audit: \d+ items checked · 0 NOT FOUND/);
  });

  it('a fabricated citation can never lower or raise the verdict', () => {
    setup(raw({ findings: [finding('Critical', 'packages/nope.ts:1')] }));
    expect(finalizeRunDir(dir).verdict).toBe('FAIL — Critical');
    setup(raw({ findings: [] }));
    expect(finalizeRunDir(dir).verdict).toBe('PASS');
  });

  it('writes the audit into review.json', () => {
    setup(raw({ findings: [finding('Minor', 'packages/nope.ts:1')] }));
    finalizeRunDir(dir);
    const json = JSON.parse(readFileSync(join(dir, 'review.json'), 'utf8'));
    expect(json.citationAudit.hard).toHaveLength(1);
    expect(json.citationAudit.checked).toBe(1);
  });

  it('checks decision items too', () => {
    setup(raw({ needsDecision: [{ item: 'x', detail: 'see packages/missing-dir/file.ts:3', evidence: 'y' }] }));
    expect(finalizeRunDir(dir).citationAudit?.hard.map((i) => i.ref)).toEqual(['packages/missing-dir/file.ts']);
  });
});

// ---- AR-19 ------------------------------------------------------------------

const verdicts = (...v: [number, string, string?][]) => ({
  model: 'claude-fable-5-1',
  findings: v.map(([index, verdict, reason]) => ({ index, verdict, reason: reason ?? `reason for ${index}`, evidence: `packages/core/src/compare.ts:${index + 1}` })),
});

describe('Pass 3 verification is shown beside each finding and never changes the verdict (AR-19)', () => {
  it('shows each verdict in the table and counts them in the header', () => {
    setup(raw({ findings: [finding('Major', REAL, 'First.'), finding('Minor', REAL, 'Second.'), finding('Minor', REAL, 'Third.')] }), verdicts([0, 'CONFIRMED'], [1, 'REFUTED'], [2, 'UNCLEAR']));
    const review = finalizeRunDir(dir);
    expect(review.verification).toMatchObject({ status: 'ok', model: 'claude-fable-5-1', confirmed: 1, refuted: 1, unclear: 1, notVerified: 0 });
    expect(md()).toContain('Claim verification (Pass 3, model claude-fable-5-1): 1 confirmed · 1 refuted · 1 unclear · 0 not verified');
    expect(md()).toContain('| Verified |');
    expect(md()).toMatch(/\| F-01 \| Major .* \| CONFIRMED \|/);
  });

  it('a refuted Critical still fails the verdict, and is listed with its reason', () => {
    setup(raw({ findings: [finding('Critical', REAL, 'Looks wrong.')] }), verdicts([0, 'REFUTED', 'The guard at compare.ts:12 already handles this.']));
    const review = finalizeRunDir(dir);
    expect(review.verdict).toBe('FAIL — Critical');
    expect(md()).toContain('## Findings the verifier refuted');
    expect(md()).toContain('The guard at compare.ts:12 already handles this.');
  });

  it('matches verdicts to findings by raw position even though ids are assigned after sorting', () => {
    // Raw order: Minor (index 0), Critical (index 1). After sorting the Critical is F-01.
    setup(raw({ findings: [finding('Minor', REAL, 'The minor one.'), finding('Critical', REAL, 'The critical one.')] }), verdicts([0, 'REFUTED'], [1, 'CONFIRMED']));
    const review = finalizeRunDir(dir);
    expect(review.findings.map((f) => `${f.id} ${f.severity} ${f.verification?.verdict}`)).toEqual(['F-01 Critical CONFIRMED', 'F-02 Minor REFUTED']);
  });

  it('counts findings with no verdict as not verified', () => {
    setup(raw({ findings: [finding('Minor', REAL, 'A.'), finding('Minor', REAL, 'B.')] }), verdicts([0, 'CONFIRMED']));
    expect(finalizeRunDir(dir).verification).toMatchObject({ confirmed: 1, notVerified: 1 });
  });

  it('says so when Pass 3 did not run, rather than implying the claims were checked', () => {
    setup(raw({ findings: [finding('Minor')] }));
    const review = finalizeRunDir(dir);
    expect(review.verification).toBeUndefined();
    expect(md()).toContain('Claim verification (Pass 3): not run');
  });

  it('ignores a verification written before review.raw.json was last changed (stale)', () => {
    setup(raw({ findings: [finding('Minor')] }), verdicts([0, 'REFUTED']), T('09:00:00'));
    const review = finalizeRunDir(dir);
    expect(review.verification).toMatchObject({ status: 'stale', confirmed: 0, refuted: 0, notVerified: 1 });
    expect(review.findings[0].verification).toBeUndefined();
    expect(md()).toContain('ignored, written before review.raw.json was last changed');
  });

  it('ignores an unreadable verification file (invalid)', () => {
    setup(raw({ findings: [finding('Minor')] }), 'not json');
    expect(finalizeRunDir(dir).verification?.status).toBe('invalid');
    setup(raw({ findings: [finding('Minor')] }), { model: 'm' });
    expect(finalizeRunDir(dir).verification?.status).toBe('invalid');
  });

  it('skips entries that cannot be applied safely: bad index, unknown verdict, no reason', () => {
    const v = {
      findings: [
        { index: 5, verdict: 'REFUTED', reason: 'out of range' },
        { index: -1, verdict: 'REFUTED', reason: 'negative' },
        { index: 0.5, verdict: 'REFUTED', reason: 'fractional' },
        { index: 0, verdict: 'MAYBE', reason: 'unknown verdict' },
        { index: 0, verdict: 'CONFIRMED', reason: '   ' },
        { index: '0', verdict: 'CONFIRMED', reason: 'string index' },
      ],
    };
    setup(raw({ findings: [finding('Minor')] }), v);
    const review = finalizeRunDir(dir);
    expect(review.verification).toMatchObject({ status: 'ok', confirmed: 0, refuted: 0, unclear: 0, notVerified: 1 });
  });

  it('the last entry for an index wins', () => {
    setup(raw({ findings: [finding('Minor')] }), verdicts([0, 'REFUTED'], [0, 'CONFIRMED']));
    expect(finalizeRunDir(dir).findings[0].verification?.verdict).toBe('CONFIRMED');
  });

  it('a finding dropped by the lint does not shift the others: positions are raw, not post-lint', () => {
    const praise = { severity: 'Minor', target: REAL, defect: 'Nicely structured module, looks good.', failureScenario: 'n/a' };
    setup(raw({ findings: [praise, finding('Major', REAL, 'The real one.')] }), verdicts([1, 'CONFIRMED']));
    expect(finalizeRunDir(dir).findings.map((f) => f.verification?.verdict)).toEqual(['CONFIRMED']);
  });

  it('the output does not depend on the order Pass 2 listed its findings', () => {
    const a = finding('Critical', 'packages/core/src/compare.ts:1', 'Alpha.');
    const b = finding('Minor', 'packages/core/src/compare.ts:2', 'Beta.');
    const one = finalizeReview(raw({ findings: [a, b] })).review.findings;
    const two = finalizeReview(raw({ findings: [b, a] })).review.findings;
    expect(one).toEqual(two);
    expect(JSON.stringify(one)).not.toContain('rawIndex');
  });
});

describe('readVerification', () => {
  const v = (x: FindingVerification['verdict']) => verdicts([0, x]);

  it('returns undefined when there is no file', () => {
    setup(raw());
    expect(readVerification(dir, T('10:10:00'), 1)).toBeUndefined();
  });

  it('applies a verification written after the raw review, and the same instant counts as fresh', () => {
    setup(raw({ findings: [finding('Minor')] }), v('CONFIRMED'), T('10:10:00'));
    expect(readVerification(dir, T('10:10:00'), 1)?.status).toBe('ok');
  });

  it('renders without a verification block when finalizeReview is given none', () => {
    const { review } = finalizeReview(raw({ findings: [finding('Minor')] }));
    expect(review.verification).toBeUndefined();
    expect(renderReviewMarkdown(review)).toContain('not run');
  });
});
