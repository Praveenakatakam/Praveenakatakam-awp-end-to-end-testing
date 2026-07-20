// GENERATED — DO NOT EDIT. Regenerate via `npm run generate-tests -- --functional` (see generated-tests/functional/manifest.json).
// Manifest plan #34 — functional test for R-71a, D-13.
// inputHash 02ce5eea3ef3977c — regenerated only when grounded inputs change (R-119).
import { describe, it, expect } from "vitest";

const publisherBase = process.env.PUBLISHER_API_URL;
const publisherToken = process.env.PUBLISHER_TOKEN;
const consumerBase = process.env.CONSUMER_API_URL;
const consumerToken = process.env.CONSUMER_TOKEN;
// Skipped (not failed) when cross-service credentials are absent — R-83a, D-26.
const ready = Boolean(publisherBase && publisherToken && consumerBase && consumerToken);

// Setup / preconditions:
//   - Ensure the publisher service is configured and connected to SNS with CDC enabled for the class entity.
//   - Ensure the consumer service is subscribed to the SNS topic that receives class entity change events.
//   - Ensure a valid class record does not already exist with the test sourcedId to guarantee a clean state.
//   - Confirm the consumer endpoint GET /me/classes is reachable and returns a JSON body with an 'items' array.
describe.skipIf(!ready)("functional: CDC propagation of class entity verifies SNS message attributes eventType and classType are set on publish", () => {
  it("POST /classes → CDC → consumer reflects change", async () => {
    // TRIGGER (publisher/class): POST /classes
    // payload shape: JSON object containing required fields: sourcedId (string), status (string), dateLastModified (date), title (string), classType (string), course (object), school (object), terms (array); optionally includes classCode (string), grades (array), location (string), metadata (object), subjects (array)
    const res = await fetch(`${publisherBase}/classes`, {
      method: "POST",
      headers: { Authorization: `Bearer ${publisherToken}`, "Content-Type": "application/json" },
      // body: JSON.stringify(/* JSON object containing required fields: sourcedId (string), status (string), dateLastModified (date), title (string), classType (string), course (object), school (object), terms (array); optionally includes classCode (string), grades (array), location (string), metadata (object), subjects (array) */),
    });
    expect(res.ok, `POST /classes → ${res.status}`).toBe(true);
    // PROPAGATION (cdc): SNS message published and consumer has processed the CDC event for the new class sourcedId
  });

  // Post-propagation assertions — a runner fills these in (D-56):
  it.todo("[publisher] The SNS message published for the class creation event MUST include a message attribute named 'eventType' with a non-empty string value (e.g. representing the create/upsert event type for the class entity).");
  it.todo("[publisher] The SNS message published for the class creation event MUST include a message attribute named 'classType' whose value exactly matches the value of data.classType supplied in the trigger payload.");
  it.todo("[publisher] The SNS message published for the class creation event MUST NOT include a message attribute named 'role', as that discriminator applies only to the enrollment entity.");
  it.todo("[consumer] After CDC propagation, a GET to /me/classes must return a response where the 'items' array contains an entry whose 'sourcedId' matches the sourcedId used in the trigger payload.");
  it.todo("[consumer] The matching class entry in the consumer's /me/classes 'items' array must have a 'classType' field whose value equals the classType value submitted by the publisher in the trigger payload.");
  it.todo("[consumer] The matching class entry in the consumer's /me/classes 'items' array must have 'status', 'title', 'course', 'school', and 'terms' fields consistent with the values submitted by the publisher in the trigger payload.");
});
