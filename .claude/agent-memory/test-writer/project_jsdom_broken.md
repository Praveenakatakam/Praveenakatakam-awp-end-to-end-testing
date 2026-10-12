---
name: project-jsdom-broken
description: jsdom environment is broken in the web package tests due to an undici version mismatch; only node-environment tests run
metadata:
  type: project
---

The web package (`packages/web/`) has a pre-existing jsdom breakage:
- jsdom@29.1.1 requires `undici@^7.25.0`
- Monorepo only has `undici@6.27.0` installed
- Result: `Cannot find module 'undici/lib/handler/wrap-handler.js'` when any test file uses the jsdom environment

**Why:** Dependency version mismatch, pre-existing and not introduced by any feature branch. Noted explicitly in `packages/web/tests/api.test.ts` header comment.

**How to apply:** 
- Only `api.test.ts` (which uses `// @vitest-environment node`) actually runs in this repo.
- React component tests (`App.test.tsx`, `lib.test.ts`, `experiments.test.tsx`) are written correctly but can't execute until undici is updated to v7+.
- When writing new web tests that render React components, write them correctly for future use — they will pass once undici is updated — but note they're blocked by this environment issue.
- Do NOT add `// @vitest-environment node` to React component tests; they legitimately need jsdom/DOM.
