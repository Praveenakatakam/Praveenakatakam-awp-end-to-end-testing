# Design — SPA UX Redesign

> **Version:** 0.1.0
> **Status:** Draft

## Summary

The redesign replaces the current flat four-tab strip in `App.tsx` with a sidebar-left shell that groups navigation into two named areas — **Source Pipeline** and **Experiments** — each with a distinct accent color. React Router v7 (`react-router-dom`) replaces `useState`-based navigation with URL-addressable routes. The 804-line `App.tsx` monolith is decomposed into eight-plus focused files. Radix UI Primitives (`NavigationMenu`, `Collapsible`) supply keyboard navigation and ARIA without replacing the existing CSS custom-property theming system.

---

## Existing Patterns to Follow

- `specs/docs/system-design/architecture.md` — package layout, Lambda/SPA boundary, where business logic lives vs. handler
- `specs/docs/sdd/README.md` — SDD decisions log conventions
- `packages/web/src/App.tsx` — existing auth gate pattern (`token`, `ready`), crawl trigger, theme toggle; these are preserved in `AppShell`
- `packages/web/tests/App.test.tsx` — existing `[web]` tier test conventions; new tests follow this pattern
- `packages/web/vitest.config.ts` — test tier configuration; new tests run under the existing `[web]` tier

---

## Areas Impacted

- `packages/web/src/App.tsx` — decomposed; shell state remains, page state moves out
- `packages/web/src/` — eight new component and context files created
- `packages/web/src/styles.css` — shell layout CSS replaced; component CSS untouched; new tokens added
- `packages/web/tests/` — existing navigation tests updated; new `shell-navigation.test.tsx` added
- `packages/web/package.json` — two new production dependencies (`react-router-dom`, `@radix-ui/react-navigation-menu`, `@radix-ui/react-collapsible`)
- `stacks/` — no changes required; HashRouter eliminates any CloudFront routing dependency for this feature

---

## Architecture

### Component Tree

```
AppShell                          packages/web/src/AppShell.tsx
  ├── SignIn                      packages/web/src/SignIn.tsx
  └── (authenticated)
        ├── Sidebar               packages/web/src/Sidebar.tsx
        │     ├── SidebarArea[data-area="source"]
        │     │     ├── nav items (Contracts by entity, Contracts by source, EARS Requirements)
        │     │     └── Refresh action button + CrawlStatusBadge
        │     └── SidebarArea[data-area="experiments"]
        │           └── nav items (Prompt versions, Run experiments, Compare results)
        └── MainArea              (implicit — HashRouter <Outlet> target)
              ├── /source/contracts-by-entity   → ByEntityPage.tsx
              ├── /source/contracts-by-source   → BySourcePage.tsx
              ├── /source/ears-requirements     → RequirementsPage.tsx
              ├── /experiments/prompt-versions  → ExperimentsPage.tsx (sub-route)
              ├── /experiments/run              → ExperimentsPage.tsx (sub-route)
              ├── /experiments/compare          → ExperimentsPage.tsx (sub-route)
              └── *                             → <Navigate to default>
```

### File Map

| File | Role |
|---|---|
| `src/AppShell.tsx` | Auth gate, theme toggle, `CrawlProvider`, wraps `<AppRoutes />` in `<HashRouter>` — production entry point only |
| `src/AppRoutes.tsx` | `<Routes>` tree + `<Sidebar />` + `<Outlet>` — no router component; mounted under `MemoryRouter` in tests |
| `src/Sidebar.tsx` | Nav items for both areas, Refresh button, crawl status badge; consumes `CrawlContext` |
| `src/contexts/ContractDataContext.tsx` | Provides `entries`, `groups` to `/source/*` routes; fetches once on mount |
| `src/contexts/CrawlContext.tsx` | Provides `crawlRunning`, `crawlElapsed`, `crawlSummary`, `crawlError`, `runRefresh()` |
| `src/pages/ByEntityPage.tsx` | Owns `selected`, `diff`; renders existing entity table + detail panel |
| `src/pages/BySourcePage.tsx` | Owns `selected`; consumes `ContractDataContext`; renders existing source table + detail panel |
| `src/pages/RequirementsPage.tsx` | Thin wrapper re-exporting `RequirementsView` content |
| `src/pages/ExperimentsPage.tsx` | Layout component for `/experiments/*`; owns experiments list + versions list; child routes replace `promptTab` state |
| `src/SignIn.tsx` | Extracted from `App.tsx` |
| `src/CrawlLog.tsx` | Extracted from `App.tsx` |

---

## Routing Configuration

### URL Shape

```
/#/                                        → <Navigate to="#/source/contracts-by-entity" />
/#/source/contracts-by-entity             → ByEntityPage
/#/source/contracts-by-source             → BySourcePage
/#/source/requirements                    → RequirementsPage
/#/experiments/prompt-versions            → ExperimentsPage (promptTab equivalent: 'prompts')
/#/experiments/run                        → ExperimentsPage (promptTab equivalent: 'experiments')
/#/experiments/compare                    → ExperimentsPage (compare sub-view)
*                                         → <Navigate to="#/source/contracts-by-entity" />
```

### Route Tree (JSX sketch — not implementation)

```tsx
// AppShell.tsx — production entry point
<HashRouter>
  <AppRoutes />
</HashRouter>

// AppRoutes.tsx — testable unit; tests mount this under MemoryRouter
<Routes>
  <Route path="/" element={<AuthenticatedLayout />}> {/* Sidebar + Outlet */}
    <Route index element={<Navigate to="/source/contracts-by-entity" replace />} />
    <Route path="source" element={<ContractDataProvider />}>
      <Route path="contracts-by-entity" element={<ByEntityPage />} />
      <Route path="contracts-by-source" element={<BySourcePage />} />
      <Route path="requirements" element={<RequirementsPage />} />
    </Route>
    <Route path="experiments" element={<ExperimentsPage />}>
      <Route index element={<Navigate to="prompt-versions" replace />} />
      <Route path="prompt-versions" element={<PromptVersionsView />} />
      <Route path="run" element={<RunExperimentsView />} />
      <Route path="compare" element={<CompareResultsView />} />
    </Route>
    <Route path="*" element={<Navigate to="/source/contracts-by-entity" replace />} />
  </Route>
</Routes>
```

### HashRouter Decision

See D-1 in the Decisions Log. URLs take the form `/#/source/contracts-by-entity`. The `#` prefix is an implementation detail; the URL still encodes full path and sub-section identity. Switching to `BrowserRouter` later requires only changing the router component at the root — no route definitions change.

---

## Component Library Integration

### Radix UI Primitives

Two primitives only: `@radix-ui/react-navigation-menu` and `@radix-ui/react-collapsible`.

- `NavigationMenu.Root` + `NavigationMenu.List` + `NavigationMenu.Item` + `NavigationMenu.Link` with `asChild` — wraps React Router `<NavLink>` so Radix manages ARIA roles and keyboard navigation while the router drives active state
- `Collapsible.Root` + `Collapsible.Trigger` + `Collapsible.Content` — controls each `SidebarArea` expand/collapse on mobile; `data-state="open|closed"` drives the chevron CSS transform

### CSS Integration

Active state is driven by React Router's `NavLink` `isActive` prop passed to `data-active` on the Radix link element, plus `aria-current="page"` set programmatically. CSS targets the data attribute:

```css
[data-radix-navigation-menu-link][data-active] {
  color: var(--area-accent);
  background: var(--area-accent-dim);
}
```

The `--area-accent` / `--area-accent-dim` variables are scoped per area via `data-area`:

```css
.sidebar-area[data-area="source"]      { --area-accent: #6c8ef8; --area-accent-dim: rgba(108,142,248,.12); }
.sidebar-area[data-area="experiments"] { --area-accent: #4ade80; --area-accent-dim: rgba(74,222,128,.12); }
```

These variables are used **only** in `.sidebar-area` scope. The global `--accent` token is not touched. This prevents per-area colors from bleeding into form focus rings, badges, or any other component that consumes `--accent`.

### Bundle Impact

- `react-router-dom` ~18 KB gzipped (tree-shaken to core SPA primitives)
- `@radix-ui/react-navigation-menu` ~20–25 KB gzipped
- `@radix-ui/react-collapsible` ~2–4 KB gzipped incremental

Total addition: ~40–47 KB gzipped — within the 50 KB ceiling (NFR). No further Radix primitives should be added in this feature without a bundle audit.

---

## State Management Plan

### What Stays in AppShell

- `token`, `ready` — auth gate; passed down or via context as needed
- `theme` — global theme toggle; no change

### ContractDataContext

Wraps the `/source` route subtree. Provides `entries`, `groups`, and a `load()` function. Data is fetched once on mount (when the user first lands in the source area). ByEntityPage and BySourcePage consume the context instead of each fetching independently. Navigation between the two source views does not re-trigger the fetch.

```tsx
// src/contexts/ContractDataContext.tsx
interface ContractDataContextValue {
  entries: ContractEntry[];
  groups: ContractGroup[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}
```

`ContractDataProvider` is the `element` for the `/source` parent route (it renders `<Outlet />`), so it mounts once per session in the source area and unmounts when the user navigates away to experiments.

### CrawlContext

Provides crawl state to Sidebar (status badge, elapsed timer) and the Refresh button handler. Decouples crawl state from page routing.

```tsx
// src/contexts/CrawlContext.tsx
interface CrawlContextValue {
  crawlRunning: boolean;
  crawlElapsed: number;
  crawlSummary: CrawlSummary | null;
  crawlError: string | null;
  runRefresh: () => void;
}
```

`CrawlProvider` wraps the entire authenticated shell (inside AppShell, outside the route tree). The Sidebar Refresh button calls `runRefresh()` from this context. The underlying API call logic is moved unchanged from `App.tsx`.

### ExperimentsPage Sub-Route State

`ExperimentsPage` owns the experiments list and versions list (previously managed in `ExperimentsView`). The current `promptTab` state (`'experiments' | 'prompts'`) is eliminated — the active child route replaces it. `ExperimentsPage` renders `<Outlet />` and passes shared data (experiments list, versions list) via props or a local context to child route elements.

### Per-Page State

| State | Moves to |
|---|---|
| `selected` (entity view) | `ByEntityPage` — local `useState` |
| `diff` | `ByEntityPage` — local `useState` |
| `selected` (source view) | `BySourcePage` — local `useState` |

---

## CSS Changes

### Replaced (shell layout only)

| Old | Replacement |
|---|---|
| `.app-shell` (column flex) | `.app-shell` becomes `display: flex; flex-direction: row` |
| `.app-header` | `.sidebar-header` — sidebar brand/title area |
| `.app-nav`, `.app-nav-btn` | `.sidebar-area`, `.sidebar-nav-link` — vertical orientation |
| `--header-h`, `--nav-h` tokens | Replaced by `--sidebar-w` |

### Kept Unchanged

All design tokens (`--bg`, `--surface`, `--border*`, `--text*`, `--accent`, `--success`, `--warning`, `--danger`, `--muted`, `--radius*`, `--shadow*`, `--font`, `--font-mono`), and all component styles: `.badge*`, `.btn*`, `.form-*`, `.card`, `.row-btn`, `.row-list`, `.meta-grid`, `.detail-heading`, `.code-block`, `.diff-*`, `.req-*`, `.exp-row*`, `.crawl-log`, `.entity-*`, `.section-heading`, `.alert*`, `.signin-*`, `.experiments-grid`, and all utilities (`.stack`, `.cluster`, `.spacer`, `.text-muted`, `.text-sm`, `.mt-*`, `.loading`).

The `.app-main` and `.app-panel` classes remain valid for the content-area split inside each page.

### New Tokens and Classes

```css
:root {
  --sidebar-w: 220px;
}

.sidebar-area[data-area="source"]      { --area-accent: #6c8ef8; --area-accent-dim: rgba(108,142,248,.12); }
.sidebar-area[data-area="experiments"] { --area-accent: #4ade80; --area-accent-dim: rgba(74,222,128,.12); }

/* Mobile collapsed state */
@media (max-width: 768px) {
  .app-shell .sidebar { /* collapsed / overlay behavior */ }
  .hamburger-btn { display: flex; }
}
```

### Accent Color Rationale

Source Pipeline reuses the existing `--accent` value (`#6c8ef8`) — this is already familiar from the current active tab state, and scoping it to `--area-accent` means the global token is not changed. Experiments gets `#4ade80` (the existing `--success` green), which provides visual contrast against the blue source area while staying within the current palette. Both values should be verified against WCAG 4.5:1 contrast ratio against `--surface` in light and dark themes during implementation.

---

## File Decomposition Plan

The decomposition order is chosen to minimize merge risk: extract leaf components first (no dependencies on routing), add routing infrastructure second, then split page-level state last.

**Phase 1 — Extract self-contained components (no routing dependency)**
1. `SignIn.tsx` — extract from App.tsx
2. `CrawlLog.tsx` — extract from App.tsx
3. `RequirementsPage.tsx` — thin wrapper over existing `RequirementsView` content
4. `ExperimentsPage.tsx` — extract `ExperimentsView`; sub-routes replace `promptTab`

**Phase 2 — Add routing infrastructure**
5. Install `react-router-dom`, `@radix-ui/react-navigation-menu`, `@radix-ui/react-collapsible`
6. `AppShell.tsx` — auth gate + `HashRouter` + route tree; App.tsx becomes an empty re-export or is deleted
7. `CrawlContext.tsx` + `ContractDataContext.tsx` — context providers

**Phase 3 — Extract page components**
8. `ByEntityPage.tsx` — extract entity table + detail panel; consumes `ContractDataContext`
9. `BySourcePage.tsx` — extract source table + detail panel; consumes `ContractDataContext`
10. `Sidebar.tsx` — nav items, Refresh button, crawl status badge; consumes `CrawlContext`

**Phase 4 — CSS and mobile**
11. Replace shell layout CSS; add `--sidebar-w`, `--area-accent` tokens
12. Mobile collapse: `Collapsible` + hamburger button + overlay

---

## Test Plan Summary

### Existing Test Breakage

With React Router, sidebar nav items render as `<a>` elements (via `NavLink`/`NavigationMenu.Link`), not `<button>`. Three files are affected:

| File | Lines | Change required |
|---|---|---|
| `packages/web/tests/App.test.tsx` | 218, 267, 289 | `getByRole('button', { name: ... })` → `getByRole('link', { name: ... })` |
| `packages/web/tests/experiments.test.tsx` | 98 | Same pattern |

All test files must wrap with `MemoryRouter` (from `react-router-dom`) instead of any current navigation mock.

### New Test File

`packages/web/tests/shell-navigation.test.tsx` covers R-25 acceptance criteria (a)–(f):

- (a) Both area groups and all seven sub-section nav items render
- (b) `aria-current="page"` on active link only
- (c) Refresh button presence; `getByRole('button')` not `getByRole('link')`
- (d) Unknown-route redirect to default sub-section
- (e) Mobile collapse: `window.innerWidth = 375` + `resize` event → hamburger visible, sidebar hidden
- (f) Overlay open/close on hamburger activation and sub-section selection

All new tests run under the existing `[web]` Vitest tier (`npm run test` in `packages/web/`).

---

## Integration Boundaries

| Boundary | Interaction | Test type |
|---|---|---|
| `ContractDataContext` → `ByEntityPage` / `BySourcePage` | Context value consumption; stale / loading / error states | `[web]` unit with mocked context |
| `CrawlContext` → `Sidebar` | `runRefresh()` call; badge state update | `[web]` unit with mocked context |
| `ExperimentsPage` → child route elements | Shared experiments/versions list via props or local context | `[web]` unit — render with `MemoryRouter` at child route path |
| `AppShell` `<HashRouter>` → `Sidebar` `NavLink` | Active state + `aria-current` sync | `[web]` integration — `shell-navigation.test.tsx` |
| `HashRouter` `*` catch-all → default route | Redirect on unknown path | `[web]` — `shell-navigation.test.tsx` deep-link suite |

---

## Failure Modes

| Boundary | Failure | Handling |
|---|---|---|
| `ContractDataContext` fetch | API error on `/source` mount | `error` state surfaced via existing `.alert` component in ByEntityPage / BySourcePage |
| `CrawlContext` `runRefresh()` | Crawl API call fails | Existing `crawlError` state propagates to Sidebar badge; no change to error handling logic |
| `HashRouter` unknown path | `*` route catches | `<Navigate replace />` to default; no blank screen (R-17) |
| Mobile overlay | Focus trap escape (e.g. user presses Esc) | `Collapsible.Root` `onOpenChange` handler; returns focus to hamburger button (R-23) |
| Viewport resize mid-session | CSS media query handles layout shift | Active sub-section URL is preserved in router history; page component remains mounted |

---

## Risks and Unknowns

- **Contrast verification:** `#6c8ef8` and `#4ade80` against `--surface` in dark mode must be verified at 4.5:1 during implementation; if either fails, an alternative from the existing palette must be chosen
- **`ContractDataContext` unmount on area switch:** When the user navigates from `/source/*` to `/experiments/*`, the `ContractDataProvider` unmounts and state is lost. On return, data is re-fetched. This is acceptable for the MVP but may cause a noticeable delay if contract data is large. Caching via `useRef` or a module-level singleton can be added later without changing the context API
- **Radix `NavigationMenu` + `HashRouter` active detection:** `NavigationMenu.Link` does not natively consume React Router's active state; `useMatch` from `react-router-dom` must be called per nav item to set the `data-active` attribute. This is a known pattern but adds a small per-item hook call
- **`ExperimentsPage` shared state across child routes:** If `PromptVersionsView` and `RunExperimentsView` both need the same experiments list, they get it from props passed through `ExperimentsPage`. If that list grows complex, a local `ExperimentsContext` scoped to the `/experiments` subtree may be needed — deferred

---

## Out of Scope

The following are explicitly deferred and should not be included in the implementation tasks for this feature:

- LLM requirement enrichment sub-section (R-11 provides the extensibility hook; the feature itself is a future spec)
- `spa-test-artifacts` sub-sections (R-13 provides the accommodation; implementation is its own spec)
- Persisting collapsed-nav state in `localStorage` (D-6)
- Switching from `HashRouter` to `BrowserRouter` (D-1 — deferred until CloudFront config is confirmed)
- Any changes to crawl logic, API calls, or DynamoDB access patterns
- Authentication or Cognito UI changes
- Adding Radix primitives beyond `NavigationMenu` and `Collapsible`

---

## Decisions Log

**D-1 — Use HashRouter initially.**
- **Decision:** `HashRouter` from `react-router-dom`; URLs take the form `/#/source/contracts-by-entity`
- **Reason:** The SST StaticSite CloudFront error-page config (404/403 → `/index.html`) has not been tested in this project. HashRouter eliminates the deployment dependency for this feature. Switching to `BrowserRouter` later requires changing only the root router component — no route definitions change. This partially addresses R-18, which notes hash routing must be documented if required by the hosting environment.
- **Affects:** R-14, R-15, R-16, R-18

**D-2 — Radix UI Primitives (NavigationMenu + Collapsible) as the component library.**
- **Decision:** `@radix-ui/react-navigation-menu` and `@radix-ui/react-collapsible` only
- **Reason:** shadcn/ui requires Tailwind (hard incompatibility with existing theming); Headless UI has no NavigationMenu primitive; hand-rolling ARIA keyboard nav for collapsible nav groups is non-trivial. Radix headless primitives emit `data-state` / `data-active` attributes that CSS custom properties can target directly, satisfying R-20 and R-21 without removing the existing token system.
- **Affects:** R-19, R-20, R-21, R-22, R-23

**D-3 — `--area-accent` scoped variable, not an override of `--accent`.**
- **Decision:** Per-area accent expressed as `--area-accent` / `--area-accent-dim` scoped to `.sidebar-area[data-area="..."]`; the global `--accent` token is unchanged
- **Reason:** `--accent` is consumed by form focus rings, badge components, and other non-nav elements across the app. Overriding it with a per-area color would cause unintended visual changes throughout each page view. Scoping prevents bleed-through.
- **Affects:** R-04, R-20

**D-4 — ContractDataContext wraps the `/source` route subtree.**
- **Decision:** `ContractDataProvider` is the `element` for the `/source` parent route; it fetches `entries` and `groups` once on mount and passes them via context to ByEntityPage and BySourcePage
- **Reason:** Both source views share the same data. Fetching in each page independently would cause redundant API calls on every source-area navigation. The provider unmounts on area switch (acceptable for MVP) and re-fetches on return.
- **Affects:** R-07, R-11 (extensibility — new source sub-sections automatically get access to the same context)

**D-5 — ExperimentsPage layout component with child routes replaces `promptTab` state.**
- **Decision:** `ExperimentsPage` renders `<Outlet />` and child routes `/experiments/prompt-versions`, `/experiments/run`, `/experiments/compare` replace the `promptTab: 'experiments' | 'prompts'` useState
- **Reason:** Eliminates a parallel state machine that duplicates what the router already tracks. Sub-route navigation is URL-addressable (satisfying R-14/R-15). The `spa-test-artifacts` spec can add further child routes without restructuring ExperimentsPage (satisfying R-13).
- **Affects:** R-12, R-13, R-14, R-15

**D-6 — Do not persist collapsed-nav state in localStorage.**
- **Decision:** Mobile nav collapse/expand state is ephemeral; not persisted across page loads
- **Reason:** The use case for persistence (a user who always prefers collapsed nav on desktop) is low-value and adds complexity. The default state (expanded on desktop, collapsed on mobile via CSS media query) is correct for the vast majority of sessions. Can be added as a standalone task if user feedback warrants it.
- **Affects:** R-05, R-06

**D-7 — LLM requirement enrichment as a future Source Pipeline sub-section.**
- **Decision:** When it lands, LLM-assisted requirement enrichment should be added as a sub-section under Source Pipeline alongside EARS Requirements — not as a new top-level area
- **Reason:** Enrichment is a pipeline step on existing requirements data, conceptually adjacent to the Requirements view. Adding it as a Source Pipeline sub-section requires only: a new route definition, a new sidebar nav item in the source area's data structure, and the new page component — no shell or area changes (satisfying R-11's extensibility requirement).
- **Affects:** R-11

**D-8 — Route path `/source/requirements` (not `/source/ears-requirements`).**
- **Decision:** The EARS Requirements route is registered as `path="requirements"` yielding URL `/#/source/requirements`.
- **Reason:** The approved spec and requirements.md test skeletons used `/source/ears-requirements`, but during implementation the shorter `/source/requirements` was used consistently across `AppRoutes.tsx`, `Sidebar.tsx`, and all test files. The full acronym adds no disambiguation value — there is only one requirements view — and the shorter path is less noisy in URLs, browser history, and test fixtures. All internal references (AppRoutes, Sidebar, tests) are consistent with the shorter path.
- **Affects:** R-08, R-14, R-15; URL Shape table above

**D-9 — ExperimentsPage uses `location.pathname` tab selection rather than child routes (D-5).**
- **Decision:** `ExperimentsPage` is mounted monolithically at `experiments/*` and derives the active tab via `location.pathname.includes('...')`. It does NOT render `<Outlet />` with child routes as described in D-5.
- **Reason:** The child-route approach (D-5) was the original design, but implementing it in T-11 would have broken the T-04a test suite (ExperimentsPage tab tests) with no remediation task — this was the pre-implementation blocking issue B-2. The pathname-matching approach preserves existing test coverage, avoids a test rewrite mid-implementation, and delivers the same user-visible URL navigation without adding empty sub-page view components. The URLs `/experiments/prompt-versions`, `/experiments/run`, and `/experiments/compare` all resolve to ExperimentsPage content; tab selection is driven by which path segment matches.
- **Trade-off:** `/experiments/run` and `/experiments/compare` currently render the same tab content (both map to the experiments list). Proper differentiation would require the child-route approach. This can be addressed in a follow-on task when the experiments area grows.
- **Affects:** D-5 (supersedes the child-route architecture for this area), R-12, R-14
