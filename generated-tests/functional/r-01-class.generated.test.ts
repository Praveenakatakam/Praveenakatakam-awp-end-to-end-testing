// GENERATED — DO NOT EDIT. Regenerate via `npm run generate-tests -- --functional` (see generated-tests/functional/manifest.json).
// Manifest plan #0 — functional test for R-01.
// inputHash 0b37d2cd58732fc5 — regenerated only when grounded inputs change (R-119).
import { describe, it, expect } from "vitest";

const publisherBase = process.env.PUBLISHER_API_URL;
const publisherToken = process.env.PUBLISHER_TOKEN;
const consumerBase = process.env.CONSUMER_API_URL;
const consumerToken = process.env.CONSUMER_TOKEN;
// Skipped (not failed) when cross-service credentials are absent — R-83a, D-26.
const ready = Boolean(publisherBase && publisherToken && consumerBase && consumerToken);

// Setup / preconditions:
//   - Ensure the publisher service is running and reachable, with CDC pipeline active and connected to the consumer service.
//   - Ensure the consumer service is running and reachable at its live API target /me/classes.
//   - Confirm the ODCS v3.1.0 JSON schema is available for contract validation.
//   - Ensure no pre-existing class record with the test sourcedId exists on either publisher or consumer to avoid state collisions.
//   - Confirm the CDC lag/propagation window is known and a suitable wait period is configured before consumer assertions are made.
describe.skipIf(!ready)("functional: CDC propagation of a new `class` entity from publisher to consumer, validated against the ODCS v3.1.0 contract", () => {
  it("POST /classes → CDC → consumer reflects change", async () => {
    // TRIGGER (publisher/class): POST /classes
    // payload shape: JSON object containing all required fields: sourcedId (string), status (string), dateLastModified (date), title (string), classType (string), course (object), school (object), terms (non-empty array); optionally includes classCode (string), grades (array), location (string), metadata (object), subjects (array)
    const res = await fetch(`${publisherBase}/classes`, {
      method: "POST",
      headers: { Authorization: `Bearer ${publisherToken}`, "Content-Type": "application/json" },
      // body: JSON.stringify(/* JSON object containing all required fields: sourcedId (string), status (string), dateLastModified (date), title (string), classType (string), course (object), school (object), terms (non-empty array); optionally includes classCode (string), grades (array), location (string), metadata (object), subjects (array) */),
    });
    expect(res.ok, `POST /classes → ${res.status}`).toBe(true);
    // PROPAGATION (cdc): CDC pipeline delivers the new class record from publisher to consumer
  });

  // Post-propagation assertions — a runner fills these in (D-56):
  it.todo("[publisher] The POST response status is 2xx, confirming the class entity was accepted and persisted by the publisher.");
  it.todo("[publisher] The response body includes the created class record with all submitted required fields (sourcedId, status, dateLastModified, title, classType, course, school, terms) matching the submitted values.");
  it.todo("[consumer] After CDC propagation, a GET to /me/classes returns a 2xx response and the 'items' array contains an entry whose sourcedId matches the one created on the publisher.");
  it.todo("[consumer] The matching class record in 'items' contains all required ODCS contract fields: sourcedId (string), status (string), dateLastModified (date), title (string), classType (string), course (object), school (object), terms (array).");
  it.todo("[consumer] Each required field in the propagated class record is non-null and conforms to its declared ODCS v3.1.0 type: sourcedId and status and title and classType are strings; dateLastModified is a valid date; course and school are objects; terms is a non-empty array.");
  it.todo("[consumer] Optional fields present in the publisher payload (classCode, grades, location, metadata, subjects) are also present in the consumer record and match their published values, confirming full contract mirroring of the producer's shape.");
  it.todo("[consumer] The full class record as received at /me/classes (items entry) validates without errors against the official ODCS v3.1.0 JSON schema, confirming the consumer contract is structurally equivalent to the producer's org contract shape.");
});
