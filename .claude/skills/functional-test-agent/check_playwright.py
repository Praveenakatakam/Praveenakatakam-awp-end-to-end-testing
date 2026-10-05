"""Prerequisite check for functional-test-agent: is Playwright importable, and is CDP reachable?"""
from pathlib import Path

OUT = Path(__file__).parent / "check_playwright_result.txt"
lines = []

try:
    import playwright.sync_api  # noqa: F401
    from importlib.metadata import version
    lines.append(f"playwright: INSTALLED {version('playwright')}")
except Exception as e:
    lines.append(f"playwright: MISSING ({e})")

try:
    from urllib.request import urlopen
    with urlopen("http://localhost:9222/json/version", timeout=3) as r:
        import json
        info = json.loads(r.read())
        lines.append(f"cdp: REACHABLE {info.get('Browser', '?')}")
except Exception as e:
    lines.append(f"cdp: UNREACHABLE ({e})")

OUT.write_text("\n".join(lines), encoding="utf-8")
