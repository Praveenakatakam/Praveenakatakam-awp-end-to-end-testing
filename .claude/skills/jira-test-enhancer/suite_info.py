"""Read-only structure dump of a test suite xlsx for jira-test-enhancer.

Usage:
    python suite_info.py "<path-to-xlsx>" [output.txt]

Prints (or writes to output.txt): sheet names, per-sheet max row/column,
header row, detected section title rows (bold merged rows / rows with only
column A populated), and the last TC ID matching common patterns
(CRA_*_Regr_NNN, TC-*-NNN).

Used by SKILL.md Steps 2 and 6 to get authoritative file state without
regenerating this code each run.
"""
import re
import sys
from pathlib import Path

from openpyxl import load_workbook

TC_PATTERNS = [
    re.compile(r"CRA_[A-Za-z0-9\-]+_Regr_(\d+)"),
    re.compile(r"TC-[A-Z]+-\d+-(\d+)"),
    re.compile(r"FT-(\d+)"),
]


def dump(path: Path) -> str:
    wb = load_workbook(path, read_only=False, data_only=True)
    lines = [f"File: {path}", f"Sheets: {' | '.join(wb.sheetnames)}", ""]

    for name in wb.sheetnames:
        ws = wb[name]
        lines.append(f"=== Sheet: {name} ===")
        lines.append(f"max_row={ws.max_row} max_col={ws.max_column}")

        header = [c.value for c in ws[1][: ws.max_column]]
        lines.append(f"row1: {header}")

        last_tc_num, last_tc_id, last_tc_row = -1, None, None
        section_rows = []
        for row in ws.iter_rows(min_row=1, max_row=ws.max_row):
            values = [c.value for c in row]
            non_empty = [v for v in values if v not in (None, "")]
            first = str(values[0]) if values and values[0] is not None else ""

            if len(non_empty) == 1 and first and not any(
                p.search(first) for p in TC_PATTERNS
            ):
                section_rows.append((row[0].row, first))

            for v in non_empty:
                for p in TC_PATTERNS:
                    m = p.search(str(v))
                    if m and int(m.group(1)) > last_tc_num:
                        last_tc_num = int(m.group(1))
                        last_tc_id = m.group(0)
                        last_tc_row = row[0].row

        if section_rows:
            lines.append("section-title rows (single-cell rows):")
            for r, title in section_rows:
                lines.append(f"  row {r}: {title}")
        if last_tc_id:
            lines.append(
                f"last TC: {last_tc_id} (row {last_tc_row}) -> next number = {last_tc_num + 1}"
            )
        else:
            lines.append("last TC: none matched known TC ID patterns")
        lines.append("")

    return "\n".join(lines)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    xlsx_path = Path(sys.argv[1])
    if not xlsx_path.exists():
        print(f"ERROR: file not found: {xlsx_path}")
        sys.exit(1)
    report = dump(xlsx_path)
    if len(sys.argv) > 2:
        out = Path(sys.argv[2])
        out.write_text(report, encoding="utf-8")
        print(f"written: {out}")
    else:
        print(report)
