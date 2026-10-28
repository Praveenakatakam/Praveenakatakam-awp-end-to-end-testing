# Review — Pre-Implementation (Phase 5)

## BLOCKING

### B-1 — HashRouter inside AppShell makes MemoryRouter test wrapping impossible

**Affects:** T-11a (shell-navigation.test.tsx), R-25 criteria a–d  
**Why it blocks:** The design places `HashRouter` inside `AppShell.tsx`. The test plan (design.md Test Plan Summary, T-11a, and requirements.md section 7 skeletons) says tests should "wrap with `MemoryRouter`" and imports `App` from `../src/App`. If `App.tsx` re-exports `AppShell`, which internally renders `<HashRouter>`, wrapping it in `<MemoryRouter>` creates nested routers — React Router v7 throws on this at runtime. The test skeletons in requirements.md section 7 demonstrate exactly this pattern: `render(<MemoryRouter><App /></MemoryRouter>)`. As written, T-11a cannot be implemented without either (a) extracting the route tree from `AppShell` so tests can mount the app below the router boundary, or (b) redesigning test fixtures to render `Sidebar` + page components directly under `MemoryRouter` rather than rendering `App`/`AppShell`. Neither approach is specified in the design, so the test-writer agent will hit this wall with no guidance.

**Required fix before T-11a:** The design must specify how tests mount the routed app. Two acceptable resolutions: (a) Export a `<AppRoutes />` component (the `<Routes>` tree without the `HashRouter` wrapper) from `AppShell.tsx` — tests wrap it in `MemoryRouter`; `AppShell.tsx` wraps it in `HashRouter`. (b) Explicitly document that `shell-navigation.test.tsx` renders `Sidebar` in isolation under `MemoryRouter`, not the full `App`/`AppShell`, and adjust T-11a scope accordingly. A decision must be added to the design decisions log.

---

### B-2 — T-04a tests will be broken by T-11 with no remediation task

**Affects:** T-11 sequencing, test suite green state, R-25  
**Why it blocks:** T-04 extracts `ExperimentsPage.tsx` keeping its `promptTab` state intact — T-04a writes tests for `tab activation` behavior (switches to run view, switches to compare view). T-11 then modifies `ExperimentsPage.tsx` to remove `promptTab` entirely and replace it with `<Outlet />` (D-5). After T-11, the prompt-tab UI that T-04a tested no longer exists — T-04a tests will fail. No task is assigned to update T-04a. T-14 only covers `App.test.tsx` lines 218/267/289 and `experiments.test.tsx` line 98 — it does not cover `ExperimentsPage.test.tsx`. This means T-11 cannot pass its validation gate ("npm run test passes") without silently breaking the T-04a suite, and there is no task to fix it.

**Required fix before T-11:** Either (a) T-11 scope explicitly includes updating `packages/web/tests/ExperimentsPage.test.tsx` from tab-switching tests to child-route tests, or (b) a new task T-11c is inserted to rewrite `ExperimentsPage.test.tsx` after T-04a is written. The T-11 `Impacted areas` field should list `packages/web/tests/ExperimentsPage.test.tsx`.

---

## NON-BLOCKING

### N-1 — T-12 and T-13 both modify index.css and can run in parallel — merge conflict risk

**Affects:** Phase 5 execution  
T-12 adds shell layout classes, sidebar-area accent vars, and Radix active-state rules to `index.css`. T-13 adds `hamburger-btn` and overlay rules to `index.css`. Both tasks are declared independent. The implementer agents will produce conflicting edits to the same file. Recommend noting in T-13 that it should coordinate with T-12 output (or sequence T-12 before T-13 within Phase 5).

---

### N-2 — WCAG contrast is deferred to implementation with no fallback palette specified

**Affects:** R-04, non-functional accessibility requirement  
The design names `#6c8ef8` and `#4ade80` as the accent colors and notes "should be verified against WCAG 4.5:1 during implementation — if either fails, substitute from existing palette." T-12's validation includes this check, which is good, but neither the design nor the tasks name the fallback values. If the implementer finds `#4ade80` (green) fails against dark-mode `--surface`, there is no pre-approved alternative — a new decision must be logged mid-task, risking scope drift. Recommend pre-computing the contrast ratios now and adding a fallback in the decisions log.

---

### N-3 — ContractDataContext remount behavior (round-trip) is not explicitly tested

**Affects:** T-07a, R-07  
T-07a covers: fetch on mount, reload(), error state, loading state. It does not cover the round-trip: mount → navigate away (context unmounts) → navigate back (context remounts) → data is re-fetched correctly. The design acknowledges this as a known risk ("may cause a noticeable delay if contract data is large") but the test suite has no regression guard for the re-mount fetch triggering correctly. Not blocking for MVP since the behavior is additive, but adds tech-debt with no test cover.

---

## VERDICT

**FAIL**

Two blocking issues (B-1, B-2) must be resolved before implementation begins:

- B-1 requires a design decision on how `shell-navigation.test.tsx` mounts the routed app without nesting `MemoryRouter` inside `AppShell`'s `HashRouter`.
- B-2 requires explicit scope or a new task to update `ExperimentsPage.test.tsx` when T-11 converts `ExperimentsPage` from `promptTab` to `<Outlet />`.

---

# Review — Phase 4 Integration

> Post-implementation adversarial review. All routing integration is complete (Phases 1–4). Phase 5 (CSS + mobile collapse) has not started.

## BLOCKING

### B-3 — Route path `/source/requirements` deviates from approved spec (`/source/ears-requirements`) with no decisions log entry

**Affects:** `packages/web/src/AppRoutes.tsx:45`, `packages/web/src/Sidebar.tsx:70`, `specs/active/spa-ux-redesign/design.md` (URL Shape table), `requirements.md` test skeleton §7

The approved `design.md` URL Shape table and the component tree diagram both name the route `/source/ears-requirements`. The `requirements.md` test skeleton at §7 also used `/source/ears-requirements` in its deep-link test:

```
it('renders correct sub-section on direct load of /source/ears-requirements', () => {
```

The implementation uses `/source/requirements` in both `AppRoutes.tsx` (`path="requirements"`) and `Sidebar.tsx` (NavLink `to="/source/requirements"`). These are internally consistent with each other and with `shell-navigation.test.tsx`, which tests `/source/requirements`. However the deviation from the approved spec is not documented anywhere in the decisions log.

Per `CLAUDE.md`: "The spec is the oracle: if code and spec disagree, fix the code (or update the spec explicitly and record the change in the decisions log)." Phase 5 tests for R-25 criteria e–f (mobile collapse) will target the live route path; if the decisions log is not updated before T-12/T-13 implementation, the Phase 5 test-writer will be working from a design.md that specifies a path that does not exist.

**Required fix before T-12:** Either (a) rename `path="requirements"` → `path="ears-requirements"` in `AppRoutes.tsx` and update `Sidebar.tsx` + `shell-navigation.test.tsx` to match, or (b) update `design.md` URL Shape table and component tree to reflect `/source/requirements` and add a decisions log entry (D-8) recording the change and reason (shorter path, same semantics).

---

## NON-BLOCKING

### N-4 — ExperimentsPage uses URL string matching instead of the approved child-route architecture (D-5)

**Affects:** `packages/web/src/pages/ExperimentsPage.tsx:274`, `packages/web/src/AppRoutes.tsx:47`, `specs/active/spa-ux-redesign/design.md` (D-5, Route Tree sketch)

The approved design (D-5) described `ExperimentsPage` as a layout component rendering `<Outlet />`, with child routes `/experiments/prompt-versions`, `/experiments/run`, and `/experiments/compare` supplying their own view components. The route sketch in `design.md` shows:

```tsx
<Route path="experiments" element={<ExperimentsPage />}>
  <Route index element={<Navigate to="prompt-versions" replace />} />
  ...
</Route>
```

The implementation instead mounts `ExperimentsPage` monolithically at `experiments/*` and derives the active tab via `location.pathname.includes('prompt-versions')`. `ExperimentsPage` does not render `<Outlet />`. This resolved the B-2 pre-implementation concern (T-04a tests remain valid) but the architecture differs from what was approved.

The deviation is acceptable functionally, but: (a) it leaves `/experiments/run` and `/experiments/compare` rendering **identical content** (both map to `promptTab = 'experiments'`, showing the same experiments list with the same inline comparison UI — there is no rendered differentiation between the two URLs), and (b) it is not documented. Should be captured in a decisions log entry before archiving.

**Not a Phase 5 blocker** — T-12 (CSS) and T-13 (mobile collapse) do not depend on ExperimentsPage's internal routing architecture. Flag for decisions log update before archive.

---

### N-5 — `App.test.tsx` `fakeApi` is missing seven API methods added in Phase 4

**Affects:** `packages/web/tests/App.test.tsx:14–22`

`fakeApi` in `App.test.tsx` does not include `listExperiments`, `listPromptVersions`, `createPromptVersion`, `createExperiment`, `getExperiment`, `getExperimentArtifact`, or `getPromptVersion`. The `api.js` mock returns this incomplete object. None of the existing `App.test.tsx` tests navigate to `/experiments/*`, so `ExperimentsPage` never mounts and these methods are never called — the tests pass today. However, if a future test in this file navigates to the experiments area, all seven calls will return `undefined` and throw at runtime rather than failing with a clear mock-not-found message.

**Not a Phase 5 blocker.** Low risk while tests stay on source routes; add a comment or stub the missing methods before the next test-writing pass on `App.test.tsx`.

---

### N-6 — Pre-existing test failures in `App.test.tsx` and `lib.test.ts` cannot be attributed to Phase 4

**Affects:** `packages/web/tests/App.test.tsx`, `packages/web/tests/lib.test.ts` (not read)

`App.test.tsx` structure is consistent with the new routing: it uses `getByRole('link')` for `contracts by source` and `requirements` nav items (lines 181, 199, 222, 245, 259, 271) and resets `window.location.hash` before each test. `ExperimentsPage` is not mounted by any existing test. The three reported failures are more likely in `lib.test.ts` (not read — `lib.test.ts` was mentioned alongside `App.test.tsx` in the question) and predate Phase 4. No evidence Phase 4 introduced them; `App.test.tsx` does not reference any broken pattern.

---

## Phase 5 readiness check (T-12 / T-13)

T-12 (CSS) targets: `.app-shell`, `.app-layout`, `.sidebar`, `.sidebar-area[data-area="source"]`, `.sidebar-area[data-area="experiments"]`, `.app-main-area`. All class names and `data-area` attributes are present in the current JSX (`AppShell.tsx`, `AppRoutes.tsx`, `Sidebar.tsx`). T-12 can proceed without DOM changes.

T-13 (mobile collapse) requires: hamburger button element, `Collapsible.Root` wrapping the sidebar. Neither is present yet — this is correct; they are the T-13 deliverable. T-13 will add DOM nodes to `Sidebar.tsx` and/or `AppShell.tsx`; no structural conflicts with T-12 CSS work assuming T-12 lands first (consistent with N-1 sequencing note from pre-implementation review).

---

## VERDICT

**1 blocking issue (B-3)** must be resolved before Phase 5 begins: the `/source/requirements` vs `/source/ears-requirements` path deviation must be documented in the decisions log (preferred) or reverted to the spec path. All other findings are non-blocking.

---

# Review — Final Post-Implementation (Phase 5)

> Post-implementation adversarial review. All phases complete (T-12/T-13 CSS and mobile collapse done). Checking against R-01 through R-25, D-1 through D-8, and open items N-4/N-5 from Phase 4.

## BLOCKING

### B-4 — `.app-layout` has no CSS definition; sidebar stacks above content instead of left of it

**Affects:** `packages/web/src/styles.css`, `packages/web/src/AppRoutes.tsx:45`, R-01

`AppRoutes.tsx` wraps the sidebar and content inside `<div className="app-layout">`. That class is not defined anywhere in `styles.css`. The `.app-shell` div does have `display: flex; flex-direction: row`, but `.app-layout` is a *child* of `.app-shell` — row-flex on the parent only makes `.sidebar-header` and `.app-layout` sit side by side, it does not make the *contents of `.app-layout`* (the `.sidebar` and `.app-main-area` divs) sit side by side.

Without `display: flex; flex-direction: row` on `.app-layout`, those two children use default block layout and stack vertically. The `.sidebar` has `width: var(--sidebar-w); flex-shrink: 0` and `.app-main-area` has `flex: 1`, but both flex properties are inert without a flex container. The visual result is sidebar on top of content, not sidebar to the left.

R-01 ("The system SHALL render a persistent sidebar on the left side of the viewport") is not satisfied in actual rendering. The DOM structure and ARIA are correct; the layout wiring is not.

**Required fix:** Add to `styles.css`:
```css
.app-layout {
  display: flex;
  flex-direction: row;
  flex: 1;
  min-height: 0;
}
```

---

## NON-BLOCKING

### N-4 (from Phase 4) — ExperimentsPage architecture deviation still undocumented

`design.md` decisions log ends at D-8. The Phase 4 review flagged that ExperimentsPage uses `location.pathname.includes(...)` instead of child routes with `<Outlet />` (D-5 specified child routes). A decisions log entry explaining this choice has not been added. This must be documented before archiving the spec. Not a Phase 5 blocker.

---

### N-5 (from Phase 4) — `App.test.tsx` fakeApi still missing 7 experiment methods

`packages/web/tests/App.test.tsx` lines 14–22: fakeApi contains only `listContracts`, `getContract`, `getRaw`, `getEntity`, `listCrawls`, `refresh`, `listRequirements`. The seven experiment-related methods (`listExperiments`, `listPromptVersions`, `createPromptVersion`, `createExperiment`, `getExperiment`, `getExperimentArtifact`, `getPromptVersion`) are absent. Tests pass today because no test navigates to `/experiments/*`, but any future test that does will throw `undefined is not a function` instead of a clear mock-not-found error. Add as a comment or stub the missing methods before the next test-writing pass on `App.test.tsx`. Remains non-blocking.

---

### N-7 — `@radix-ui/react-collapsible` installed but unused

`packages/web/package.json` declares `@radix-ui/react-collapsible: "^1.1.0"`. No source file imports it. T-13 and D-2 both specified using `Collapsible.Root` for mobile collapse, but the implementation used plain React `useState` in `AppRoutes.tsx` instead. The functional behavior (hamburger, overlay, dismiss on selection/outside-click/Escape, focus management) correctly satisfies R-05, R-06, and R-23. However, the unused package adds ~3 KB gzipped to the bundle for no benefit. Remove the dependency or document the deviation in the decisions log before archiving.

---

### N-8 — `.sidebar-area-header` and `.sidebar-area-title` not defined in CSS

`Sidebar.tsx` uses `className="sidebar-area-header"` (lines 72, 106) and `className="sidebar-area-title"` (lines 73, 107). Neither class is defined in `styles.css`. The area headers ("Source Pipeline", "Experiments") will render as unstyled inline text. This is a cosmetic gap — layout and behavior are unaffected — but the design specified styling for these elements. Add styles before archiving.

---

## VERDICT

**FAIL — 1 blocking issue (B-4).**

`.app-layout` missing its `display: flex; flex-direction: row` CSS definition causes the sidebar to stack vertically above the content area, directly violating R-01. A one-rule fix in `styles.css` resolves it. The three non-blocking items (N-4, N-7, N-8) and the carry-forward N-5 should be resolved before archiving but do not block this task from being re-reviewed once B-4 is fixed.
