// GENERATED — DO NOT EDIT. Regenerate via `npm run generate-tests -- --functional` (see generated-tests/functional/manifest.json).
// Manifest plan #24 — functional test for R-50.
// inputHash cdf0929e714418eb — regenerated only when grounded inputs change (R-119).
import { describe, it, expect } from "vitest";

const publisherBase = process.env.PUBLISHER_API_URL;
const publisherToken = process.env.PUBLISHER_TOKEN;
const consumerBase = process.env.CONSUMER_API_URL;
const consumerToken = process.env.CONSUMER_TOKEN;
// Skipped (not failed) when cross-service credentials are absent — R-83a, D-26.
const ready = Boolean(publisherBase && publisherToken && consumerBase && consumerToken);

// Setup / preconditions:
//   - Ensure the publisher service is running and its ODCS data contract for the `class` entity is registered, conforming to apiVersion: v3.1.0 and kind: DataContract.
//   - Ensure the consumer service is running and subscribed to CDC events for the `class` entity from the publisher.
//   - Ensure no pre-existing `class` record with the test sourcedId exists on either publisher or consumer to avoid collision.
//   - Confirm the CDC pipeline (e.g., message broker / change-data-capture stream) between publisher and consumer is healthy and latency bounds are known.
describe.skipIf(!ready)("functional: CDC propagation of a new `class` entity from publisher to consumer, validating ODCS v3.1.0 contract conformance", () => {
  it("POST /classes → CDC → consumer reflects change", async () => {
    // TRIGGER (publisher/class): POST /classes
    // payload shape: JSON object containing all required fields: sourcedId (string), status (string), dateLastModified (date), title (string), classType (string), course (object with at minimum a sourcedId reference), school (object with at minimum a sourcedId reference), terms (non-empty array of term references); optional fields: classCode (string), grades (array), location (string), metadata (object), subjects (array)
    const res = await fetch(`${publisherBase}/classes`, {
      method: "POST",
      headers: { Authorization: `Bearer ${publisherToken}`, "Content-Type": "application/json" },
      // body: JSON.stringify(/* JSON object containing all required fields: sourcedId (string), status (string), dateLastModified (date), title (string), classType (string), course (object with at minimum a sourcedId reference), school (object with at minimum a sourcedId reference), terms (non-empty array of term references); optional fields: classCode (string), grades (array), location (string), metadata (object), subjects (array) */),
    });
    expect(res.ok, `POST /classes → ${res.status}`).toBe(true);
    // PROPAGATION (cdc): CDC event for the newly created class sourcedId to be consumed and persisted by the consumer service
  });

  // Post-propagation assertions — a runner fills these in (D-56):
  it.todo("[publisher] The POST /classes response returns HTTP 201 (or 200), and the response body contains the created class record with the same sourcedId supplied in the request payload.");
  it.todo("[publisher] The returned class record includes all required fields — sourcedId, status, dateLastModified, title, classType, course, school, and terms — each populated with values matching those supplied in the trigger payload.");
  it.todo("[consumer] After CDC propagation, a GET /me/classes response returns HTTP 200 and the `items` array contains an entry whose sourcedId matches the sourcedId of the class created on the publisher.");
  it.todo("[consumer] The matching class record in `items` contains all required fields (sourcedId, status, dateLastModified, title, classType, course, school, terms) with values identical to those written by the publisher, confirming lossless CDC propagation.");
  it.todo("[consumer] The matching class record's optional fields (classCode, grades, location, metadata, subjects) — if supplied in the trigger payload — are also present and match the publisher values, confirming no optional fields are dropped during CDC.");
  it.todo("[consumer] The `status` field value on the propagated class record is a valid ODCS-defined status string (e.g., 'active' or 'tobedeleted'), confirming contract-level value conformance.");
  it.todo("[consumer] The `dateLastModified` field on the propagated record is a valid ISO 8601 date string, conforming to the ODCS contract's declared `date` type for that field.");
  it.todo("[consumer] The `course` and `school` fields on the propagated record are objects (not null, not primitives), and the `terms` field is a non-empty array, all consistent with the ODCS v3.1.0 contract schema for `class`.");
});
