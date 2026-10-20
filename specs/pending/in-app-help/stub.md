# Requirement Stub — In-App Help System

> **Status:** Pending — not yet started
> **Captured:** 2026-10-20

## Idea
Add a help icon in the top-right corner of the SPA that opens a slide-over drawer with contextual help for the current page (what it does, what each control/section means, related concepts), plus a searchable catalog of all pages/help topics and quick-start guides for common workflows.

## Known Scope
- **UI placement:** Help icon goes top right in `AppShell.tsx` header bar (next to theme toggle and sign out)
- **Per-page help:** Contextual help tied to the current route — explains page purpose, controls/sections, related concepts (grounding, output types, plan schemas, experiments vs runs, legacy vs pipeline), links to related pages
- **Hook point:** Every page now uses a shared `PageHeader` component (`src/components/PageHeader.tsx`) with title + subtitle — natural place to define a per-page help key
- **Routes covered:**
  - Requirements Catalog area: Contracts by entity (`/source/contracts-by-entity`), Contracts by source (`/source/contracts-by-source`), Requirements (`/source/requirements`)
  - Experiments area: Experiments hub (`/experiments`), Pipelines (`/pipelines`, `/pipelines/:id`), Prompts (`/prompts`, `/prompts/:key`), Compare (`/compare`), Runs (`/runs`, `/runs/:runId`, `/runs/compare`)
  - Home (`/`) — `src/pages/HomePage.tsx` (spa-ux-redesign D-10): purpose, two-area diagram, quick start, key concepts. Its quick-start and concept text is a natural seed for the help catalog — avoid maintaining the same text twice.
- **Slide-over drawer:** A slide-in side panel showing help for the active route — likely right-side
- **Search + catalog:** Search box over all pages/help topics (client-side fuzzy search over a static index, no backend); catalog of all help entries
- **Quick-start guides:** E.g. "run your first experiment", "compare baseline vs a new prompt", "add a critique step", "import a legacy prompt version"

## Assumptions Made
- This is a pure SPA feature — no backend API changes needed
- Help content is scoped to the SPA UI and workflows, not deep system internals (those belong in `docs/` or `specs/docs/`)
- The drawer component doesn't exist yet — will need a new reusable component or third-party library (e.g. Radix UI Dialog/Sheet, Headless UI Transition)
- Search is client-side only (fuzzy match over titles/tags/keywords in a static index)

## Open Questions
- **Where does help content live?**
  - Option A: Static TypeScript/TSX files in `packages/web/src/help/` — co-located with the SPA, versioned with code
  - Option B: MDX files in `packages/web/src/help/` — allows richer formatting
  - Option C: Served from `docs/` or `specs/docs/` — shares content with human docs, but might blur the audience distinction per `CLAUDE.md` docs placement rule
- **Keeping content in sync:** How do we ensure every route has a help entry and help content stays current as features change?
  - Test coverage: a test that walks all routes in `AppRoutes.tsx` and asserts each has a help entry?
  - Lint/CI check for missing help entries?
  - Make help content part of the SDD close-out checklist?
- **Search implementation:** Client-side fuzzy search — what library? (Fuse.js? Flexsearch? roll our own simple match?)
- **Keyboard shortcut:** Should there be a keyboard shortcut to open help (e.g. `?` like GitHub, or `Cmd+/`)?
- **Accessibility:** Focus trap in the drawer, Esc to close, ARIA labels, keyboard navigation within help content
- **Mobile behaviour:** How does the drawer work on small screens — full-screen overlay? Bottom sheet?
- **Docs sharing:** Should help content be shared with the human docs (`README.md` / `docs/`) per the repo's docs placement rule in `CLAUDE.md`?
  - Human docs are overviews/guides/architecture explanations for developers working on the codebase
  - In-app help is UI/workflow guidance for SPA users (who may be testers, product owners, or devs using the tool)
  - Likely different audiences → separate content trees, but some overlap (e.g. "what is a pipeline?" might appear in both)

## Notes
- The SPA is React 18 + Vite + TanStack Query with HashRouter (`src/AppRoutes.tsx`)
- Current header bar is in `src/AppShell.tsx` (brand, theme toggle, sign out)
- Sidebar has two areas: **Requirements Catalog** and **Experiments**
- This depends on `spa-ux-redesign` (the two-area layout needs to be stable before adding help for each area) and `configurable-llm-pipeline` (help content will reference pipeline concepts like steps, models, prompts, cache keys)
- A homepage guide is already being added — help system should complement it (home = general intro, help icon = contextual per-page + search/catalog)
