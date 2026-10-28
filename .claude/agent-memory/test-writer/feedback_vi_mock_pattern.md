---
name: vi-mock-pattern
description: How vi.mock is used in this project for module-level mocking (repository, llm, functest)
metadata:
  type: feedback
---

Use `vi.mock('../src/repository.js', () => ({ repository: { method: vi.fn(), ... } }))` at the top of the test file. Import the mocked module AFTER the vi.mock call, then use `vi.mocked(repository.method).mockResolvedValue(...)` inside tests. Reset with `beforeEach(() => vi.clearAllMocks())`.

**Why:** Vitest hoists vi.mock calls — imports after vi.mock resolve to the mocked version. See `packages/functions/tests/prompt-versions.test.ts` for the canonical project example.

**How to apply:** Use this pattern whenever testing code that uses `repository` directly (non-injectable handlers, worker entrypoints). For injectable functions (like `handlePostExperiment`, `runFunctionalJob`), pass a fake repo object with `vi.fn()` methods instead — no vi.mock needed.
