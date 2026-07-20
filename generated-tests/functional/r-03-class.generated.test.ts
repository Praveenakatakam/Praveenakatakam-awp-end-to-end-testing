// GENERATED — DO NOT EDIT. Regenerate via `npm run generate-tests -- --functional` (see generated-tests/functional/manifest.json).
// Manifest plan #1 — functional test for R-03.
// inputHash c26c4f3373216405 — regenerated only when grounded inputs change (R-119).
import { describe, it, expect } from "vitest";

const publisherBase = process.env.PUBLISHER_API_URL;
const publisherToken = process.env.PUBLISHER_TOKEN;
const consumerBase = process.env.CONSUMER_API_URL;
const consumerToken = process.env.CONSUMER_TOKEN;
// Skipped (not failed) when cross-service credentials are absent — R-83a, D-26.
const ready = Boolean(publisherBase && publisherToken && consumerBase && consumerToken);

// Setup / preconditions:
//   - Ensure the publisher service is running and has write access to the class entity endpoint.
//   - Ensure the consumer service is running and its /me/classes endpoint is accessible.
//   - Ensure the CDC pipeline between publisher and consumer is active and operational.
//   - Ensure no pre-existing class record with the test sourcedId exists on either service; clean up if necessary.
//   - Confirm the ODCS contract for class is loaded on the consumer, including data-quality rules: classType ∈ {homeroom, scheduled} and status ∈ {active, tobedeleted}.
describe.skipIf(!ready)("functional: CDC propagation of class entity validates ODCS enum data-quality rules on consumer (classType ∈ {homeroom, scheduled}, status ∈ {active, tobedeleted})", () => {
  it("POST /classes → CDC → consumer reflects change", async () => {
    // TRIGGER (publisher/class): POST /classes
    // payload shape: Object containing all required class fields: sourcedId (unique string), status (one of: active, tobedeleted), dateLastModified (ISO date string), title (non-empty string), classType (one of: homeroom, scheduled), course (object with at minimum a sourcedId reference), school (object with at minimum a sourcedId reference), terms (non-empty array of term references). Optional fields may include classCode, grades, location, metadata, subjects.
    const res = await fetch(`${publisherBase}/classes`, {
      method: "POST",
      headers: { Authorization: `Bearer ${publisherToken}`, "Content-Type": "application/json" },
      // body: JSON.stringify(/* Object containing all required class fields: sourcedId (unique string), status (one of: active, tobedeleted), dateLastModified (ISO date string), title (non-empty string), classType (one of: homeroom, scheduled), course (object with at minimum a sourcedId reference), school (object with at minimum a sourcedId reference), terms (non-empty array of term references). Optional fields may include classCode, grades, location, metadata, subjects. */),
    });
    expect(res.ok, `POST /classes → ${res.status}`).toBe(true);
    // PROPAGATION (cdc): The newly created class record appears in the consumer's /me/classes response under the 'items' array, identified by the matching sourcedId.
  });

  // Post-propagation assertions — a runner fills these in (D-56):
  it.todo("[consumer] GET /me/classes returns HTTP 200 and the response body contains an 'items' array.");
  it.todo("[consumer] The 'items' array contains exactly one record whose 'sourcedId' matches the sourcedId submitted by the publisher in the trigger.");
  it.todo("[consumer] The propagated class record's 'classType' field is present and its value is one of the ODCS-allowed enum values: 'homeroom' or 'scheduled'. Any other value constitutes a data-quality rule violation.");
  it.todo("[consumer] The propagated class record's 'status' field is present and its value is one of the ODCS-allowed enum values: 'active' or 'tobedeleted'. Any other value constitutes a data-quality rule violation.");
  it.todo("[consumer] The propagated class record's 'classType' value exactly matches the value supplied by the publisher in the trigger payload (no transformation or truncation occurred in transit).");
  it.todo("[consumer] The propagated class record's 'status' value exactly matches the value supplied by the publisher in the trigger payload (no transformation or truncation occurred in transit).");
  it.todo("[consumer] All other required fields (sourcedId, dateLastModified, title, course, school, terms) are present and non-null on the propagated record, confirming full contract fidelity beyond the enum fields.");
});
