/**
 * EARS requirements parser (T-27 · R-102, R-103, R-104, D-46).
 *
 * Pure, offline logic (no AWS/network) that turns a source repo's `docs/spec.md`
 * markdown into structured requirement records — the requirements analogue of
 * the contract crawler's core. It reads only the bullets under the document's
 * "Functional Requirements (EARS)" section (`## 3. …`), so decision-log entries,
 * edge-case tables, and out-of-scope bullets are never mistaken for requirements.
 *
 * Each requirement is `- **R-nn** — <text>` (id may carry a sub-letter, e.g.
 * `R-17a`). The EARS type is derived from the leading keyword and the modality
 * from the first SHALL/SHOULD/MAY; a bullet with no modality is flagged
 * non-conforming but still cataloged (fault-isolating, mirrors R-21/D-27).
 */

export type EarsType = 'event' | 'unwanted' | 'state' | 'optional' | 'ubiquitous';
export type Modality = 'SHALL' | 'SHOULD' | 'MAY';

export interface ParsedRequirement {
  /** Requirement id, e.g. `R-17a`. */
  id: string;
  /** Full requirement text (trimmed; inline markdown preserved). */
  text: string;
  /** Enclosing `### 3.x` sub-heading title, including its "3.x" number (R-102). */
  section: string;
  /** EARS type derived from the leading keyword (R-103). */
  earsType: EarsType;
  /** First SHALL/SHOULD/MAY present, or null if none (R-104). */
  modality: Modality | null;
  /** True IFF a modality keyword is present (R-104). */
  earsConforming: boolean;
}

// Level-2 heading that opens the requirements section (e.g. "## 3. Functional Requirements (EARS)").
const REQ_SECTION_HEADING = /^##\s+(?:\d+\.?\s*)?Functional Requirements\b/i;
// Any other level-2 heading closes the section.
const L2_HEADING = /^##\s+\S/;
// Sub-headings (### … through ###### …) within the section become the current `section`.
// Capture greedily to end-of-line and trim in code: a lazy `(.+?)\s*$` tail lets the
// group and the trailing `\s*` overlap (`.` matches whitespace), which CodeQL flags as
// polynomial-time backtracking on uncontrolled input.
const SUB_HEADING = /^#{3,6}\s+(.+)$/;
// A requirement bullet: "- **R-nn** — text" (em-dash or hyphen separator).
const REQ_BULLET = /^[-*]\s+\*\*(R-\d+[a-z]?)\*\*\s*[—–-]\s*(.+)$/;

function deriveEarsType(text: string): EarsType {
  const m = /^(WHEN|IF|WHILE|WHERE)\b/.exec(text);
  if (!m) return 'ubiquitous';
  switch (m[1]) {
    case 'WHEN':
      return 'event';
    case 'IF':
      return 'unwanted';
    case 'WHILE':
      return 'state';
    default:
      return 'optional'; // WHERE
  }
}

function deriveModality(text: string): Modality | null {
  const m = /\b(SHALL|SHOULD|MAY)\b/.exec(text);
  return m ? (m[1] as Modality) : null;
}

/**
 * Parse the EARS requirements out of a `docs/spec.md` markdown string.
 * Returns requirements in document order; [] if there is no requirements section.
 */
export function parseRequirements(specMarkdown: string): ParsedRequirement[] {
  const lines = specMarkdown.split(/\r?\n/);
  const out: ParsedRequirement[] = [];

  let inSection = false;
  let currentSection = '';

  for (const line of lines) {
    if (!inSection) {
      if (REQ_SECTION_HEADING.test(line)) inSection = true;
      continue;
    }
    // A new level-2 heading ends the requirements section.
    if (L2_HEADING.test(line)) break;

    const sub = SUB_HEADING.exec(line);
    if (sub) {
      // Keep the full heading text incl. its "3.x" number (R-102).
      currentSection = sub[1].trim();
      continue;
    }

    const bullet = REQ_BULLET.exec(line);
    if (!bullet) continue;

    const [, id, rawText] = bullet;
    const text = rawText.trim();
    const modality = deriveModality(text);
    out.push({
      id,
      text,
      section: currentSection,
      earsType: deriveEarsType(text),
      modality,
      earsConforming: modality !== null,
    });
  }

  return out;
}

/** Read the document's declared `**Spec version:** X.Y.Z` marker, if present. */
export function extractSpecVersion(specMarkdown: string): string | undefined {
  const m = /\*\*Spec version:\*\*\s*([0-9]+\.[0-9]+\.[0-9]+)/.exec(specMarkdown);
  return m ? m[1] : undefined;
}
