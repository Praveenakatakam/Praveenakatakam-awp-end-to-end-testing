# Follow-up Requirements — Service Team Coordination

This document tracks requirements that the E2E Test Generator places on service-team-owned
artifacts (ODCS contracts, repo contents, schema definitions). Each item needs to be
communicated to and accepted by the affected teams before the corresponding spec requirement
in `spec.md` can be considered fully implementable.

Items here are written as **what we need from service teams** rather than as system behavior —
the system behavior lives in `spec.md`.

---

## SF-01 — Semver tagging of ODCS contracts (gates `spec.md` R-01)

**What we need from service teams:**

- Tag every ODCS contract version in the Contract Registry using semver (e.g., `v1.4.0`).
- Treat tagged versions as immutable — never re-tag.
- Tag a new version on every contract change, breaking or non-breaking.

**Why this matters:** R-01 selects "the ODCS contract whose semver tag is highest in the
registry" as the version to test against. Without consistent tagging, the system picks the
wrong contract or has no contract to pick.

**Trade-off the team should be aware of:** Because R-01 uses the *highest* tag — not the
deployed version — tests will run against a contract that may be ahead of what's live in
staging. This is intentional: it catches contract drift early. But it means service teams
should not tag a contract version until their service is on track to honor it.

**Open sub-questions to settle with service teams:**
- What happens if a service has no semver tags at all? *(Proposal: abort the run per R-06.)*
- How are pre-release suffixes handled? E.g., does `v1.4.0-rc.1` count as higher than
  `v1.3.0`? *(Proposal: ignore pre-release suffixes; select the highest stable release.)*
- Who polices tagging discipline? Is there a CI check on the Contract Registry?

**Status:** Open — needs service-team comms.

---

## SF-02 — UI specification file convention (gates `spec.md` R-03)

**What we need from service teams:**

- For services that expose a Web UI, maintain a UI specification file in the service
  repository at a conventional path.
- For services that do not expose a UI, do not create the file.
- Keep the file in sync with the deployed UI.

**Why this matters:** R-03 detects UI-bearing services by the presence of this file. No file →
no UI hop generated → R-32 skips that service's UI flow.

**Open sub-questions to settle with service teams:**
- What is the canonical path? *(Proposal: `docs/ui-spec.yaml` at repo root.)*
- What is the canonical format? *(Proposal: a documented YAML schema; markdown also viable
  if the LLM is the primary consumer.)*
- Failure mode if a UI-bearing service forgets the file: the system silently treats it as
  API-only and skips UI hops. Do we want a separate check (e.g., a smoke probe of the
  deployed URL) to detect this drift?
- Where is the deployed UI's base URL declared so the UI-automation client (R-32) knows
  where to navigate?

**Status:** Open — needs path/format proposal + service-team comms.

---

## SF-03 — ODCS `events` section for async channels (gates `spec.md` R-29)

**What we need from service teams and the ODCS schema owner:**

- The ODCS schema supports an `events` section on each service entry, declaring outbound
  event channels with at minimum: channel name, transport (SNS / SQS / EventBridge), and a
  reference to the event payload's contract definition.
- Service teams populate this section for every event their service emits that is consumed
  by another service in the test flow.

**Why this matters:** R-29 looks up the channel to subscribe to via this section *before* the
Orchestrator publishes a trigger payload. Without it, async hops cannot be wired up and
R-37's `infrastructure-failure` cascade will fire on every async hop.

**Open sub-questions to settle:**
- Does the ODCS schema already support an `events` section? **First action item.**
- If not, who owns the ODCS schema and what is the change process for extending it?
- What is the payload contract format for events — same ODCS request/response shape, or
  something different?
- For services with multiple outbound channels, are channels keyed by event name, topic
  name, or both?
- How is the channel's physical resource (the actual SNS/SQS/EventBridge ARN in staging)
  resolved from the logical name in the contract? (Likely needs a per-environment mapping
  config alongside the ODCS contract.)

**Status:** Open — needs ODCS schema confirmation first.

---

## Status summary

| ID    | Gates spec requirement | Status | Next action | Owner |
|-------|------------------------|--------|-------------|-------|
| SF-01 | R-01                   | Open   | Comms to service teams on semver tagging discipline | TBD |
| SF-02 | R-03, R-32             | Open   | Propose canonical path/format; comms to service teams | TBD |
| SF-03 | R-29                   | Open   | Confirm whether ODCS schema supports `events`; if not, drive extension | TBD |
