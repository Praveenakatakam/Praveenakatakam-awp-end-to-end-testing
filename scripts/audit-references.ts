/**
 * Reference audit: finds citations that point at nothing.
 *
 *   npx tsx scripts/audit-references.ts reviews <run_dir> [<run_dir> …]
 *       For each finding / decision item in a run folder's review.raw.json: does the cited file exist,
 *       is the cited line inside it, does a quoted snippet really occur in the cited file, and does
 *       every rule id it names exist in the spec?
 *
 *   npx tsx scripts/audit-references.ts repo
 *       Scans source, docs and agent definitions for spec ids (R-, D-, E-, T-, OQ-, NFR-, AR-) that the
 *       spec never defines, and for file paths that do not exist.
 *
 * Exit code 1 when anything is unverified. Read-only: it never writes, and never invokes version control.
 * It checks that a reference EXISTS, not that the claim around it is true; a finding can cite a real line
 * and still be wrong, so a clean audit is necessary, not sufficient.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SPEC_DIR = join(ROOT, 'specs');
const SKIP_DIRS = new Set(['node_modules', '.git', '.sst', '.adversarial-review', 'adversarial-reports', '.build', 'cdk.out', 'dist']);

// A spec id, not the tail of a domain-prefixed requirement id such as CRE-R-24.
const ID = /(?<![A-Za-z0-9-])(?:R|D|E|T|OQ|NFR|AR|AC)-\d+[a-z]?(?![A-Za-z0-9])(?!\*(?!\*))/g;
const PATH = /(?<![A-Za-z0-9_./-])((?:packages|scripts|specs|docs|stacks|generated-tests|\.claude)\/[A-Za-z0-9_./@-]+\.(?:ts|mjs|md|json|yaml|yml|txt))(?::(\d+)(?:-(\d+))?)?/g;


function walk(dir: string, accept: (file: string) => boolean, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(join(dir, e.name), accept, out);
    } else if (accept(join(dir, e.name))) out.push(join(dir, e.name));
  }
  return out;
}

const read = (p: string) => readFileSync(p, 'utf8');
const rel = (p: string) => relative(ROOT, p).replace(/\\/g, '/');

/** Every id the specs mention anywhere. */
export function specIds(): Set<string> {
  const ids = new Set<string>();
  for (const f of walk(SPEC_DIR, (p) => p.endsWith('.md'))) for (const m of read(f).matchAll(ID)) ids.add(m[0]);
  // The AR-nn rules of the review skills live in the skill spec, not under specs/.
  const skillSpec = join(ROOT, '.claude', 'skills', 'adversarial-review-spec.md');
  if (existsSync(skillSpec)) for (const m of read(skillSpec).matchAll(ID)) ids.add(m[0]);
  return ids;
}

export function idsIn(text: string): string[] {
  return [...new Set([...text.matchAll(ID)].map((m) => m[0]))];
}

/** `path`, `path:12`, `path:12-30` references, with the line range when given. */
export function pathsIn(text: string): { path: string; from?: number; to?: number }[] {
  return [...text.matchAll(PATH)].map((m) => ({ path: m[1], from: m[2] ? Number(m[2]) : undefined, to: m[3] ? Number(m[3]) : undefined }));
}

/** Backtick- or double-quoted snippets long enough to be a real quotation. */
export function snippetsIn(text: string): string[] {
  const out = new Set<string>();
  // Pair the quotes first, then filter by length: filtering inside the pattern would let a short quoted
  // word hand its closing quote to the text after it and report the gap between two quotes as a snippet.
  for (const pattern of [/`([^`\n]*)`/g, /"([^"\n]*)"/g]) {
    for (const m of text.matchAll(pattern)) if (m[1].length >= 12 && m[1].length <= 160) out.add(m[1]);
  }
  return [...out];
}

const norm = (s: string) => s.replace(/\\"/g, '"').replace(/\s+/g, ' ').trim();

/**
 * hard: a reference to something that does not exist (no such file, line past the end, an id with no
 *       definition, quoted text found nowhere in the repo). This is the fabrication signal.
 * soft: the reference is real but imprecise (the quote exists, in a file the finding did not cite; an
 *       id is a sub-clause shorthand such as R-134d for clause (d) of R-134).
 */
export interface Issue {
  severity: 'hard' | 'soft';
  where: string;
  ref: string;
  problem: string;
}

/** An id is fine if defined; `R-134d` is soft when only `R-134` is (clause (d) of it); otherwise hard. */
function idIssue(where: string, id: string, known: Set<string>): Issue | undefined {
  if (known.has(id)) return undefined;
  const base = id.replace(/[a-z]$/, '');
  if (base !== id && known.has(base)) {
    return { severity: 'soft', where, ref: id, problem: `sub-clause shorthand: ${base} is defined, "${id}" is not written literally` };
  }
  return { severity: 'hard', where, ref: id, problem: 'rule id is not defined in specs/' };
}

/** A snippet is verified when it occurs, whitespace-normalised, in one of the given files. */
function findIn(snippet: string, files: string[]): string | undefined {
  const needle = norm(snippet);
  return files.find((f) => existsSync(f) && norm(read(f)).includes(needle));
}

let allTextCache: string[] | undefined;
// The audit and its own test are excluded: the test deliberately contains invented text, and a quote is
// never "found" just because the checker's fixtures mention it.
const allTextFiles = () =>
  (allTextCache ??= walk(ROOT, (p) => /\.(ts|mjs|md|json|yaml|yml)$/.test(p) && !p.endsWith('pnpm-lock.yaml') && !/audit-references(\.test)?\.ts$/.test(p)));

const short = (s: string) => (s.length > 70 ? `${s.slice(0, 67)}…` : s);

/** A quotation is checked piece by piece: `foo(…, bar)` is two claims, `foo(` and `bar)`. */
const fragments = (snippet: string) => snippet.split(/…|\.\.\./).map(norm).filter((f) => f.length >= 8);

export function checkEvidence(where: string, target: string, evidence: string, known: Set<string>): Issue[] {
  const issues: Issue[] = [];
  const cited = [...pathsIn(target), ...pathsIn(evidence)];
  const citedFiles: string[] = [];
  for (const c of cited) {
    const abs = join(ROOT, c.path);
    if (!existsSync(abs)) {
      issues.push({ severity: 'hard', where, ref: c.path, problem: 'file does not exist' });
      continue;
    }
    citedFiles.push(abs);
    if (c.from !== undefined) {
      const lines = read(abs).split('\n').length;
      if (c.from < 1 || c.from > lines || (c.to !== undefined && c.to > lines)) {
        issues.push({ severity: 'hard', where, ref: `${c.path}:${c.from}${c.to ? `-${c.to}` : ''}`, problem: `line out of range (file has ${lines} lines)` });
      }
    }
  }
  for (const id of idsIn(`${target} ${evidence}`)) {
    const issue = idIssue(where, id, known);
    if (issue) issues.push(issue);
  }
  for (const s of snippetsIn(evidence)) {
    // Tool output and counts, commands, and file paths are not quotations of code.
    if (/^[\d\s.,→:=+()-]+$/.test(s) || /^(?:ls|cat|grep|rg|git|npx|node)\s/.test(s) || pathsIn(s).length) continue;
    for (const piece of fragments(s)) {
      if (findIn(piece, citedFiles)) continue;
      const elsewhere = findIn(piece, allTextFiles());
      if (elsewhere) issues.push({ severity: 'soft', where, ref: short(piece), problem: `found in ${rel(elsewhere)}, not in the cited file(s)` });
      else issues.push({ severity: 'hard', where, ref: short(piece), problem: 'quoted text not found anywhere in the repo' });
    }
  }
  // The same path is usually named in both `target` and `evidence`: report each problem once.
  const seen = new Set<string>();
  return issues.filter((i) => {
    const key = `${i.severity}|${i.ref}|${i.problem}`;
    return seen.has(key) ? false : (seen.add(key), true);
  });
}

interface RawItem {
  target?: string;
  evidence?: string;
  item?: string;
  detail?: string;
}

export function auditRun(runDir: string, known: Set<string>): { checked: number; issues: Issue[] } {
  const rawPath = join(runDir, 'review.raw.json');
  if (!existsSync(rawPath)) throw new Error(`${rawPath} is missing`);
  const raw = JSON.parse(read(rawPath)) as { findings?: RawItem[]; needsDecision?: RawItem[]; covered?: { by?: string }[] };
  const issues: Issue[] = [];
  let checked = 0;
  (raw.findings ?? []).forEach((f, i) => {
    checked++;
    issues.push(...checkEvidence(`${rel(runDir)} finding #${i + 1}`, f.target ?? '', f.evidence ?? '', known));
  });
  (raw.needsDecision ?? []).forEach((d, i) => {
    checked++;
    issues.push(...checkEvidence(`${rel(runDir)} decision #${i + 1}`, '', `${d.detail ?? ''} ${d.evidence ?? ''}`, known));
  });
  (raw.covered ?? []).forEach((c, i) => {
    checked++;
    issues.push(...checkEvidence(`${rel(runDir)} covered #${i + 1}`, c.by ?? '', '', known));
  });
  return { checked, issues };
}

/** Ids and paths cited in source, docs and agent definitions that point at nothing. */
export function auditRepo(known: Set<string>): { files: number; issues: Issue[] } {
  const issues: Issue[] = [];
  const files = walk(ROOT, (p) => {
    const r = rel(p);
    if (!/\.(ts|mjs|md)$/.test(r)) return false;
    if (r.startsWith('specs/') || r.startsWith('generated-tests/') || r.includes('/__fixtures__/') || r.startsWith('docs/red-runs/')) return false;
    // These files contain deliberately fabricated references as test data.
    return !/audit-references(\.test)?\.ts$|finalize-audit-verify\.test\.ts$/.test(r);
  });
  for (const f of files) {
    const text = read(f);
    const where = rel(f);
    const isCode = /\.(ts|mjs)$/.test(where);
    const isTest = /(^|\/)tests?\//.test(where);
    for (const id of idsIn(text)) {
      // In a test, a bare `R-5` is fixture data (a requirement id invented for the case), not a spec reference.
      if (isTest && /^R-\d+$/.test(id)) continue;
      const issue = idIssue(where, id, known);
      if (issue) issues.push(issue);
    }
    for (const c of pathsIn(text)) {
      if (/YYYY|\{|\*|<|>/.test(c.path)) continue; // templates and globs, not references
      // Code about the crawler names the CRAWLED repos' files (`docs/spec.md`, `docs/contracts/…`), not ours.
      if (isCode && /^docs\/(?:spec|design|tasks|acceptance-criteria|compliance)\.md$|^docs\/contracts\//.test(c.path)) continue;
      // The README describes the same crawl: "each source's `docs/spec.md`" is the crawled repo's file.
      if (where === 'README.md' && c.path === 'docs/spec.md') continue;
      // A test's sample path (to exercise an exclusion glob) need not exist.
      if (isTest && c.path.startsWith('generated-tests/')) continue;
      if (!existsSync(join(ROOT, c.path))) issues.push({ severity: 'hard', where, ref: c.path, problem: 'file does not exist' });
    }
  }
  return { files: files.length, issues };
}

function report(title: string, issues: Issue[], note: string): void {
  const hard = issues.filter((i) => i.severity === 'hard');
  const soft = issues.length - hard.length;
  console.log(`${title}: ${hard.length ? `${hard.length} NOT FOUND` : 'no fabricated references'}${soft ? `, ${soft} imprecise` : ''} ${note}`);
  for (const i of [...hard, ...issues.filter((x) => x.severity === 'soft')]) console.log(`  - [${i.severity}] ${i.where}: ${i.ref} — ${i.problem}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [cmd, ...args] = process.argv.slice(2);
  const known = specIds();
  let bad = 0;
  if (cmd === 'reviews' && args.length) {
    for (const dir of args) {
      const r = auditRun(resolve(dir), known);
      bad += r.issues.filter((i) => i.severity === 'hard').length;
      report(rel(resolve(dir)), r.issues, `(${r.checked} items checked)`);
    }
  } else if (cmd === 'repo') {
    const r = auditRepo(known);
    bad += r.issues.filter((i) => i.severity === 'hard').length;
    report('repo', r.issues, `(${r.files} files scanned, ${known.size} spec ids known)`);
  } else {
    console.error('usage: audit-references.ts reviews <run_dir>… | repo');
    process.exit(2);
  }
  process.exit(bad ? 1 : 0);
}
