/**
 * The blind pass reports itself compromised by writing ONLY the marker `BLIND PASS COMPROMISED` (agent
 * definitions, AR-02). Finalize must refuse that, and must NOT refuse a legitimate blind pass that merely
 * mentions the marker, e.g. in a behaviour row about how finalize treats it (found in run 20261015-1217).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finalizeRunDir, isBlindCompromised } from '../adversarial-review-finalize.js';

const MARKER = 'BLIND PASS COMPROMISED';

describe('isBlindCompromised', () => {
  it.each([
    ['the marker alone', MARKER],
    ['the marker with a trailing newline', `${MARKER}\n`],
    ['leading blank lines and spaces', `\n\n  ${MARKER}  \n`],
    ['Windows line endings', `${MARKER}\r\n`],
    ['the marker as the first line, with text after it', `${MARKER}\nI opened generated-tests/x by mistake.\n`],
  ])('is true for %s', (_what, text) => {
    expect(isBlindCompromised(text)).toBe(true);
  });

  it.each([
    ['a behaviour row that quotes the marker', `# Expected behaviours\n| B-35 | finalize | must refuse a file marked \`${MARKER}\` | "q" | spec |\n`],
    ['prose that mentions the marker mid-line', `Finalize refuses a pass that says ${MARKER}.\n`],
    ['the marker on a later line only', `# Expected behaviours\n${MARKER}\n`],
    ['a longer first line that merely contains it', `${MARKER} is what a leak writes\n`],
    ['an empty file', ''],
    ['a normal blind pass', '# Expected behaviours\n| X-01 | a | b | "c" | d |\n'],
  ])('is false for %s', (_what, text) => {
    expect(isBlindCompromised(text)).toBe(false);
  });
});

describe('finalizeRunDir and the compromised marker', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'adv-compromised-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const run = (blind: string) => {
    const early = new Date('2026-10-15T10:00:00Z');
    const late = new Date('2026-10-15T10:10:00Z');
    writeFileSync(join(dir, 'expected-behaviours.md'), blind);
    utimesSync(join(dir, 'expected-behaviours.md'), early, early);
    writeFileSync(
      join(dir, 'review.raw.json'),
      JSON.stringify({ skill: 'adversarial-code-review', version: '0.5', model: 'm', scope: 's', needsDecision: [], findings: [], uncovered: [], discardedInstructions: [] })
    );
    utimesSync(join(dir, 'review.raw.json'), late, late);
    return finalizeRunDir(dir);
  };

  it('refuses a pass that is only the marker', () => {
    expect(() => run(`${MARKER}\n`)).toThrow(/compromised/);
  });

  it('accepts a pass that quotes the marker inside a behaviour row', () => {
    const blind = `# Expected behaviours\n| B-35 | finalize | must refuse a file marked \`${MARKER}\` | "q" | spec |\n`;
    expect(run(blind).verdict).toBe('PASS');
  });
});
