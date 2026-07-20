// GENERATED — DO NOT EDIT. Regenerate via `npm run generate-tests -- --functional` (see generated-tests/functional/manifest.json).
// Manifest plan #27 — functional test for R-53.
// inputHash 2513c27fd0373da2 — regenerated only when grounded inputs change (R-119).
import { describe, it, expect } from "vitest";

const publisherBase = process.env.PUBLISHER_API_URL;
const publisherToken = process.env.PUBLISHER_TOKEN;
const consumerBase = process.env.CONSUMER_API_URL;
const consumerToken = process.env.CONSUMER_TOKEN;
// Skipped (not failed) when cross-service credentials are absent — R-83a, D-26.
const ready = Boolean(publisherBase && publisherToken && consumerBase && consumerToken);

// Setup / preconditions:
//   - Ensure the publisher service is running and accessible with a valid authentication token for write operations on the class entity.
//   - Ensure the consumer service is running and accessible at /me/classes, with the response envelope exposing records under the 'items' key.
//   - Ensure the CDC pipeline (change-data-capture) between the publisher and consumer is active and healthy.
//   - Record any pre-existing class records on the consumer at /me/classes to distinguish the newly propagated record during assertions.
//   - Prepare a unique sourcedId value to unambiguously identify the class created during this test.
describe.skipIf(!ready)("functional: R-53: class entity mandatory fields propagate via CDC from publisher to consumer", () => {
  it("POST /classes → CDC → consumer reflects change", async () => {
    // TRIGGER (publisher/class): POST /classes
    // payload shape: A JSON object representing a class record containing all required fields: sourcedId (unique string identifier), status (string), dateLastModified (date string in ISO 8601 format), title (string), classType (string), course (object with at minimum a sourcedId reference), school (object with at minimum a sourcedId reference), and terms (non-empty array of term object references). Optional fields such as classCode, grades, location, metadata, and subjects may be omitted.
    const res = await fetch(`${publisherBase}/classes`, {
      method: "POST",
      headers: { Authorization: `Bearer ${publisherToken}`, "Content-Type": "application/json" },
      // body: JSON.stringify(/* A JSON object representing a class record containing all required fields: sourcedId (unique string identifier), status (string), dateLastModified (date string in ISO 8601 format), title (string), classType (string), course (object with at minimum a sourcedId reference), school (object with at minimum a sourcedId reference), and terms (non-empty array of term object references). Optional fields such as classCode, grades, location, metadata, and subjects may be omitted. */),
    });
    expect(res.ok, `POST /classes → ${res.status}`).toBe(true);
    // PROPAGATION (cdc): CDC event emitted by the publisher for the newly created class record to be fully ingested and queryable on the consumer at /me/classes
  });

  // Post-propagation assertions — a runner fills these in (D-56):
  it.todo("[publisher] The POST to /classes returns a success HTTP status code (2xx), confirming the class record was accepted and persisted by the publisher.");
  it.todo("[consumer] A GET to /me/classes returns a response whose 'items' array contains exactly one entry matching the sourcedId used in the trigger payload.");
  it.todo("[consumer] The matched class record in 'items' has a non-null, non-empty 'sourcedId' field equal to the value submitted to the publisher.");
  it.todo("[consumer] The matched class record in 'items' has a non-null, non-empty 'status' string field equal to the value submitted to the publisher.");
  it.todo("[consumer] The matched class record in 'items' has a non-null 'dateLastModified' field equal to the ISO 8601 date value submitted to the publisher.");
  it.todo("[consumer] The matched class record in 'items' has a non-null, non-empty 'title' string field equal to the value submitted to the publisher.");
  it.todo("[consumer] The matched class record in 'items' has a non-null, non-empty 'classType' string field equal to the value submitted to the publisher.");
  it.todo("[consumer] The matched class record in 'items' has a non-null 'course' object field with at least a sourcedId reference, matching the value submitted to the publisher.");
  it.todo("[consumer] The matched class record in 'items' has a non-null 'school' object field with at least a sourcedId reference, matching the value submitted to the publisher.");
  it.todo("[consumer] The matched class record in 'items' has a non-null, non-empty 'terms' array field containing the same term reference(s) submitted to the publisher.");
});
