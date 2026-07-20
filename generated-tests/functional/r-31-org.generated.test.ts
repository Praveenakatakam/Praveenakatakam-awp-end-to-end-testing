// GENERATED — DO NOT EDIT. Regenerate via `npm run generate-tests -- --functional` (see generated-tests/functional/manifest.json).
// Manifest plan #18 — functional test for R-31.
// inputHash 56a1ac51f94fb52b — regenerated only when grounded inputs change (R-119).
import { describe, it, expect } from "vitest";

const publisherBase = process.env.PUBLISHER_API_URL;
const publisherToken = process.env.PUBLISHER_TOKEN;
const consumerBase = process.env.CONSUMER_API_URL;
const consumerToken = process.env.CONSUMER_TOKEN;
// Skipped (not failed) when cross-service credentials are absent — R-83a, D-26.
const ready = Boolean(publisherBase && publisherToken && consumerBase && consumerToken);

// Setup / preconditions:
//   - Ensure the SNS topic is configured and the consumer is subscribed to receive messages from the publisher's SNS topic.
//   - Ensure the CDC pipeline (Stream → Pipe → Publisher → SNS) is active and healthy.
//   - Ensure no pre-existing org record with the test sourcedId exists in the publisher, to guarantee a clean INSERT event.
//   - Record the current timestamp before triggering the write, to allow assertion on the envelope timestamp ordering.
describe.skipIf(!ready)("functional: CDC Propagation: Publisher publishes INSERT/MODIFY envelope for org entity to SNS, shaped to ODCS org schema", () => {
  it("POST /orgs → CDC → consumer reflects change", async () => {
    // TRIGGER (publisher/org): POST /orgs
    // payload shape: A JSON object representing a new org record conforming to the ODCS org schema, containing all required fields: sourcedId (unique string), name (string), status (string), type (string), dateLastModified (date), and optionally: identifier (string), children (array), parent (object), metadata (object).
    const res = await fetch(`${publisherBase}/orgs`, {
      method: "POST",
      headers: { Authorization: `Bearer ${publisherToken}`, "Content-Type": "application/json" },
      // body: JSON.stringify(/* A JSON object representing a new org record conforming to the ODCS org schema, containing all required fields: sourcedId (unique string), name (string), status (string), type (string), dateLastModified (date), and optionally: identifier (string), children (array), parent (object), metadata (object). */),
    });
    expect(res.ok, `POST /orgs → ${res.status}`).toBe(true);
    // PROPAGATION (cdc): SNS message delivery confirmed on the consumer's subscribed endpoint after the publisher processes the INSERT stream record through the CDC pipeline
  });

  // Post-propagation assertions — a runner fills these in (D-56):
  it.todo("[publisher] The POST to /orgs returns a success response (2xx), and the created org record is retrievable via GET /orgs with all submitted required fields (sourcedId, name, status, type, dateLastModified) present and correct under the 'items' collection.");
  it.todo("[consumer] The consumer receives exactly one SNS envelope message where 'eventType' is 'INSERT', confirming the stream record type was correctly mapped.");
  it.todo("[consumer] The received SNS envelope contains a 'timestamp' field that is a valid date/datetime value and is not earlier than the timestamp recorded before the trigger was fired.");
  it.todo("[consumer] The received SNS envelope contains a 'sourcedId' field whose value exactly matches the sourcedId supplied in the POST request payload.");
  it.todo("[consumer] The received SNS envelope contains a 'data' object whose fields conform to the ODCS org schema: required fields 'sourcedId', 'name', 'status', 'type', and 'dateLastModified' are all present with values matching the written org record; optional fields 'identifier', 'children', 'parent', and 'metadata' are present only if they were included in the original payload, with correct values and types (children as array, parent as object, metadata as object, identifier as string).");
  it.todo("[consumer] The 'data' object in the envelope does NOT contain any fields outside the ODCS org schema (no extra or invented fields), confirming the new image is correctly shaped to the contract.");
  it.todo("[consumer] After additionally performing a PUT or PATCH on the same org record at /orgs to trigger a MODIFY stream record, the consumer receives a subsequent SNS envelope where 'eventType' is 'MODIFY', 'sourcedId' matches the same record, and 'data' reflects the updated field values shaped to the ODCS org schema.");
});
