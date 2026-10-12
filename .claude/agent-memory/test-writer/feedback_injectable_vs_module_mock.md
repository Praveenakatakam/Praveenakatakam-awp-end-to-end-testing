---
name: injectable-vs-module-mock
description: When to use injectable fake repos vs vi.mock for module-level mocking
metadata:
  type: feedback
---

In this project, Lambda handlers and workers have two shapes:
- **Injectable** (e.g. `handlePostExperiment`, `runFunctionalJob`): repo + other deps are function args. Test with a plain fake object (`vi.fn()` methods). No vi.mock needed.
- **Module-bound** (e.g. `worker`, `handler`): uses `repository` at module scope. Test with `vi.mock('../src/repository.js', ...)` and `vi.mocked()`.

**Why:** The design deliberately separates testable business logic (injectable) from Lambda entrypoints (module-bound). The functional-gen.test.ts pattern (all injectable) is the ideal; use vi.mock only when the entrypoint itself is under test.

**How to apply:** Check whether the function under test receives the repo as an arg. If yes, use a fake object. If no (it imports `repository` from the module), use vi.mock.
