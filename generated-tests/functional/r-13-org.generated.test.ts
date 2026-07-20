// GENERATED — DO NOT EDIT. Regenerate via `npm run generate-tests -- --functional` (see generated-tests/functional/manifest.json).
// Manifest plan #5 — functional test for R-13.
// inputHash 58242b462915aaf8 — regenerated only when grounded inputs change (R-119).
import { describe, it, expect } from "vitest";

const publisherBase = process.env.PUBLISHER_API_URL;
const publisherToken = process.env.PUBLISHER_TOKEN;
const consumerBase = process.env.CONSUMER_API_URL;
const consumerToken = process.env.CONSUMER_TOKEN;
// Skipped (not failed) when cross-service credentials are absent — R-83a, D-26.
const ready = Boolean(publisherBase && publisherToken && consumerBase && consumerToken);

// Setup / preconditions:
//   - Ensure no org with the test sourcedId (e.g. 'test-org-001') exists on the publisher or consumer before the test begins; delete or confirm absence via the publisher's GET /orgs endpoint filtering by sourcedId.
//   - Record the current item count at publisher GET /orgs to use as a baseline for assertions.
//   - Confirm the CDC pipeline between publisher and consumer is active and healthy, with known maximum propagation latency.
describe.skipIf(!ready)("functional: Cross-service CDC propagation of POST /orgs upsert (create and overwrite) validated against ODCS org schema", () => {
  it("POST /orgs → CDC → consumer reflects change", async () => {
    // TRIGGER (publisher/org): POST /orgs
    // payload shape: JSON object containing all required ODCS org fields: sourcedId (string, unique test value), status (string), dateLastModified (date string), name (string), type (string); optionally including identifier (string), metadata (object), parent (object), children (array)
    const res = await fetch(`${publisherBase}/orgs`, {
      method: "POST",
      headers: { Authorization: `Bearer ${publisherToken}`, "Content-Type": "application/json" },
      // body: JSON.stringify(/* JSON object containing all required ODCS org fields: sourcedId (string, unique test value), status (string), dateLastModified (date string), name (string), type (string); optionally including identifier (string), metadata (object), parent (object), children (array) */),
    });
    expect(res.ok, `POST /orgs → ${res.status}`).toBe(true);
    // PROPAGATION (cdc): CDC pipeline delivers the upserted org record from publisher to consumer; poll or await event confirmation up to the maximum known propagation latency
  });

  // Post-propagation assertions — a runner fills these in (D-56):
  it.todo("[publisher] The POST /orgs response status is 201 Created when the sourcedId did not previously exist, confirming a new org was created.");
  it.todo("[publisher] The response body from POST /orgs includes the org record with all submitted fields (sourcedId, status, dateLastModified, name, type) matching the request payload exactly.");
  it.todo("[publisher] GET /orgs on the publisher returns the newly created org in the 'items' array, with all required fields (sourcedId, status, dateLastModified, name, type) matching the posted values.");
  it.todo("[consumer] After CDC propagation, the consumer's store contains an org record whose sourcedId matches the one posted to the publisher.");
  it.todo("[consumer] The org record on the consumer has name, type, status, and dateLastModified values identical to those submitted in the POST /orgs request payload.");
  it.todo("[publisher] A second POST /orgs with the same sourcedId but updated field values (e.g. a new name and dateLastModified) returns 200 OK, confirming the overwrite/upsert path was taken.");
  it.todo("[publisher] After the overwrite POST, GET /orgs on the publisher returns exactly one org record for that sourcedId (no duplicate), and its fields reflect the updated values from the second POST.");
  it.todo("[consumer] After CDC propagation of the overwrite event, the consumer's org record for the same sourcedId is updated to reflect the new field values from the second POST, with no duplicate records for that sourcedId.");
});
