// GENERATED — DO NOT EDIT. Regenerate via `npm run generate-tests -- --functional` (see generated-tests/functional/manifest.json).
// Manifest plan #15 — functional test for R-28, R-17b.
// inputHash b8e44b06beadb055 — regenerated only when grounded inputs change (R-119).
import { describe, it, expect } from "vitest";

const publisherBase = process.env.PUBLISHER_API_URL;
const publisherToken = process.env.PUBLISHER_TOKEN;
const consumerBase = process.env.CONSUMER_API_URL;
const consumerToken = process.env.CONSUMER_TOKEN;
// Skipped (not failed) when cross-service credentials are absent — R-83a, D-26.
const ready = Boolean(publisherBase && publisherToken && consumerBase && consumerToken);

// Setup / preconditions:
//   - Ensure the publisher DynamoDB table has a Global Secondary Index (GSI) partitioned on the `type` field, as required by R-28.
//   - Ensure the consumer service is subscribed to CDC events originating from the publisher org table.
//   - Record (or clear) any pre-existing org records with the target `type` value (e.g. 'department') on both publisher and consumer to establish a clean baseline count.
describe.skipIf(!ready)("functional: GSI on `type` propagates org write and supports GET /orgs?type= query on consumer", () => {
  it("POST /orgs → CDC → consumer reflects change", async () => {
    // TRIGGER (publisher/org): POST /orgs
    // payload shape: JSON object containing all required org fields: sourcedId (unique string), name (non-empty string), type (string — the value to be queried via GSI, e.g. 'department'), status (string), dateLastModified (ISO-8601 date string); optional fields: identifier, children (array), metadata (object), parent (object)
    const res = await fetch(`${publisherBase}/orgs`, {
      method: "POST",
      headers: { Authorization: `Bearer ${publisherToken}`, "Content-Type": "application/json" },
      // body: JSON.stringify(/* JSON object containing all required org fields: sourcedId (unique string), name (non-empty string), type (string — the value to be queried via GSI, e.g. 'department'), status (string), dateLastModified (ISO-8601 date string); optional fields: identifier, children (array), metadata (object), parent (object) */),
    });
    expect(res.ok, `POST /orgs → ${res.status}`).toBe(true);
    // PROPAGATION (cdc): CDC event emitted from publisher DynamoDB org table is consumed and the consumer's data store reflects the new org record
  });

  // Post-propagation assertions — a runner fills these in (D-56):
  it.todo("[publisher] GET /orgs?type=<posted type value> on the publisher returns HTTP 200 and the response body contains an `items` array that includes the newly created org record, identified by its `sourcedId`, confirming the GSI on `type` routes the query correctly.");
  it.todo("[publisher] The org record returned in `items` from GET /orgs?type=<posted type value> contains all required fields (sourcedId, name, type, status, dateLastModified) matching the values supplied in the POST payload.");
  it.todo("[publisher] GET /orgs?type=<a different type value not used in the POST> returns HTTP 200 with an `items` array that does NOT contain the newly created org's `sourcedId`, confirming the GSI partition correctly isolates records by `type`.");
  it.todo("[consumer] After CDC propagation, GET /orgs?type=<posted type value> on the consumer returns HTTP 200 and the `items` array includes the newly created org record identified by its `sourcedId`.");
  it.todo("[consumer] The org record surfaced on the consumer via the type-filtered query contains field values (sourcedId, name, type, status, dateLastModified) consistent with the original POST payload sent to the publisher, confirming data fidelity through CDC.");
});
