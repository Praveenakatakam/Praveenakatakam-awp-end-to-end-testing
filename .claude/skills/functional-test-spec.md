---
name: functional-test-spec
description: Shared reference spec for functional-test-agent and functional-test-runner — browser engine contract, script conventions, TC format, verification rules, and file-naming conventions. Not a workflow document; SKILL.md in each agent's folder defines the ordered steps and links here for the static reference material.
type: spec
---

# functional-test-spec

Single source of truth for the data formats, conventions, and static rules shared by `functional-test-agent` (generation) and `functional-test-runner` (execution). Neither agent's SKILL.md restates this content — they link here. If you are editing verification logic, script conventions, or the TC format, **edit only this file** — both agents pick it up automatically.

---

## 1. Browser engine & connection contract

- **Playwright (Python)**, attached to the user's already-running Chrome via `connect_over_cdp("http://localhost:9222")` — the same Chrome that `Chrome Scripts\start_chrome_final.bat` launches and that `login.py` authenticates. Real sessions and cookies carry over; no bundled Chromium.
- Scripts are written to disk, run via PowerShell, and their **file outputs** are read back (JSON state dumps, PNG screenshots). Scripts print nothing useful to stdout in this environment — **never rely on stdout**.

### Prerequisite checks (run before Step 1 of either agent's workflow)

1. `python -c "import playwright"` — if it fails, stop and ask the user to run `pip install playwright` manually. **Never auto-install.** (`playwright install` browser downloads are NOT needed — we attach to real Chrome, not a bundled one.)
2. If the input/output involves an `.xlsx` file, also verify `python -c "import openpyxl"` — same stop-and-ask rule if missing.
3. Probe CDP: `Invoke-WebRequest http://localhost:9222/json/version` (PowerShell). If unreachable:
   - Launch Chrome via `C:\Users\pkatakam\.claude\Chrome Scripts\start_chrome_final.bat`, wait 4 seconds, probe again.
   - If still unreachable after 2 attempts → stop and tell the user Chrome did not start with CDP enabled.

---

## 2. Script conventions

Both agents write and run Python Playwright scripts following this pattern:

- **Own tab per script / per TC.** Open a new page via `ctx.new_page()`, do the work, close it in a `finally` block. Never touch pages/tabs the script did not create — the user's own QA session tabs must be untouched.
- **Destructive-action blocklist**, enforced in every script that clicks:
  ```python
  BLOCKLIST = ["delete", "remove", "reset", "clear all", "logout", "sign out",
               "unsubscribe", "cancel subscription", "deactivate", "purge"]

  def safe_click(el):
      label = ((el.inner_text() or "") + " " + (el.get_attribute("aria-label") or "")).lower()
      if any(b in label for b in BLOCKLIST):
          raise SystemExit(f"BLOCKED: destructive label detected: {label!r}")
      el.click()
  ```
- **Auth detection**, run after every `goto`: if `page.url` differs in origin/path from the requested URL, or `page.locator("input[type=password]").count() > 0` → write `{"auth_required": true}` to a state file and exit. The invoking agent stops and tells the user to log in via `login.py`, then re-invoke. Never attempt to log in or enter credentials.
- **Console + network capture** (recommended): attach `page.on("console", ...)` and `page.on("request", ...)` handlers, dumped into the state/results JSON for diagnostics.
- **Standard viewports**: **1440×900** default for all observation and replay; **390×844** for Edge/narrow-viewport TCs specifically. Restore 1440×900 immediately after an Edge TC.

### Canonical script skeleton

```python
import json, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

OUT = Path(r"{output_dir}")
BLOCKLIST = ["delete", "remove", "reset", "clear all", "logout", "sign out",
             "unsubscribe", "cancel subscription", "deactivate", "purge"]

def safe_click(el):
    label = ((el.inner_text() or "") + " " + (el.get_attribute("aria-label") or "")).lower()
    if any(b in label for b in BLOCKLIST):
        raise SystemExit(f"BLOCKED: destructive label detected: {label!r}")
    el.click()

with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp("http://localhost:9222")
    ctx = browser.contexts[0]
    page = ctx.new_page()                      # own tab — never reuse existing pages
    try:
        page.set_viewport_size({"width": 1440, "height": 900})
        page.goto("{URL}", wait_until="networkidle", timeout=30000)
        # auth detection: if page.url mismatches or a password field is present, write
        # {"auth_required": true} to a state file and exit — do not proceed
        # ... generation (functional-test-agent) or verify_tc (functional-test-runner) logic ...
    finally:
        page.close()                           # always close own tab
```

`functional-test-agent` runs this **once per observation pass** (sequential blocks for multiple named elements). `functional-test-runner` runs it **once per TC**, inside a loop, aggregating results across all fresh pages.

---

## 3. TC format — canonical markdown (produced by functional-test-agent, consumed by functional-test-runner)

```markdown
### FT-{NNN} — {Short descriptive title}

| Field | Value |
|---|---|
| **URL** | {page URL} |
| **Page Version** | {version extracted from URL or meta, e.g. v5} |
| **Category** | Happy / Negative / Edge |
| **Priority** | P1 / P2 / P3 |
| **Element** | {element label / locator strategy} |
| **Trigger** | {user action: click / hover / scroll / type} |

**Preconditions**
- Page is loaded at {URL}
- {Any required state — e.g., "element is below the fold"}

**Steps**
1. Open new page and navigate to {URL} (viewport 1440×900)
2. Scroll to {element description}
3. {Perform action}
4. Observe result

**Expected Result**
- {Core keyword or element that must be present — not exact text}

**Observed Screenshots**
- Baseline: `screenshots\baseline_{timestamp}.png`
- Scroll position: `screenshots\{slug}_visible_{timestamp}.png`
- Post-action: `screenshots\{slug}_clicked_{timestamp}.png`

**Notes**
- {Dynamic content warnings, environment assumptions, known flaky indicators}
```

### TC category taxonomy (used by functional-test-agent when generating)

| Category | Count | What to test |
|---|---|---|
| **Happy P1** | One TC **per observable content piece** | Each distinct piece of content revealed by the interaction (photo, name, bio, tag, button) |
| **Scroll Visibility P1** | One TC per element | Element is not visible on load; scrolling brings it into viewport |
| **Negative P2** | One TC per interaction | Second click behavior (toggle off, collapse, dismiss) |
| **Edge P3** | One TC per interaction | Narrow viewport (390×844) or deep-scroll behavior |

### Alternate input formats (functional-test-runner only — for TC files not produced by functional-test-agent)

| Extension | Format | Parser | Notes |
|---|---|---|---|
| `.md` | Markdown (canonical, above) | Built-in markdown parser | First-class format |
| `.txt` | Plain-text, same sections without markdown decoration | Built-in text parser | Headers: `TC-ID:`, `Category:`, `Priority:`, `Element:`, `Trigger:`, `Preconditions:`, `Steps:`, `Expected Result:`. TCs separated by `---` or a blank-line gap. |
| `.xlsx` | Spreadsheet with recognized columns | `openpyxl` | Columns (case-insensitive header row): `TC ID`, `Title`, `Category`, `Priority`, `URL`, `Element`, `Trigger`, `Steps`, `Expected Result`, optional `Viewport`, `Notes` |

**Browser-testability validation** (functional-test-runner, before replay): every parsed TC must include at least one of a click/hover/scroll/type trigger on a named element, AND an expected result phrased as a DOM assertion (element visible, keyword present). TC files containing only API/DB/cross-team integration steps are refused — point the user to `jira-test-enhancer` or `jira-e2e-test-writer` instead. This is a hard refusal, not a best-effort attempt.

---

## 4. Verification rule (functional-test-runner enforces this; functional-test-agent should phrase Expected Results to be checkable by it)

**Element-presence + visibility + keyword match — never exact text comparison.**

- `page.get_by_text(keyword).count() > 0` **AND** the matched locator's `is_visible()` is `True`. Presence in the DOM alone is insufficient — a hidden/off-screen node can pass a bare `count() > 0` check while contradicting a screenshot.
- For viewport/Edge TCs specifically, also cross-check against `page.inner_text("body")` — a node absent from rendered body text is not visible to a user even if the locator resolves.
- Ignore timestamps, counters, and other dynamic decorators when matching keywords.

**Result classification:**
- **PASS**: element present, visible, and keyword found.
- **FAIL**: missing or not visible — save `screenshots\FAIL_{tc_id}_{timestamp}.png` + the discrepancy (expected keyword, actual nearby text, present-but-hidden if applicable).
- **FLAKY**: element present but content is dynamic — advisory only, not a blocking failure.

### Single-shot replay — no self-correcting re-runs

Replay executes **exactly once** per invocation. If a FAIL is later suspected to be caused by the replay script's own assertion logic (not a real page defect):
- Report the FAIL as originally recorded.
- Add a **Suspected Test-Instrumentation Issue** note explaining the suspected root cause and what a corrected assertion would check.
- Ask the user whether to apply the fix and re-run. Only re-run on explicit confirmation.
- A confirmed corrective re-run is a **separate, explicitly-requested run** — log it as its own RunHistory row, never a silent replacement of the original result.

*(Background: this rule exists because the first live run — IMI-9933, 2026-09-22 — silently re-ran two failing TCs after self-diagnosing an assertion bug, which risks masking a real regression as "just a test bug." Always surface, then ask.)*

---

## 5. Output file-type conventions

File *types* and naming patterns are shared; the *folder* each resolves into is agent-specific (see each agent's own SKILL.md — `functional-test-agent` always uses `skills\functional-test-agent\{hostname}\`; `functional-test-runner` resolves from the input TC file's parent folder, which can be anywhere in the user's profile).

| File type | Name pattern |
|---|---|
| TC file | `TestCases_{hostname}_{YYYYMMDD}.md` |
| Results file | `Results_{tc_basename}_{YYYYMMDDHHMMSS}.md` |
| Run history | `RunHistory.md` (one line appended per run) |
| Observation/replay scripts | `scripts\observe_*.py`, `scripts\replay_{YYYYMMDD}.py` |
| State/results JSON | `state_*.json`, `results_{timestamp}.json` |
| Baseline screenshot | `screenshots\baseline_{timestamp}.png` |
| Scroll-visible screenshot | `screenshots\{slug}_visible_{timestamp}.png` |
| Post-click screenshot | `screenshots\{slug}_clicked_{timestamp}.png` |
| Failure screenshot | `screenshots\FAIL_{tc_id}_{timestamp}.png` |

**Hostname derivation**: strip version suffix (`-v5`, `-v6`, etc.) and TLD decoration — e.g. `get-ready-jan30-prototype-v5.lovable.app` → `get-ready-jan30-prototype`. All versions of a site share one folder; version is tracked as metadata inside the files themselves, not the folder name.

**RunHistory row format:**
```
| {date time} | {Mode A auto / Mode B direct} | {page version} | {N} TCs | {pass} ✅ | {fail} ❌ | {flaky} ⚠️ | {results filename} |
```

---

## 6. Guardrails — not duplicated here

Each agent's guardrails are defined in **its own** agent definition file (`functional-test-agent.md` / `functional-test-runner.md`), which the harness always loads. This spec does not restate them — see each agent's SKILL.md for the one-line scope summary and pointer.
