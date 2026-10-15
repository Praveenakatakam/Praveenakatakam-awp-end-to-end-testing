# Tasks — SPA UX Redesign

## Subagent Plan Summary

- **implementer**: Component extraction (SignIn, CrawlLog, RequirementsPage, ExperimentsPage), context providers (CrawlContext, ContractDataContext), page components (ByEntityPage, BySourcePage, Sidebar), AppShell integration, CSS replacement, and mobile collapse — all non-trivial multi-file changes
- **test-writer**: All paired T-nna test tasks — follows the existing `[web]` Vitest tier conventions and applies R-25 acceptance criteria
- **reviewer**: After Phase 4 (full routing integration) — highest risk phase for regression
- **none — trivial single-file edit**: T-05 (dependency install — package.json + lockfile only), T-14 (existing test selector fixes — two targeted find-and-replace changes in known lines)

---

## Phase 1 — Component extraction (no routing dependency)

Tasks T-01, T-02, T-03, T-04 are independent of each other and can run in parallel. Each is a pure extraction from App.tsx with no new dependencies.

### T-01 — Extract SignIn.tsx

**Goal:** Move the sign-in form and Cognito SRP submit handler out of App.tsx into `src/SignIn.tsx`, leaving App.tsx importing and rendering `<SignIn />`.
**Satisfies:** R-07 (existing content preserved), enabling decomposition
**Deps:** none
**Impacted areas:** `packages/web/src/App.tsx`, `packages/web/src/SignIn.tsx` (new)
**Validation:** `npm run test` in `packages/web/` passes; the sign-in form renders and the submit handler fires as before; App.tsx no longer contains inline sign-in JSX
**Subagent:** implementer
**Review checkpoint:** none — extraction is low-risk; review at end of Phase 1

---

### T-01a — Tests for T-01

**Goal:** Write tests for `SignIn.tsx` in isolation: renders the form, calls `onSignIn` prop on valid submit, shows error state when `error` prop is set.
**Satisfies:** R-07, R-25 (acceptance criterion: existing sub-section content unchanged)
**Deps:** T-01
**Impacted areas:** `packages/web/tests/SignIn.test.tsx` (new)
**Subagent:** test-writer

---

### T-02 — Extract CrawlLog.tsx

**Goal:** Move the crawl log display (elapsed time, summary, error message) out of App.tsx into `src/CrawlLog.tsx`; App.tsx imports and renders `<CrawlLog />` with the same props it previously passed inline.
**Satisfies:** R-07, R-10 (crawl state display preserved)
**Deps:** none
**Impacted areas:** `packages/web/src/App.tsx`, `packages/web/src/CrawlLog.tsx` (new)
**Validation:** `npm run test` passes; crawl log renders elapsed, summary, and error identically to before extraction
**Subagent:** implementer
**Review checkpoint:** none

---

### T-02a — Tests for T-02

**Goal:** Write tests for `CrawlLog.tsx`: renders elapsed time, renders summary fields, renders error string, renders nothing when all props are null/zero.
**Satisfies:** R-07, R-10
**Deps:** T-02
**Impacted areas:** `packages/web/tests/CrawlLog.test.tsx` (new)
**Subagent:** test-writer

---

### T-03 — Extract RequirementsPage.tsx

**Goal:** Move the EARS Requirements view content out of App.tsx into `src/pages/RequirementsPage.tsx`. This is a thin wrapper that renders the same JSX with the same props. App.tsx renders `<RequirementsPage />` in the existing tab-switching block.
**Satisfies:** R-07, R-08 (EARS Requirements as a navigable sub-section)
**Deps:** none
**Impacted areas:** `packages/web/src/App.tsx`, `packages/web/src/pages/RequirementsPage.tsx` (new)
**Validation:** `npm run test` passes; requirements view renders identically; no props are silently dropped
**Subagent:** implementer
**Review checkpoint:** none

---

### T-03a — Tests for T-03

**Goal:** Write tests for `RequirementsPage.tsx`: renders the requirements list, passes through its data props without transformation.
**Satisfies:** R-07, R-08
**Deps:** T-03
**Impacted areas:** `packages/web/tests/RequirementsPage.test.tsx` (new)
**Subagent:** test-writer

---

### T-04 — Extract ExperimentsPage.tsx

**Goal:** Move the experiments view (including existing `promptTab` state, experiments list, versions list, and all sub-view rendering) out of App.tsx into `src/pages/ExperimentsPage.tsx`. The component remains self-contained with its own state — child routes replace `promptTab` in a later phase. App.tsx renders `<ExperimentsPage />` in the existing tab-switching block.
**Satisfies:** R-07, R-12 (Experiments area sub-sections exist), R-13 (structure accommodates additional sub-sections)
**Deps:** none
**Impacted areas:** `packages/web/src/App.tsx`, `packages/web/src/pages/ExperimentsPage.tsx` (new)
**Validation:** `npm run test` passes; all three experiments sub-views (prompt versions, run, compare) render; promptTab switching works as before
**Subagent:** implementer
**Review checkpoint:** Pause after T-04a — all leaf extractions complete; confirm App.tsx is slimmer and tests green before adding routing

---

### T-04a — Tests for T-04

**Goal:** Write tests for `ExperimentsPage.tsx`: renders prompt-versions view by default, switches to run view on tab activation, switches to compare view on tab activation.
**Satisfies:** R-07, R-12
**Deps:** T-04
**Impacted areas:** `packages/web/tests/ExperimentsPage.test.tsx` (new)
**Subagent:** test-writer

---

## Phase 2 — Routing infrastructure

T-05 is a prerequisite for T-06 and T-07. T-06 and T-07 are independent of each other and can run in parallel after T-05.

### T-05 — Install routing and Radix UI dependencies (enabling)

**Goal:** Add `react-router-dom`, `@radix-ui/react-navigation-menu`, and `@radix-ui/react-collapsible` to `packages/web/package.json` and run `pnpm install` from the workspace root.
**Satisfies:** R-14 (routing library), R-19 (component library evaluation completed in design), R-20, R-21 — enabling task for all subsequent routing and Radix usage
**Deps:** none
**Impacted areas:** `packages/web/package.json`, `pnpm-lock.yaml`
**Validation:** `pnpm install` succeeds with no peer-dependency errors; `import { HashRouter } from 'react-router-dom'` and `import * as Nav from '@radix-ui/react-navigation-menu'` resolve without TypeScript errors; bundle size increase is below 50 KB gzipped ceiling (audit with `pnpm --filter web build` and check output)
**Subagent:** none — single package.json edit + lockfile update; no logic
**Review checkpoint:** none

---

### T-06 — Create CrawlContext.tsx

**Goal:** Create `src/contexts/CrawlContext.tsx` with `CrawlProvider` and `useCrawl` hook. Move crawl state (`crawlRunning`, `crawlElapsed`, `crawlSummary`, `crawlError`) and `runRefresh()` out of App.tsx into this context. `CrawlProvider` wraps the authenticated shell in AppShell (wired in Phase 4). The context shape must match the design spec interface exactly.
**Satisfies:** R-09, R-10 (Refresh action wired through context), R-11 (extensibility — crawl state decoupled from nav)
**Deps:** T-05
**Impacted areas:** `packages/web/src/contexts/CrawlContext.tsx` (new), `packages/web/src/App.tsx` (crawl state refs removed in Phase 4 AppShell task — this task creates the context only)
**Validation:** `useCrawl()` returns the correct shape; `CrawlProvider` renders its children; `runRefresh()` calls the same crawl API endpoint as the existing App.tsx code
**Subagent:** implementer
**Review checkpoint:** none

---

### T-06a — Tests for T-06

**Goal:** Write tests for `CrawlContext.tsx`: `useCrawl()` outside provider throws; `CrawlProvider` renders children; `runRefresh()` triggers a fetch call to the crawl endpoint; `crawlRunning` becomes true during the request and false after resolution; `crawlError` is set on failure.
**Satisfies:** R-09, R-10
**Deps:** T-06
**Impacted areas:** `packages/web/tests/CrawlContext.test.tsx` (new)
**Subagent:** test-writer

---

### T-07 — Create ContractDataContext.tsx

**Goal:** Create `src/contexts/ContractDataContext.tsx` with `ContractDataProvider` and `useContractData` hook. `ContractDataProvider` fetches `entries` and `groups` once on mount (the same API calls currently in App.tsx for the entity/source views) and exposes `{ entries, groups, loading, error, reload }`. `ContractDataProvider` is intended as the `element` for the `/source` parent route (renders `<Outlet />`), wired in Phase 4.
**Satisfies:** R-07 (data preserved), R-11 (extensibility — new source sub-sections inherit data automatically via context), D-4
**Deps:** T-05
**Impacted areas:** `packages/web/src/contexts/ContractDataContext.tsx` (new)
**Validation:** `useContractData()` outside provider throws; provider fetches once on mount; `reload()` re-fetches; `loading` and `error` states are set correctly
**Subagent:** implementer
**Review checkpoint:** none

---

### T-07a — Tests for T-07

**Goal:** Write tests for `ContractDataContext.tsx`: `useContractData()` outside provider throws; provider renders children; fetch is called once on mount; `reload()` triggers a second fetch; `error` state is set when fetch rejects; `loading` is true during fetch and false after.
**Satisfies:** R-07, R-11
**Deps:** T-07
**Impacted areas:** `packages/web/tests/ContractDataContext.test.tsx` (new)
**Subagent:** test-writer

---

## Phase 3 — Page components

Tasks T-08, T-09, T-10 are independent of each other and can run in parallel. All depend on Phase 2 (contexts and deps must exist).

### T-08 — Extract ByEntityPage.tsx

**Goal:** Create `src/pages/ByEntityPage.tsx`. Move `selected` and `diff` state and all entity table + detail panel JSX out of App.tsx. The page consumes `ContractDataContext` via `useContractData()` for `entries` and `groups` instead of receiving them as props.
**Satisfies:** R-07, R-08 (Contracts by entity sub-section), R-11 (extensibility via context)
**Deps:** T-07
**Impacted areas:** `packages/web/src/pages/ByEntityPage.tsx` (new), `packages/web/src/App.tsx`
**Validation:** `npm run test` passes; entity table renders with fixture data from context; selecting an entity shows the detail panel; `diff` state toggles correctly
**Subagent:** implementer
**Review checkpoint:** none

---

### T-08a — Tests for T-08

**Goal:** Write tests for `ByEntityPage.tsx`: renders entity table rows from context data; clicking a row shows the detail panel; `diff` toggle shows/hides diff view; loading state renders a loading indicator; error state renders the error alert.
**Satisfies:** R-07, R-08
**Deps:** T-08
**Impacted areas:** `packages/web/tests/ByEntityPage.test.tsx` (new)
**Subagent:** test-writer

---

### T-09 — Extract BySourcePage.tsx

**Goal:** Create `src/pages/BySourcePage.tsx`. Move `selected` state and source table + detail panel JSX out of App.tsx. The page consumes `ContractDataContext` via `useContractData()` for `entries` and `groups`.
**Satisfies:** R-07, R-08 (Contracts by source sub-section)
**Deps:** T-07
**Impacted areas:** `packages/web/src/pages/BySourcePage.tsx` (new), `packages/web/src/App.tsx`
**Validation:** `npm run test` passes; source table renders with fixture data from context; selecting a source row shows the detail panel
**Subagent:** implementer
**Review checkpoint:** none

---

### T-09a — Tests for T-09

**Goal:** Write tests for `BySourcePage.tsx`: renders source table rows from context data; selecting a row shows the detail panel; loading and error states render correctly.
**Satisfies:** R-07, R-08
**Deps:** T-09
**Impacted areas:** `packages/web/tests/BySourcePage.test.tsx` (new)
**Subagent:** test-writer

---

### T-10 — Create Sidebar.tsx

**Goal:** Create `src/Sidebar.tsx`. Render both `SidebarArea` groups (`data-area="source"` and `data-area="experiments"`) using Radix `NavigationMenu.Root` + `NavigationMenu.List` + `NavigationMenu.Link` wrapping React Router `NavLink` (via `asChild`). Use `useMatch` per nav item to set `data-active` and `aria-current="page"`. Render the Refresh action button in the Source Pipeline area header consuming `useCrawl()` from CrawlContext. Render `CrawlLog` beneath the Refresh button. The seven nav items match R-08 and R-12 exactly. Area group labels are wrapped in `<nav>` landmarks per R-24.
**Satisfies:** R-01, R-02, R-04, R-08, R-09, R-10, R-12, R-22, R-24, D-2, D-3
**Deps:** T-05, T-06
**Impacted areas:** `packages/web/src/Sidebar.tsx` (new)
**Validation:** `npm run test` passes; all seven nav links render; each link has `data-active` and `aria-current="page"` only when the route matches; Refresh button is present and calls `runRefresh()` on click; two `<nav>` landmarks are present
**Subagent:** implementer
**Review checkpoint:** Pause after T-10a — page component extraction complete; confirm all unit tests green before AppShell integration

---

### T-10a — Tests for T-10

**Goal:** Write tests for `Sidebar.tsx` using MemoryRouter: renders both area groups and all seven nav links; `aria-current="page"` is set only on the active route's link; Refresh button fires `runRefresh()` from a mocked CrawlContext; two `<nav>` elements are present in the DOM.
**Satisfies:** R-01, R-02, R-08, R-09, R-12, R-22, R-24, R-25 (partial — criteria a and c)
**Deps:** T-10
**Impacted areas:** `packages/web/tests/Sidebar.test.tsx` (new)
**Subagent:** test-writer

---

## Phase 4 — Integration

T-11 is sequential — it depends on all Phase 3 tasks and Phase 1 tasks. T-11a and T-14 can run in parallel after T-11.

### T-11 — Create AppShell.tsx, AppRoutes.tsx, and update App.tsx

**Goal:** Create two new files:
- `src/AppRoutes.tsx` — contains the `<Routes>` tree only (no router component): index → Navigate to `/source/contracts-by-entity`; `/source` parent → `ContractDataProvider` outlet; three source child routes; `/experiments` → `ExperimentsPage` outlet; three experiments child routes; `*` → Navigate to default. Also renders `<Sidebar />` and the `<Outlet />` main area. This is the component tests mount under `MemoryRouter`.
- `src/AppShell.tsx` — auth gate (`token`, `ready`), theme toggle, `CrawlProvider`, wraps `<AppRoutes />` in `<HashRouter>`. This is the production entry point.

Update `ExperimentsPage.tsx` to use `<Outlet />` and remove `promptTab` state — update `packages/web/tests/ExperimentsPage.test.tsx` to reflect the new sub-route structure (tests that exercised `promptTab` switching must be rewritten to assert on rendered child route content instead). Update `App.tsx` to re-export `AppShell` (or delete and update `main.tsx` import).
**Satisfies:** R-03, R-14, R-15, R-16, R-17, R-18 (HashRouter documented in D-1), R-25 (AppRoutes is the testable unit), D-1, D-4, D-5
**Deps:** T-01, T-02, T-03, T-04, T-06, T-07, T-08, T-09, T-10
**Impacted areas:** `packages/web/src/AppShell.tsx` (new), `packages/web/src/AppRoutes.tsx` (new), `packages/web/src/App.tsx`, `packages/web/src/pages/ExperimentsPage.tsx`, `packages/web/tests/ExperimentsPage.test.tsx` (rewrite promptTab tests), `packages/web/src/main.tsx` (if App.tsx is deleted)
**Validation:** `npm run test` passes including ExperimentsPage.test.tsx; `pnpm --filter web build` succeeds; loading `/#/` redirects to `/#/source/contracts-by-entity`; each of the seven sub-section routes renders its page component; `/#/unknown` redirects to default; browser back/forward transitions between visited sub-sections
**Subagent:** implementer
**Review checkpoint:** none — reviewer runs after T-11a and T-14 are complete (end of Phase 4)

---

### T-11a — Shell navigation tests (R-25 a–d)

**Goal:** Write `packages/web/tests/shell-navigation.test.tsx` covering R-25 acceptance criteria (a) through (d): both area groups and all seven nav items render; `aria-current="page"` is applied only to the active link; Refresh button is present and is a `<button>` not a link; unknown-route redirect lands on the default sub-section without a blank screen. Also cover deep-linking (direct render at `/experiments/prompt-versions` and `/source/ears-requirements` renders the correct view). Mount `<AppRoutes />` (not `AppShell`) under `MemoryRouter` with `initialEntries` prop — this avoids the nested-router crash (B-1 fix).
**Satisfies:** R-03, R-15, R-17, R-22, R-25 (criteria a–d)
**Deps:** T-11
**Impacted areas:** `packages/web/tests/shell-navigation.test.tsx` (new)
**Subagent:** test-writer

---

### T-14 — Fix existing test selectors for routing

**Goal:** Update `packages/web/tests/App.test.tsx` lines 218, 267, 289: change `getByRole('button', { name: ... })` to `getByRole('link', { name: ... })` for nav items that are now `<NavLink>` anchors. Wrap render calls with `MemoryRouter` from `react-router-dom`. Apply the same selector fix to `packages/web/tests/experiments.test.tsx` line 98.
**Satisfies:** R-25 (test suite must remain green), R-07 (content unchanged — tests must verify this)
**Deps:** T-11
**Impacted areas:** `packages/web/tests/App.test.tsx`, `packages/web/tests/experiments.test.tsx`
**Validation:** `npm run test` passes with no failures in App.test.tsx or experiments.test.tsx; no test logic is removed, only selectors updated
**Subagent:** none — targeted selector changes at known lines; no new test logic
**Review checkpoint:** Pause after T-11a and T-14 are both done — launch reviewer for pre-CSS adversarial check; all routing integration must be green before CSS shell changes

---

## Phase 5 — CSS and mobile

T-12 and T-13 are independent of each other and can run in parallel. Both depend on Phase 4 (Sidebar and AppShell class structure must be defined).

### T-12 — Replace shell layout CSS and add design tokens

**Goal:** In `packages/web/src/index.css`, replace the shell layout classes per the design spec: `.app-shell` becomes `display: flex; flex-direction: row`; add `.sidebar` for the left panel with `width: var(--sidebar-w)`; add `:root { --sidebar-w: 220px }` token; add `.sidebar-area[data-area="source"]` and `.sidebar-area[data-area="experiments"]` scoped accent variable blocks (`--area-accent`, `--area-accent-dim`) with the values from the design; add `.sidebar-nav-link` and Radix link active-state CSS targeting `[data-radix-navigation-menu-link][data-active]`. Remove or replace `.app-header`, `.app-nav`, `.app-nav-btn`, `--header-h`, `--nav-h`. Keep all component styles and design tokens unchanged (see the "Kept Unchanged" list in design.md).
**Satisfies:** R-04, R-07 (component CSS untouched), R-20, R-21, D-3
**Deps:** T-11 (class names and DOM structure defined by AppShell + Sidebar)
**Impacted areas:** `packages/web/src/index.css`
**Validation:** `pnpm --filter web build` succeeds; visual inspection in the dev server shows sidebar-left layout with correct accent colors per area; no existing component styles are broken; WCAG 4.5:1 contrast ratio verified for `#6c8ef8` and `#4ade80` against `--surface` in both light and dark themes (note: if either fails, substitute from existing palette and record in decisions log)
**Subagent:** implementer
**Review checkpoint:** none

---

### T-12a — Tests for shell CSS structure

**Goal:** Write tests verifying that the DOM structure emitted by AppShell + Sidebar carries the expected class names and `data-area` attributes that CSS rules target: `.sidebar` element is present; two `.sidebar-area` elements have `data-area="source"` and `data-area="experiments"`; `[data-radix-navigation-menu-link]` elements exist within each area.
**Satisfies:** R-04, R-20, R-21
**Deps:** T-12
**Impacted areas:** `packages/web/tests/shell-navigation.test.tsx` (appended — mobile section follows)
**Subagent:** test-writer

---

### T-13 — Mobile collapse: Collapsible + hamburger + overlay

**Goal:** Add mobile collapse behavior. Wrap the `<Sidebar />` in `AppShell` (or within `Sidebar` itself) with `Radix Collapsible.Root` controlled by a `sidebarOpen` state. Add a hamburger `<button>` visible only at `@media (max-width: 768px)` that toggles `sidebarOpen`. The sidebar is hidden at ≤768px when `sidebarOpen` is false. When open, render the sidebar as an overlay (CSS `position: fixed; z-index: ...`). Selecting any nav item calls the Radix `onOpenChange(false)` to dismiss the overlay. An outside-click handler (or focus trap escape via `Collapsible.Root onOpenChange`) also dismisses. Focus moves into the sidebar when it opens and returns to the hamburger button when it closes (R-23).
**Satisfies:** R-05, R-06, R-23, D-6 (collapsed state is not persisted — ephemeral only)
**Deps:** T-11, T-12 (CSS media query breakpoints and sidebar class names must exist)
**Impacted areas:** `packages/web/src/AppShell.tsx` or `packages/web/src/Sidebar.tsx` (whichever owns the Collapsible wrapper), `packages/web/src/index.css` (hamburger-btn and overlay rules)
**Validation:** `npm run test` passes including mobile tests; at `window.innerWidth = 375`, hamburger button is visible and sidebar is collapsed; activating hamburger opens sidebar overlay; selecting a nav link closes the overlay; pressing Esc or clicking outside closes the overlay; focus management follows R-23
**Subagent:** implementer
**Review checkpoint:** none

---

### T-13a — Mobile collapse tests (R-25 e–f)

**Goal:** Append mobile collapse tests to `packages/web/tests/shell-navigation.test.tsx` covering R-25 criteria (e) and (f): at `window.innerWidth = 375` the hamburger button is visible and sidebar content is hidden; activating the hamburger renders the full nav; selecting a sub-section closes the overlay and renders the correct page; outside-click or Esc closes the overlay without navigating. Use `userEvent` for interactions; set `window.innerWidth` and fire a `resize` event in `beforeEach`.
**Satisfies:** R-05, R-06, R-23, R-25 (criteria e–f)
**Deps:** T-13
**Impacted areas:** `packages/web/tests/shell-navigation.test.tsx` (appended)
**Subagent:** test-writer
**Review checkpoint:** Pause after T-13a — full implementation complete; launch reviewer for final post-implementation pattern check
