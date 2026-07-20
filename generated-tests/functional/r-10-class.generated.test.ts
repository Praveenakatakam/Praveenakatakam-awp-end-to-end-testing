// GENERATED — DO NOT EDIT. Regenerate via `npm run generate-tests -- --functional` (see generated-tests/functional/manifest.json).
// Manifest plan #4 — functional test for R-10.
// inputHash 95b05305d16867e3 — regenerated only when grounded inputs change (R-119).
import { describe, it, expect } from "vitest";

const publisherBase = process.env.PUBLISHER_API_URL;
const publisherToken = process.env.PUBLISHER_TOKEN;
const consumerBase = process.env.CONSUMER_API_URL;
const consumerToken = process.env.CONSUMER_TOKEN;
// Skipped (not failed) when cross-service credentials are absent — R-83a, D-26.
const ready = Boolean(publisherBase && publisherToken && consumerBase && consumerToken);

// Setup / preconditions:
//   - Ensure the `class-events` SNS topic is active and the subscriber Lambda is deployed and wired to the consumer ingestion pipeline.
//   - Ensure the consumer service is running and its `/me/classes` endpoint is reachable.
//   - Prepare a valid class payload satisfying all required ODCS fields: classType, course (object), dateLastModified (date), school (object), sourcedId (string), status (string), terms (array), and title (string).
//   - Record any pre-existing class records on the consumer via GET /me/classes so that the new record can be distinguished after propagation.
describe.skipIf(!ready)("functional: CDC propagation: publisher emits class event on `class-events` topic → consumer ingester parses envelope and validates class data against ODCS schema", () => {
  it("POST /me/classes → CDC → consumer reflects change", async () => {
    // TRIGGER (publisher/class): POST /me/classes
    // payload shape: An SNS-envelope-wrapped class object containing all required ODCS fields: sourcedId (string), status (string), title (string), classType (string), course (object), school (object), terms (array), dateLastModified (date); optionally including classCode (string), grades (array), location (string), metadata (object), subjects (array).
    const res = await fetch(`${publisherBase}/me/classes`, {
      method: "POST",
      headers: { Authorization: `Bearer ${publisherToken}`, "Content-Type": "application/json" },
      // body: JSON.stringify(/* An SNS-envelope-wrapped class object containing all required ODCS fields: sourcedId (string), status (string), title (string), classType (string), course (object), school (object), terms (array), dateLastModified (date); optionally including classCode (string), grades (array), location (string), metadata (object), subjects (array). */),
    });
    expect(res.ok, `POST /me/classes → ${res.status}`).toBe(true);
    // PROPAGATION (cdc): Subscriber Lambda on `class-events` topic completes invocation and the consumer store reflects the ingested record
  });

  // Post-propagation assertions — a runner fills these in (D-56):
  it.todo("[consumer] After CDC propagation, GET /me/classes returns a response whose `items` array contains a record matching the sourcedId published by the publisher.");
  it.todo("[consumer] The ingested class record in `items` has a non-null `classType` field matching the value supplied in the published payload.");
  it.todo("[consumer] The ingested class record in `items` has a `course` field of type object, matching the value supplied in the published payload.");
  it.todo("[consumer] The ingested class record in `items` has a `dateLastModified` field that is a valid date value matching the value supplied in the published payload.");
  it.todo("[consumer] The ingested class record in `items` has a `school` field of type object, matching the value supplied in the published payload.");
  it.todo("[consumer] The ingested class record in `items` has a `status` field matching the value supplied in the published payload.");
  it.todo("[consumer] The ingested class record in `items` has a `terms` field of type array, matching the value supplied in the published payload.");
  it.todo("[consumer] The ingested class record in `items` has a `title` field matching the value supplied in the published payload.");
  it.todo("[consumer] If optional fields (classCode, grades, location, metadata, subjects) were included in the published payload, confirm they appear with correct types (string, array, string, object, array respectively) in the ingested record in `items`.");
  it.todo("[consumer] No schema-validation error is logged or surfaced by the ingester Lambda for the delivered class message; the record is stored without rejection.");
});
