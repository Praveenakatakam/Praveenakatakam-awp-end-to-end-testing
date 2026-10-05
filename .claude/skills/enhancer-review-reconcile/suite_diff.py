"""Read-only before/after diff of a regression suite for enhancer-review-reconcile.

Supports both target formats used by jira-test-enhancer:
  * .xlsx  — the BST CRA Regression Suite layout (sheet "CRA Regression Suite")
  * .md    — markdown TC files with "## / ### TC-{TICKET}-{NNN} — title" blocks

Usage:
    python suite_diff.py "<before>" "<after>" [--summary change-summary.md] [--out diff.txt]

Mechanically checks R8 (file integrity) and R10 (change-summary accuracy) from
enhancer-review-spec.md, lists R4 near-duplicate candidates, and prints every
added / changed TC in full so the reviewer can judge R1-R7 and R9 without loading
the whole suite. Never writes to either suite file; only writes the --out file.
"""
import argparse
import difflib
import re
import sys
from pathlib import Path

NEAR_DUPLICATE_RATIO = 0.90
SUMMARY_LINE = re.compile(r"^\s*-\s*(ADDED|UPDATED):\s*(\S+)", re.IGNORECASE)
UPDATE_NOTICE = "[UPDATED by"

# ---------------------------------------------------------------- xlsx reader

XLSX_SHEET = "CRA Regression Suite"
XLSX_HEADERS = ["TC Name", "Scenario", "Stay in Regression", "Test Steps", "Expected Result"]
XLSX_HEADER_FILL = "D9E1F2"
# Any regression-style ID: CRA_*_Regr_NNN (active) or e.g. SATSDF25_Regr_NNN (archived).
XLSX_TC_ID = re.compile(r"^\s*((?:[A-Za-z0-9\-]+_)+Regr_(\d+))\s*$")
# All CRA_* IDs share ONE number sequence (CRA_Happypath_Regr_001 … CRA_TempcredsMR_Regr_137).
# Archived families reuse numbers (CRA_Cancel_Regr_006 and SATSDF25_Regr_006), so they are
# tracked for changes but kept out of the sequence check.
XLSX_ACTIVE = re.compile(r"^CRA_[A-Za-z0-9\-]+_Regr_")


def text_of(value) -> str:
    return "" if value is None else str(value).strip()


def read_xlsx(path: Path) -> dict:
    from openpyxl import load_workbook

    workbook = load_workbook(path, data_only=True)
    if XLSX_SHEET not in workbook.sheetnames:
        raise SystemExit(f"ERROR: sheet '{XLSX_SHEET}' not found in {path}")
    sheet = workbook[XLSX_SHEET]

    sections, tcs, other_content, format_problems = [], [], [], []
    current_section = None
    for row in sheet.iter_rows(min_row=1, max_row=sheet.max_row, max_col=len(XLSX_HEADERS)):
        values = [text_of(c.value) for c in row]
        non_empty = [v for v in values if v]
        row_number = row[0].row
        id_match = XLSX_TC_ID.match(values[0]) if values[0] else None

        if values == XLSX_HEADERS:
            styled = all(
                c.font is not None and c.font.bold
                and str(c.fill.fgColor.rgb or "").upper().endswith(XLSX_HEADER_FILL)
                for c in row
            )
            if not styled:
                format_problems.append(
                    (current_section, f"HEADER ROW not styled (bold + {XLSX_HEADER_FILL} fill) at row {row_number}")
                )
        elif id_match:
            tc_id = id_match.group(1)
            active = bool(XLSX_ACTIVE.match(tc_id))
            cells = dict(zip(XLSX_HEADERS[1:], values[1:]))
            tcs.append({
                "id": tc_id,
                "number": int(id_match.group(2)),
                "family": "CRA_*_Regr_" if active else None,
                "location": f"row {row_number}",
                "section": current_section,
                "fields": cells,
                "content": normalise(" ".join(cells[k] for k in ("Scenario", "Test Steps", "Expected Result"))),
                "dedupe_key": None,
            })
        elif len(non_empty) == 1 and values[0]:
            current_section = values[0]
            sections.append(values[0])
        elif non_empty:
            other_content.append(" | ".join(values))

    return {
        "format": "xlsx",
        "size": f"max_row={sheet.max_row}",
        "sections": sections,
        "tcs": tcs,
        "other_content": other_content,
        "format_problems": format_problems,
        "index_ids": None,
        "other_sheets": {
            name: [[text_of(c.value) for c in r] for r in workbook[name].iter_rows()]
            for name in workbook.sheetnames if name != XLSX_SHEET
        },
    }


# ------------------------------------------------------------------ md reader

MD_HEADING = re.compile(r"^(#{1,6})\s+(.*?)\s*$")
MD_TC_HEADING = re.compile(r"^(TC-[A-Za-z]+-\d+-)(\d+)\b\s*[—–-]?\s*(.*)$")
MD_INDEX_ROW = re.compile(r"^\|\s*(TC-[A-Za-z]+-\d+-\d+)\s*\|")
# Field lines in any of the three styles in use:
#   | **Category** | Happy |      - **Category:** Happy      - **Category**: Happy
MD_FIELD = re.compile(r"^\s*(?:\|\s*\*\*([^*]+?)\*\*\s*\|\s*(.*?)\s*\|?\s*$|-\s*\*\*([^*]+?):?\*\*:?\s*(.*)$)")


def read_md(path: Path) -> dict:
    lines = path.read_text(encoding="utf-8").splitlines()
    sections, tcs, other_content = [], [], []
    tc_heading_levels = []
    index_ids = []
    current_section = None
    current_tc = None

    def close_tc():
        if current_tc is None:
            return
        body = current_tc.pop("body")
        fields = {}
        for line in body:
            m = MD_FIELD.match(line)
            if m:
                name = (m.group(1) or m.group(3) or "").strip().rstrip(":")
                value = (m.group(2) if m.group(1) else m.group(4)) or ""
                fields.setdefault(name, value.strip())
        fields["Title"] = current_tc["title"]
        fields["Body"] = "\n".join(body).strip()
        jira_ref, source = fields.get("Jira Ref"), fields.get("Source")
        current_tc["fields"] = fields
        current_tc["content"] = normalise(fields["Body"])
        current_tc["dedupe_key"] = (normalise(jira_ref), normalise(source)) if jira_ref and source else None
        tcs.append(current_tc)

    for line_number, line in enumerate(lines, start=1):
        heading = MD_HEADING.match(line)
        if heading:
            level, text = len(heading.group(1)), heading.group(2)
            tc_match = MD_TC_HEADING.match(text)
            if tc_match:
                close_tc()
                tc_heading_levels.append((tc_match.group(1) + tc_match.group(2), level, line_number))
                current_tc = {
                    "id": tc_match.group(1) + tc_match.group(2),
                    "number": int(tc_match.group(2)),
                    "family": tc_match.group(1),
                    "location": f"line {line_number}",
                    "section": current_section,
                    "title": tc_match.group(3).strip(),
                    "level": level,
                    "body": [],
                }
                continue
            # A heading at the same or higher level than the open TC ends it.
            if current_tc is not None and level <= current_tc["level"]:
                close_tc()
                current_tc = None
            if current_tc is None:
                current_section = text
                sections.append(text)
                continue

        if current_tc is not None:
            current_tc["body"].append(line)
            continue

        index_row = MD_INDEX_ROW.match(line)
        if index_row:
            index_ids.append(index_row.group(1))
        elif line.strip() and not re.fullmatch(r"[-|\s:]+", line.strip()):
            other_content.append(line.strip())
    close_tc()

    return {
        "format": "md",
        "size": f"lines={len(lines)}",
        "sections": sections,
        "tcs": tcs,
        "other_content": other_content,
        "format_problems": [],
        "index_ids": index_ids if index_ids else None,
        "tc_heading_levels": tc_heading_levels,
        "other_sheets": {},
    }


# ------------------------------------------------------------- shared checks

def normalise(text) -> str:
    return re.sub(r"\s+", " ", text or "").strip().lower()


def read_suite(path: Path) -> dict:
    suffix = path.suffix.lower()
    if suffix == ".xlsx":
        return read_xlsx(path)
    if suffix == ".md":
        return read_md(path)
    raise SystemExit(f"ERROR: unsupported suite format '{suffix}' (expected .xlsx or .md): {path}")


def parse_summary(path: Path):
    added, updated = set(), set()
    for line in path.read_text(encoding="utf-8").splitlines():
        m = SUMMARY_LINE.match(line)
        if m:
            (added if m.group(1).upper() == "ADDED" else updated).add(m.group(2).rstrip(".,;:"))
    return added, updated


def check_integrity(before: dict, after: dict, added: list, removed: list, after_ids: list) -> tuple:
    """R8: returns (failures, warnings)."""
    failures, warnings = [], []
    before_by_id = {tc["id"]: tc for tc in before["tcs"]}
    after_by_id = {tc["id"]: tc for tc in after["tcs"]}

    for tc in removed:
        failures.append(f"REMOVED existing TC {tc['id']} (was {tc['location']})")

    before_order = [tc["id"] for tc in before["tcs"] if tc["id"] in after_by_id]
    after_order = [i for i in after_ids if i in before_by_id]
    for position, (was, now) in enumerate(zip(before_order, after_order)):
        if was != now:
            failures.append(f"REORDERED existing TCs: expected {was} at position {position + 1}, found {now}")
            break

    seen = set()
    for tc_id in after_ids:
        if tc_id in seen:
            failures.append(f"DUPLICATE TC ID {tc_id}")
        seen.add(tc_id)

    # New numbers continue each family's sequence; a family new to the file starts at 1.
    families = {tc["family"] for tc in added if tc["family"]}
    for family in sorted(families):
        before_max = max((tc["number"] for tc in before["tcs"] if tc["family"] == family), default=0)
        new_numbers = sorted(tc["number"] for tc in added if tc["family"] == family)
        expected = list(range(before_max + 1, before_max + 1 + len(new_numbers)))
        if new_numbers != expected:
            failures.append(f"NON-SEQUENTIAL new TC numbers for {family}: expected {expected}, found {new_numbers}")
    for tc in added:
        if tc["family"] is None:
            failures.append(f"NEW TC uses an archived ID family: {tc['id']} ({tc['location']})")

    for title in before["sections"]:
        if title not in after["sections"]:
            failures.append(f"SECTION removed or renamed: '{title}'")
    new_sections = [s for s in after["sections"] if s not in before["sections"]]

    # Format of new entries.
    if after["format"] == "xlsx":
        for section, problem in after["format_problems"]:
            if section in new_sections:
                failures.append(problem)
    else:
        existing_levels = {lvl for tc_id, lvl, _ in before.get("tc_heading_levels", []) if tc_id in before_by_id}
        added_ids = {tc["id"] for tc in added}
        if existing_levels:
            for tc_id, level, line in after.get("tc_heading_levels", []):
                if tc_id in added_ids and level not in existing_levels:
                    failures.append(
                        f"HEADING LEVEL of new TC {tc_id} (line {line}) is {'#' * level}; existing TCs use "
                        + "/".join("#" * l for l in sorted(existing_levels))
                    )
        if before["index_ids"] is not None:
            index_after = set(after["index_ids"] or [])
            for tc in added:
                if tc["id"] not in index_after:
                    failures.append(f"INDEX missing a row for new TC {tc['id']}")
            for tc_id in before["index_ids"]:
                if tc_id not in index_after:
                    failures.append(f"INDEX row removed for existing TC {tc_id}")

    # Content outside TCs: xlsx rows must not change; md lines may change only in the
    # metadata header the enhancer is allowed to update, so the reviewer judges them.
    changed_other = [c for c in before["other_content"] if c not in after["other_content"]]
    for text in changed_other:
        if after["format"] == "xlsx":
            failures.append(f"NON-TC ROW changed or removed: {text[:120]}")
        else:
            warnings.append(f"NON-TC LINE changed or removed (reviewer: allowed metadata update?): {text[:120]}")
    # Additions outside TCs aren't integrity failures by themselves, but the reviewer
    # must see them (R1 traceability; md: is there an UPDATED-HEADER line for it?).
    added_other = [c for c in after["other_content"] if c not in before["other_content"]]
    for text in added_other:
        kind = "ROW" if after["format"] == "xlsx" else "LINE"
        warnings.append(f"NON-TC {kind} added (reviewer: traceable / declared?): {text[:120]}")

    return failures, warnings, new_sections


def find_duplicates(before: dict, added: list) -> list:
    candidates = []
    existing = before["tcs"]
    seen_pairs = set()
    for tc in added:
        for other in existing + [t for t in added if t is not tc]:
            pair = frozenset((tc["id"], other["id"]))
            if pair in seen_pairs:
                continue
            seen_pairs.add(pair)
            if tc["dedupe_key"] and tc["dedupe_key"] == other.get("dedupe_key"):
                candidates.append(f"{tc['id']} = {other['id']} (same Jira Ref + Source)")
                continue
            ratio = difflib.SequenceMatcher(None, tc["content"], other["content"]).ratio()
            if ratio >= NEAR_DUPLICATE_RATIO:
                candidates.append(f"{tc['id']} ~ {other['id']} (similarity {ratio:.2f})")
    return sorted(set(candidates))


def format_tc(tc: dict) -> list:
    lines = [f"  [{tc['id']}] {tc['location']} | section: {tc['section']}"]
    for key, value in tc["fields"].items():
        if key == "Body":
            continue
        lines.append(f"    {key}: {value}")
    if "Body" in tc["fields"]:
        lines.append("    Body:")
        lines += [f"      {l}" for l in tc["fields"]["Body"].splitlines()]
    return lines


def format_change(old: dict, new: dict) -> list:
    notice = "yes" if any(UPDATE_NOTICE in v for v in new["fields"].values()) else "NO"
    lines = [f"  [{new['id']}] {old['location']} → {new['location']} | {UPDATE_NOTICE} …] notice present: {notice}"]
    for key in new["fields"]:
        before_value, after_value = old["fields"].get(key, ""), new["fields"].get(key, "")
        if before_value == after_value:
            continue
        if key == "Body":
            diff = difflib.unified_diff(before_value.splitlines(), after_value.splitlines(), lineterm="", n=1)
            lines.append("    Body diff:")
            lines += [f"      {l}" for l in list(diff)[2:]]
        else:
            lines.append(f"    {key} BEFORE: {before_value}")
            lines.append(f"    {key} AFTER:  {after_value}")
    return lines


def build_report(before_path: Path, after_path: Path, summary_path) -> str:
    if before_path.suffix.lower() != after_path.suffix.lower():
        raise SystemExit("ERROR: before and after files must be the same format")
    before, after = read_suite(before_path), read_suite(after_path)

    before_by_id = {tc["id"]: tc for tc in before["tcs"]}
    after_by_id = {tc["id"]: tc for tc in after["tcs"]}
    after_ids = [tc["id"] for tc in after["tcs"]]
    added = [tc for tc in after["tcs"] if tc["id"] not in before_by_id]
    removed = [tc for tc in before["tcs"] if tc["id"] not in after_by_id]
    changed = [
        (before_by_id[tc["id"]], tc) for tc in after["tcs"]
        if tc["id"] in before_by_id and tc["fields"] != before_by_id[tc["id"]]["fields"]
    ]

    r8_failures, r8_warnings, new_sections = check_integrity(before, after, added, removed, after_ids)
    duplicates = find_duplicates(before, added)

    r10_lines = []
    if summary_path is None:
        r10_result = "NOT CHECKED (no --summary given)"
    else:
        claimed_added, claimed_updated = parse_summary(summary_path)
        if not claimed_added and not claimed_updated:
            r10_result = "NOT MACHINE-CHECKABLE (no '- ADDED:' / '- UPDATED:' lines found) — reviewer must check manually"
        else:
            actual_added = {tc["id"] for tc in added}
            actual_changed = {tc["id"] for _, tc in changed}
            for label, ids in [
                ("claimed ADDED but not added", claimed_added - actual_added),
                ("added but not claimed", actual_added - claimed_added),
                ("claimed UPDATED but unchanged", claimed_updated - actual_changed),
                ("changed but not claimed", actual_changed - claimed_updated),
            ]:
                if ids:
                    r10_lines.append(f"{label}: {', '.join(sorted(ids))}")
            r10_result = "FAIL" if r10_lines else "PASS"

    other_sheets = []
    for name in sorted(set(before["other_sheets"]) | set(after["other_sheets"])):
        rows_before, rows_after = before["other_sheets"].get(name), after["other_sheets"].get(name)
        if rows_before is None or rows_after is None:
            other_sheets.append(f"  {name}: sheet {'added' if rows_before is None else 'REMOVED'}")
        elif rows_before != rows_after:
            other_sheets.append(f"  {name}: changed ({len(rows_before)} → {len(rows_after)} rows)")

    lines = [
        "# suite_diff report",
        f"format: {after['format']}",
        f"before: {before_path}",
        f"after:  {after_path}",
        f"summary: {summary_path or 'none'}",
        "",
        "## Totals",
        f"before: {before['size']}, TCs={len(before['tcs'])}",
        f"after:  {after['size']}, TCs={len(after['tcs'])}",
        f"added={len(added)} changed={len(changed)} removed={len(removed)} new sections={len(new_sections)}",
        "",
        f"## R8 file integrity: {'FAIL' if r8_failures else 'PASS'}",
        *([f"- {f}" for f in r8_failures] or ["- no integrity problems found"]),
    ]
    if r8_warnings:
        lines += ["", "## R8 warnings (reviewer must judge)", *[f"- {w}" for w in r8_warnings]]
    lines += [
        "",
        f"## R10 change-summary accuracy: {r10_result}",
        *[f"- {l}" for l in r10_lines],
        "",
        "## R4 duplicate candidates (reviewer must confirm)",
        *([f"- {d}" for d in duplicates] or ["- none"]),
        "",
        "## New sections",
        *([f"- {s}" for s in new_sections] or ["- none"]),
        "",
        "## Added TCs (full text)",
    ]
    for tc in added:
        lines += format_tc(tc)
    if not added:
        lines.append("  none")
    lines += ["", "## Changed TCs (before → after)"]
    for old, new in changed:
        lines += format_change(old, new)
    if not changed:
        lines.append("  none")
    if after["format"] == "xlsx":
        lines += ["", "## Other sheets", *(other_sheets or ["  no changes"])]
    return "\n".join(lines)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("before", type=Path)
    parser.add_argument("after", type=Path)
    parser.add_argument("--summary", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()

    for p in (args.before, args.after, args.summary):
        if p is not None and not p.exists():
            sys.exit(f"ERROR: file not found: {p}")

    report = build_report(args.before, args.after, args.summary)
    # The Windows console defaults to cp1252, which can't print arrows or curly quotes.
    sys.stdout.reconfigure(encoding="utf-8")
    if args.out:
        args.out.write_text(report, encoding="utf-8")
        print(f"written: {args.out}")
    else:
        print(report)
