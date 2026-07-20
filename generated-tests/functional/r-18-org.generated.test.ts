// GENERATED — DO NOT EDIT. Regenerate via `npm run generate-tests -- --functional` (see generated-tests/functional/manifest.json).
// Manifest plan #9 — functional test for R-18.
// inputHash e895a98ad7383ef2 — regenerated only when grounded inputs change (R-119).
import { describe, it, expect } from "vitest";

const publisherBase = process.env.PUBLISHER_API_URL;
const publisherToken = process.env.PUBLISHER_TOKEN;
const consumerBase = process.env.CONSUMER_API_URL;
const consumerToken = process.env.CONSUMER_TOKEN;
// Skipped (not failed) when cross-service credentials are absent — R-83a, D-26.
const ready = Boolean(publisherBase && publisherToken && consumerBase && consumerToken);

// Setup / preconditions:
//   - Ensure an org with a known sourcedId already exists in the publisher datastore (e.g., pre-created via POST /orgs) so that the PUT target is an existing record.
//   - Record the current field values of the existing org (name, type, status, dateLastModified, etc.) so that post-PUT state can be compared against the replacement values.
//   - Confirm the consumer service's CDC pipeline is active and subscribed to org change events from the publisher.
describe.skipIf(!ready)("functional: PUT /orgs/{sourcedId} — existing org is replaced and propagates to consumer via CDC", () => {
  it("PUT /orgs/{sourcedId} → CDC → consumer reflects change", async () => {
    // TRIGGER (publisher/org): PUT /orgs/{sourcedId}
    // payload shape: Full org replacement body containing all required fields: sourcedId (matching path param), name, status, type, dateLastModified (updated timestamp); optionally includes identifier, metadata, parent, children.
    const res = await fetch(`${publisherBase}/orgs/{sourcedId}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${publisherToken}`, "Content-Type": "application/json" },
      // body: JSON.stringify(/* Full org replacement body containing all required fields: sourcedId (matching path param), name, status, type, dateLastModified (updated timestamp); optionally includes identifier, metadata, parent, children. */),
    });
    expect(res.ok, `PUT /orgs/{sourcedId} → ${res.status}`).toBe(true);
    // PROPAGATION (cdc): Consumer has received and applied the CDC event for the updated org sourcedId.
  });

  // Post-propagation assertions — a runner fills these in (D-56):
  it.todo("[publisher] HTTP response status is 200 OK.");
  it.todo("[publisher] The response body represents the replaced org and contains the sourcedId matching the path parameter.");
  it.todo("[publisher] The org's name, type, status, and dateLastModified in the response match exactly the values supplied in the PUT request body.");
  it.todo("[publisher] A subsequent GET /orgs/{sourcedId} on the publisher returns the org with the updated field values (name, type, status, dateLastModified) from the PUT body, confirming full replacement in the datastore.");
  it.todo("[consumer] The consumer's org record for the same sourcedId reflects the replaced values: name, type, status, and dateLastModified match those sent in the PUT request body.");
  it.todo("[consumer] No duplicate org entries exist for the same sourcedId on the consumer; only the single replaced record is present.");
  it.todo("[consumer] Fields not included in the PUT body (e.g., parent, children, metadata, identifier) are stored on the consumer exactly as provided in the replacement payload (absent or null if omitted), confirming full replacement semantics rather than partial merge.");
});
