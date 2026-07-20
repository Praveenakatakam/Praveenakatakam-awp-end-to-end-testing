// GENERATED — DO NOT EDIT. Regenerate via `npm run generate-tests -- --functional` (see generated-tests/functional/manifest.json).
// Manifest plan #6 — functional test for R-15.
// inputHash 92788e72f3c891ed — regenerated only when grounded inputs change (R-119).
import { describe, it, expect } from "vitest";

const publisherBase = process.env.PUBLISHER_API_URL;
const publisherToken = process.env.PUBLISHER_TOKEN;
const consumerBase = process.env.CONSUMER_API_URL;
const consumerToken = process.env.CONSUMER_TOKEN;
// Skipped (not failed) when cross-service credentials are absent — R-83a, D-26.
const ready = Boolean(publisherBase && publisherToken && consumerBase && consumerToken);

// Setup / preconditions:
//   - Ensure at least one org record exists on the publisher service by creating or confirming an org with known sourcedId, name, status, type, and dateLastModified fields populated to satisfy the contract schema required fields.
//   - Record the sourcedId of the pre-existing or newly created org to be used in the trigger and assertions.
//   - Confirm the CDC pipeline between publisher and consumer is active and healthy before running the test.
describe.skipIf(!ready)("functional: R-15: GET /orgs/{sourcedId} returns 200 OK with org representation, propagated via CDC to consumer", () => {
  it("PUT /orgs/{sourcedId} → CDC → consumer reflects change", async () => {
    // TRIGGER (publisher/org): PUT /orgs/{sourcedId}
    // payload shape: Object containing required fields: sourcedId (string), name (string), status (string), type (string), dateLastModified (date); optional fields: identifier (string), metadata (object), parent (object), children (array)
    const res = await fetch(`${publisherBase}/orgs/{sourcedId}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${publisherToken}`, "Content-Type": "application/json" },
      // body: JSON.stringify(/* Object containing required fields: sourcedId (string), name (string), status (string), type (string), dateLastModified (date); optional fields: identifier (string), metadata (object), parent (object), children (array) */),
    });
    expect(res.ok, `PUT /orgs/{sourcedId} → ${res.status}`).toBe(true);
    // PROPAGATION (cdc): Consumer has received and persisted the org record identified by the known sourcedId
  });

  // Post-propagation assertions — a runner fills these in (D-56):
  it.todo("[publisher] After the write, GET /orgs/{sourcedId} on the publisher returns HTTP 200 OK.");
  it.todo("[publisher] The response body contains an org object whose sourcedId matches the known sourcedId used in the trigger.");
  it.todo("[publisher] The response body org object includes all required fields: sourcedId, name, status, type, and dateLastModified, each with a non-null value matching what was written.");
  it.todo("[publisher] The response body structure is consistent with the contract schema: children is an array (if present), metadata is an object (if present), parent is an object (if present), and identifier is a string (if present).");
  it.todo("[consumer] After CDC propagation, the consumer's store contains an org record with the same sourcedId as written to the publisher.");
  it.todo("[consumer] The consumer's org record has name, status, type, and dateLastModified values that exactly match those written by the publisher.");
  it.todo("[consumer] Optional fields (identifier, metadata, parent, children) on the consumer's org record, if present, match the corresponding values from the publisher's written payload.");
});
