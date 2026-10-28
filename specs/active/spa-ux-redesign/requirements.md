# Requirements — SPA UX Redesign

> **Version:** 0.1.0
> **Status:** Draft

## 1. Purpose and Context

The ODCS Contract Registry SPA currently renders four peer tabs in a flat strip (`entity | source | requirements | experiments`), which gives no signal about the system's conceptual structure. Users cannot tell at a glance that the app has two distinct halves — a pipeline that ingests contracts and requirements, and an experiments surface that generates and compares LLM-synthesised tests. This redesign replaces that flat strip with a sidebar-left two-area shell so the taxonomy is legible on first load and the navigation state is URL-addressable.

## 2. Out of Scope

- Changes to data-fetching logic, API calls, or business logic inside any existing page
- Backend changes (Lambda, DynamoDB, API Gateway, Bedrock)
- The LLM requirement enrichment feature — extensibility hooks are required but the feature itself is deferred
- `spa-test-artifacts` sub-sections — the shell must accommodate them without a rethink, but they are not implemented here
- Authentication / Cognito UI changes
- Internationalisation or localisation
- Theming beyond the two per-area accent colors and the existing light/dark CSS custom property system

## 3. Functional Requirements (EARS)

### 3.1 Two-Area Shell

**R-01** — The system SHALL render a persistent sidebar on the left side of the viewport that contains the full application navigation.

**R-02** — The sidebar SHALL be divided into two visually distinct groups: **Source Pipeline** and **Experiments**.

**R-03** — WHEN a user loads the application for the first time, THE system SHALL display Source Pipeline as the default active area and the first sub-section within it as the active view.

**R-04** — The system SHALL apply a distinct accent color to Source Pipeline navigation items and a different distinct accent color to Experiments navigation items, using the existing CSS custom-property theming system.

**R-05** — WHERE the viewport width is 768 px or narrower, THE system SHALL replace the sidebar with a collapsed state accessible via a hamburger button or a bottom navigation bar.

**R-06** — WHEN the viewport is in collapsed state and the user activates the hamburger button, THE system SHALL display the full sidebar navigation as an overlay or drawer and SHALL dismiss it when the user selects a sub-section or taps outside the overlay.

**R-07** — The system SHALL preserve all existing rendered content (tables, forms, data displays) inside each sub-section view — the shell is restructured, the inner content is not.

### 3.2 Source Pipeline Area

**R-08** — The Source Pipeline area SHALL contain the following sub-sections as navigable items in the sidebar: **Contracts by entity**, **Contracts by source**, **EARS Requirements**.

**R-09** — The Source Pipeline area SHALL contain a **Refresh** action button that triggers the crawl. The Refresh control SHALL be rendered as a persistent action button within the Source Pipeline area (e.g. in the area header or a fixed position within the sidebar group), NOT as a navigable sub-section item.

**R-10** — WHEN the user activates the Refresh action button, THE system SHALL invoke the same crawl trigger behaviour that currently exists in `App.tsx` without any change to the underlying API call or state management.

**R-11** — The Source Pipeline area navigation structure SHALL be designed so that future sub-sections (e.g. LLM-assisted requirement enrichment) can be added as additional sidebar items without restructuring the area header, accent color scheme, or routing configuration.

### 3.3 Experiments Area

**R-12** — The Experiments area SHALL contain the following sub-sections as navigable items in the sidebar: **Prompt versions**, **Run experiments**, **Compare results**.

**R-13** — The Experiments area navigation structure SHALL accommodate at least two additional sub-sections (e.g. generation run history, test artifact viewer from `spa-test-artifacts`) without restructuring the area grouping, accent color, or routing configuration.

### 3.4 URL-Based Navigation

**R-14** — The system SHALL use a client-side routing library to reflect the active area and sub-section in the URL path (e.g. `/source/contracts-by-entity`, `/experiments/prompt-versions`).

**R-15** — WHEN a user navigates directly to a sub-section URL (deep link), THE system SHALL render the correct area and sub-section without requiring navigation through the home route.

**R-16** — WHEN a user activates the browser back or forward controls, THE system SHALL transition to the corresponding previously visited sub-section view.

**R-17** — IF a user navigates to an unknown URL path, THE system SHALL redirect to the default route (Source Pipeline → Contracts by entity) and SHALL NOT display a blank screen or an unhandled error.

**R-18** — The system SHALL not use hash-based routing (`#/path`) unless the existing deployment infrastructure requires it; if hash routing is required by the hosting environment, this shall be documented in the decisions log.

### 3.5 Component Library

**R-19** — The design phase SHALL evaluate and select a lightweight UI component library to replace the current ad-hoc component set, selecting based on: bundle size impact on the SPA, quality of documentation, accessibility primitives (keyboard navigation, ARIA), and community support.

**R-20** — WHERE a component library is adopted, THE system SHALL integrate it without removing the existing CSS custom-property theming system (`--bg`, `--accent`, `--surface`, etc.) — library components SHALL consume or coexist with those properties.

**R-21** — WHERE a component library is adopted, THE system SHALL ensure the sidebar, area groupings, and accent color differentiation can be expressed using library primitives without requiring custom CSS overrides for every interactive state.

### 3.6 Accessibility

**R-22** — The sidebar navigation SHALL be keyboard-navigable: focus SHALL move through sub-section links in DOM order via Tab, and the active link SHALL be announced by screen readers with an appropriate `aria-current="page"` attribute.

**R-23** — WHEN the sidebar is in collapsed/overlay state on small viewports, THE system SHALL manage focus correctly: focus SHALL move into the drawer when it opens and SHALL return to the trigger element when it closes.

**R-24** — The area group labels ("Source Pipeline", "Experiments") SHALL be rendered as semantic `<nav>` landmarks or equivalent ARIA roles so that screen readers can enumerate the navigation regions.

### 3.7 Unit Testing

**R-25** — All new shell and navigation components SHALL have Vitest unit tests using `@testing-library/react` covering: (a) correct rendering of both area groups and all sub-section nav items, (b) `aria-current="page"` applied to only the active link, (c) Refresh button presence and non-nav-item status, (d) unknown-route redirect to default, (e) mobile collapse/hamburger render at ≤768 px, and (f) overlay open/close behaviour. Tests SHALL live in `packages/web/tests/` and run as part of the existing `[web]` Vitest tier (`npm run test` in `packages/web/`).

## 4. Non-Functional Requirements

- **Performance:** The shell re-render on navigation (sidebar active state change) SHALL complete within one animation frame (~16 ms) with no full page reload. Initial JS bundle size added by any routing or component library dependency SHALL not exceed 50 KB gzipped above the current baseline without explicit sign-off.
- **Accessibility:** WCAG 2.1 AA compliance for the navigation shell. Contrast ratio for accent colors against the sidebar background SHALL be at least 4.5:1 in both light and dark themes.
- **Extensibility:** Adding a new sub-section to either area SHALL require changes only to: (a) the routing configuration, (b) the sidebar nav data structure, and (c) the new page component. No changes to the shell layout component or area grouping component SHALL be required.
- **Browser support:** Same targets as the current SPA. No IE11.
- **Bundle:** The SPA SHALL continue to load and render the default view within 3 seconds on a simulated 4G connection (Lighthouse Fast 4G throttling).

## 5. Edge Cases

| Condition | Expected Behaviour |
|---|---|
| User loads `/` with no path | Redirect to default sub-section (`/source/contracts-by-entity`) |
| User loads an unknown path (e.g. `/foo/bar`) | Redirect to default sub-section; no blank screen |
| User deep-links to `/experiments/compare-results` before any experiment data exists | Render the Compare results view with its existing empty-state UI; do not error |
| Viewport resizes from desktop to mobile mid-session | Sidebar collapses gracefully; active sub-section state is preserved |
| Viewport resizes from mobile to desktop mid-session | Overlay/drawer dismisses; full sidebar renders; active sub-section state is preserved |
| Refresh action fires while the user is navigating | Crawl trigger is independent of nav state; both operations complete independently |
| User activates browser back across an area boundary (e.g. Experiments → Source Pipeline) | Active area accent color updates to match the restored sub-section's area |
| Component library CSS conflicts with existing `--accent` custom property | Design phase must resolve; requirement R-20 mandates coexistence |

## 6. Acceptance Criteria

- [ ] Loading `/` redirects to the Source Pipeline default sub-section and the sidebar renders with both area groups visible
- [ ] Each of the seven named sub-sections (R-08, R-12) renders its existing content unchanged when navigated to
- [ ] Source Pipeline sidebar items use accent color A; Experiments sidebar items use a visually distinct accent color B
- [ ] The Refresh button is present in the Source Pipeline area and triggers the crawl; it does not appear as a sidebar nav item
- [ ] Navigating to `/source/contracts-by-entity` directly (hard reload) lands on the correct view
- [ ] Navigating to an unknown path redirects to the default view without a blank screen
- [ ] Browser back/forward moves between previously visited sub-sections correctly
- [ ] At 375 px viewport width, the sidebar is collapsed; a hamburger control is visible and opens the navigation overlay
- [ ] Keyboard Tab order traverses all sidebar nav links; each link has `aria-current="page"` when active
- [ ] Screen reader announces the two navigation landmarks separately
- [ ] Lighthouse Performance score does not regress more than 5 points from the pre-redesign baseline on a Fast 4G simulated run
- [ ] Adding a stub sub-section item to either area's nav data structure results in a visible sidebar entry with correct routing — no changes to layout or area grouping components required

## 7. Test Skeletons

These are Vitest + Testing Library stubs. They should live in `packages/web/tests/` and are paired to the acceptance criteria above. They are placeholders — full implementation follows in test-writing tasks.

```typescript
// packages/web/tests/shell-navigation.test.tsx

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom'; // or chosen router
import App from '../src/App';

describe('[web] Shell — two-area navigation', () => {
  it('renders both Source Pipeline and Experiments area groups in the sidebar', () => {
    // GIVEN the app is rendered at "/"
    // THEN both area labels are present in the sidebar
  });

  it('redirects "/" to the Source Pipeline default sub-section', () => {
    // GIVEN the app is rendered at "/"
    // THEN the URL is /source/contracts-by-entity (or equivalent default)
    // AND the Contracts by entity view is active
  });

  it('redirects unknown paths to the default sub-section', () => {
    // GIVEN the app is rendered at "/totally/unknown"
    // THEN the user lands on the default sub-section without a blank screen
  });

  it('applies Source Pipeline accent to source nav items', () => {
    // GIVEN the sidebar is rendered
    // THEN Source Pipeline nav items have the source-area accent class/variable
    // AND Experiments nav items have a different accent class/variable
  });

  it('marks the active nav link with aria-current="page"', async () => {
    // GIVEN the user navigates to Contracts by source
    // THEN that nav link has aria-current="page"
    // AND no other link has aria-current="page"
  });

  it('Refresh button is present in Source Pipeline area and is not a nav item', () => {
    // GIVEN the sidebar is rendered
    // THEN a Refresh/crawl button exists
    // AND it is not a router link / nav item
  });
});

describe('[web] Shell — deep linking', () => {
  it('renders correct sub-section on direct load of /experiments/prompt-versions', () => {
    // GIVEN the app is rendered at "/experiments/prompt-versions"
    // THEN the Prompt versions view content is visible
  });

  it('renders correct sub-section on direct load of /source/ears-requirements', () => {
    // GIVEN the app is rendered at "/source/ears-requirements"
    // THEN the EARS Requirements view content is visible
  });
});

describe('[web] Shell — mobile viewport', () => {
  beforeEach(() => {
    // Set window.innerWidth = 375 and fire resize event
  });

  it('collapses sidebar and shows hamburger button at 375px viewport', () => {
    // GIVEN the viewport is 375px wide
    // THEN the full sidebar is not visible
    // AND a hamburger/menu trigger is visible
  });

  it('opens navigation overlay when hamburger is activated', async () => {
    // GIVEN the sidebar is collapsed
    // WHEN the user activates the hamburger button
    // THEN the full navigation is visible
  });

  it('closes overlay and navigates when a sub-section is selected', async () => {
    // GIVEN the navigation overlay is open
    // WHEN the user selects a sub-section
    // THEN the overlay closes
    // AND the correct sub-section view renders
  });
});
```

## 8. Open Questions

1. **Component library choice** — The design phase must evaluate and select from candidates (e.g. Radix UI primitives, shadcn/ui, Headless UI, Ariakit, or no library). The evaluation should include: bundle impact, whether the library supports unstyled/headless primitives that can be driven by CSS custom properties, and how it handles the sidebar + nav group pattern. See R-19 through R-21.

2. **Routing library** — The design phase must confirm the routing library (React Router v6 is the expected default). If the deployment target (S3 + CloudFront or similar) requires hash routing, this must be documented and R-18 amended.

3. **Exact accent palette** — Two accent colors (one per area) must be chosen. They must meet the 4.5:1 contrast ratio requirement (NFR) against the sidebar background in both light and dark themes. The color system is deferred to design; the constraint is captured in R-04 and NFR.

4. **LLM requirement enrichment placement** — When LLM-assisted requirement enrichment lands, it could live as a sub-section of Source Pipeline (Requirements → Enrichment), as a new action within the EARS Requirements sub-section, or as a third top-level area. R-11 and R-13 require extensibility; the placement decision is deferred.

5. **`spa-test-artifacts` absorption** — The `spa-test-artifacts` pending spec (generation run history, test artifact viewer) will add sub-sections to the Experiments area. R-13 requires the area accommodate at least two additional items; the design phase should confirm the Experiments area structure can absorb these without a layout rethink.

6. **Collapsed-nav persistence** — Should mobile collapsed/expanded state be persisted across page loads (e.g. `localStorage`)? Not specified; design phase should decide.

## 9. Decisions Log

_Populated during design phase._
