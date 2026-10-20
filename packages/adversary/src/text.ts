/** Small text helpers shared by the file-level attacks. */

/** 1-based line number of a character index. */
export function lineOf(contents: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < contents.length; i++) if (contents[i] === '\n') line++;
  return line;
}

/** `file:line` for the first match of `re`, or just `file` when there is none. */
export function at(file: string, contents: string, re: RegExp): string {
  const m = re.exec(contents);
  return m ? `${file}:${lineOf(contents, m.index)}` : file;
}

/** ODCS logicalTypes whose JSON wire form is a string (mirrors the functest emitter). */
const STRING_WIRE_TYPES = new Set(['date', 'timestamp', 'time']);

export function wireType(logicalType: string | undefined): string {
  if (!logicalType) return '';
  return STRING_WIRE_TYPES.has(logicalType) ? 'string' : logicalType;
}

const SKIPPED_MARKUP = new Set(['`', '*']);
const STRAIGHT: Record<string, string> = { '‘': "'", '’': "'", '“': '"', '”': '"' };

/** Text with markdown code ticks and emphasis stripped, curly quotes straightened and whitespace runs collapsed; `map[i]` is the original index of `text[i]`. */
function normalized(s: string): { text: string; map: number[] } {
  const out: string[] = [];
  const map: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (SKIPPED_MARKUP.has(c)) continue;
    if (/\s/.test(c)) {
      if (out.length && out[out.length - 1] !== ' ') {
        out.push(' ');
        map.push(i);
      }
      continue;
    }
    out.push(STRAIGHT[c] ?? c);
    map.push(i);
  }
  return { text: out.join(''), map };
}

/**
 * Where a plan clause appears in the requirement text, tolerating formatting but not wording (R-133c):
 * markdown ticks/emphasis, line breaks and curly quotes do not count as differences; case and words do.
 * Returns the ORIGINAL start and length, so coverage checks keep using real offsets.
 */
export function locateClause(text: string, clause: string): { start: number; len: number } | undefined {
  const needle = normalized(clause).text.trim();
  if (!needle) return undefined;
  const hay = normalized(text);
  const at = hay.text.indexOf(needle);
  if (at < 0) return undefined;
  const start = hay.map[at];
  let end = hay.map[at + needle.length - 1] + 1;
  while (end < text.length && SKIPPED_MARKUP.has(text[end])) end++;
  return { start, len: end - start };
}
