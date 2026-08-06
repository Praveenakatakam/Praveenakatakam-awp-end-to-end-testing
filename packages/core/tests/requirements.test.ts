import { describe, it, expect } from 'vitest';
import { parseRequirements, extractSpecVersion } from '../src/requirements.js';

// A fixture that mirrors the companion repos' docs/spec.md shape: a
// "Functional Requirements (EARS)" section with `### 3.x` sub-headings and
// `**R-nn** …` bold-paragraph lines (keyword-led, ubiquitous, no-modality, sub-ids),
// plus content OUTSIDE the requirements section that must be ignored.
const SPEC = `# Example App — Specification

> **Status:** Draft · **Spec version:** 1.2.3 · **Owner:** someone

## 2. Out of Scope

**R-99** This bullet is not in the requirements section and MUST be ignored.

## 3. Functional Requirements (EARS)

> EARS keywords: WHEN / IF / WHILE / WHERE · SHALL / SHOULD / MAY.

### 3.1 Data Contract (ODCS)

**R-01** The system SHALL define one ODCS data contract that validates against the schema.
**R-04** Each property SHALL declare a logicalType, and SHOULD mark required fields.
**R-05** WHERE a property is enumerated, the contract SHALL express the allowed values.

### 3.2 API — Auth

**R-10** WHEN a client calls any protected endpoint, THE API SHALL require a valid token.
**R-11** IF a request presents no token, THE API SHALL respond 401 and SHALL NOT execute.
**R-12** WHILE a request is authenticated, THE API SHALL make the subject available.
**R-17a** WHERE a cursor is supplied, THE API SHALL page (sub-id requirement).
**R-20** Before returning any record, THE API validates it (no modality keyword here).

## 4. Non-Functional Requirements

**R-98** This one is after the section and MUST be ignored too.
`;

describe('parseRequirements (T-27 · R-102, R-103, R-104)', () => {
  const reqs = parseRequirements(SPEC);
  const byId = Object.fromEntries(reqs.map((r) => [r.id, r]));

  it('extracts only the requirements under the Functional Requirements section', () => {
    const ids = reqs.map((r) => r.id);
    expect(ids).toEqual(['R-01', 'R-04', 'R-05', 'R-10', 'R-11', 'R-12', 'R-17a', 'R-20']);
    expect(ids).not.toContain('R-99'); // Out of Scope
    expect(ids).not.toContain('R-98'); // Non-Functional
  });

  it('captures id, text, and enclosing section heading (numeric prefix kept)', () => {
    expect(byId['R-01'].text).toBe('The system SHALL define one ODCS data contract that validates against the schema.');
    expect(byId['R-01'].section).toBe('3.1 Data Contract (ODCS)');
    expect(byId['R-10'].section).toBe('3.2 API — Auth');
    expect(byId['R-17a'].id).toBe('R-17a'); // sub-id preserved
  });

  it('derives earsType from the leading keyword (WHEN/IF/WHILE/WHERE/none)', () => {
    expect(byId['R-10'].earsType).toBe('event'); // WHEN
    expect(byId['R-11'].earsType).toBe('unwanted'); // IF
    expect(byId['R-12'].earsType).toBe('state'); // WHILE
    expect(byId['R-05'].earsType).toBe('optional'); // WHERE
    expect(byId['R-01'].earsType).toBe('ubiquitous'); // "The system SHALL"
    expect(byId['R-20'].earsType).toBe('ubiquitous'); // "Before returning"
  });

  it('derives modality from the first SHALL/SHOULD/MAY (SHALL NOT counts as SHALL)', () => {
    expect(byId['R-01'].modality).toBe('SHALL');
    expect(byId['R-04'].modality).toBe('SHALL'); // first of SHALL, SHOULD
    expect(byId['R-11'].modality).toBe('SHALL'); // "SHALL respond … SHALL NOT"
  });

  it('flags a bullet with no modality keyword as non-conforming, but still catalogs it (R-104)', () => {
    expect(byId['R-20'].modality).toBeNull();
    expect(byId['R-20'].earsConforming).toBe(false);
    // everything with a modality is conforming
    for (const r of reqs.filter((x) => x.id !== 'R-20')) {
      expect(r.earsConforming, r.id).toBe(true);
    }
  });

  it('returns [] when there is no Functional Requirements section, or empty input', () => {
    expect(parseRequirements('# Doc\n\n## 1. Intro\n\n**R-01** orphan SHALL.')).toEqual([]);
    expect(parseRequirements('')).toEqual([]);
  });
});

describe('extractSpecVersion (T-27 · R-106)', () => {
  it('reads the declared Spec version marker', () => {
    expect(extractSpecVersion(SPEC)).toBe('1.2.3');
  });
  it('returns undefined when absent', () => {
    expect(extractSpecVersion('# Doc\n\nno version here')).toBeUndefined();
  });
});
