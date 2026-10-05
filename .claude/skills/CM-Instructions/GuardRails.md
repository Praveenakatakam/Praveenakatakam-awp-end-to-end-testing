# CM Instructions – GuardRails

## CLAUDE.md (Global)

| Category | Rule |
|----------|------|
| Code style | No clever one-liners; readable, well-structured code only |
| Testing | No mocked data operations — use real sample data |
| Abstractions | No over-engineering; no unnecessary boilerplate |
| Cloud | Don't suggest cloud-specific solutions unless asked |
| Reproducibility | Set random seeds, document data sources, pin dependencies |

---

## CM-Instructions Skill

| Guardrail | Detail |
|-----------|--------|
| `claude-api` trigger | Only fires when code imports `anthropic`/`@anthropic-ai/sdk` or Anthropic-specific features |
| `claude-api` block | Must NOT trigger for `openai`, other providers, or provider-neutral code |
| `loop` | Must NOT be used for one-off tasks |
| Browser | Open Chrome to `mysat-qa` + consent widget — NOT a new browser instance |

---

## Per-Script (SPEC.md)

| Script | Key Guardrail |
|--------|--------------|
| `login.py` | Do NOT combine with `snapshot_figma.py` — kept as separate projects |
| `login.py` | Connect via CDP only — Playwright must NOT open its own browser |
| `content_validation.py` | Do NOT launch a new browser — reuse Chrome opened by `login.py` |
| `content_validation.py` | Output only to `Output\Results\` — no artifacts at `Output\` root |
| `validate_dynamo.py` | Use `table.query()` not `scan()` — faster and targeted |
| `validate_dynamo.py` | `Program` is a **post-query Python filter**, not part of the DynamoDB query |
| `validate_dynamo.py` | Table 2 uses `program_aliases` mapping (e.g. `SAT → {SAT, SAT_WEEKEND}`) |
| `validate_dynamo.py` | Table 2 has a 120s retry budget (15s poll interval) for reconciler lag |
| `setup_env.bat` | Stops on first failure (`|| goto :fail`) — no silent partial runs |
