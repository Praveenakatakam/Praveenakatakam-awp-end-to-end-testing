# Requirement Stub — SPA UX Redesign

> **Status:** Pending — not yet started
> **Captured:** 2026-10-12

## Idea

Redesign the SPA to replace the flat four-tab navigation with a two-area layout that makes the app's conceptual structure explicit: one area for the **Source Pipeline** (crawling, contracts, requirements) and one for **Experiments** (prompt versioning, LLM test generation, results comparison). The taxonomy and visual hierarchy should be immediately legible to a new user and scale gracefully as LLM capabilities are added to both halves.

## Known Scope

- Replace the current flat tab strip (`packages/web/src/App.tsx`) with a two-area navigation model — sidebar or two-pane layout, not tabs
- **Source Pipeline area** — groups: Refresh (crawl GitHub trigger), Contracts by entity, Contracts by source, EARS Requirements
- **Experiments area** — groups: Prompt versions, Run experiments, Compare results
- The two areas should feel like distinct top-level destinations, not peers of equal weight in a flat list
- Requirements section must be designed with extensibility in mind: LLM-assisted requirement enrichment / synthesis will be added later, so the area should accommodate future sub-sections or actions without a rethink
- Component library change is in scope — user wants "different components", implying a visual refresh, not just a structural reorganisation
- Navigation state (active area + active sub-section) must be persisted or reflected in the URL so deep links and browser back/forward work correctly

## Assumptions Made

- The two area names ("Source Pipeline" and "Experiments") are working titles — final labels to be confirmed during SDD intake
- "Different components" implies adopting or evaluating a UI component library (e.g. Radix UI, shadcn/ui, Headless UI) rather than keeping the current ad-hoc component set; the exact library is deferred to SDD design
- Existing page content (tables, forms, data displays) is preserved — this spec covers navigation shell and information architecture, not data presentation logic within each page
- React Router (or equivalent) is the mechanism for URL-based nav state; if the project currently uses hash routing that is kept, otherwise file-based or declarative routing is preferred
- Mobile responsiveness is in scope at a basic level (sidebar collapses to a hamburger or bottom nav on small viewports)

## Open Questions

- What component library, if any, is already in use or preferred? (`packages/web/package.json` deps should be checked during SDD)
- Should the two areas be visually differentiated (e.g. accent colour per area) or use a unified visual language?
- Is there a preference for sidebar-left vs. top-nav with sub-nav vs. split-pane for the two-area shell?
- When LLM requirement enrichment lands, should it live as a sub-section of Requirements or as a new third top-level area?
- Does the Refresh / crawl trigger action belong as a nav item, a persistent action button, or a status widget in the Source Pipeline area header?

## Notes

- The `spa-test-artifacts` pending stub covers surfacing generation run history and test artifacts in the SPA — the redesign should ensure the Experiments area has enough visual and structural room to absorb those additions without further shell changes
- The `prompt-versioning-experiments` active spec (`specs/active/prompt-versioning-experiments/`) is the immediate driver for the Experiments area; its current UI lives in the flat tab strip
- This is a pure frontend change — no Lambda, DynamoDB, or API Gateway work expected
