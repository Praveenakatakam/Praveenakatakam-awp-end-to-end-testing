// GENERATED — DO NOT EDIT. Regenerate via `npm run generate-tests -- --functional` (see generated-tests/functional/manifest.json).
// Manifest plan #10 — functional test for R-19, R-32.
// inputHash c2b01fe5ba614ef2 — regenerated only when grounded inputs change (R-119).
import { describe, it, expect } from "vitest";

const publisherBase = process.env.PUBLISHER_API_URL;
const publisherToken = process.env.PUBLISHER_TOKEN;
const consumerBase = process.env.CONSUMER_API_URL;
const consumerToken = process.env.CONSUMER_TOKEN;
// Skipped (not failed) when cross-service credentials are absent — R-83a, D-26.
const ready = Boolean(publisherBase && publisherToken && consumerBase && consumerToken);

// Setup / preconditions:
//   - Ensure a valid org record exists on the publisher with a known sourcedId (e.g. pre-created via POST /orgs or seeded directly in DynamoDB), containing all required fields: sourcedId, name, status, type, dateLastModified.
//   - Record the target org's sourcedId for use in the DELETE request and subsequent assertions.
//   - Confirm the org is currently readable on the publisher by issuing GET /orgs/{sourcedId} and receiving a 200 response with the correct item.
//   - Confirm the consumer's data store reflects the org's presence (e.g. it was previously synced via a prior CDC event) so absence after the delete can be meaningfully asserted.
//   - Set up a CDC event monitor/listener on the SNS topic (or equivalent CDC propagation channel) to capture any events that arrive after the DELETE is triggered, for the duration of the propagation wait window.
describe.skipIf(!ready)("functional: DELETE /orgs/{sourcedId} hard-deletes the org, returns 200 OK, and emits no CDC event to the consumer", () => {
  it("DELETE /orgs/{sourcedId} → CDC → consumer reflects change", async () => {
    // TRIGGER (publisher/org): DELETE /orgs/{sourcedId}
    // payload shape: No request body; the target org is identified solely by the {sourcedId} path parameter.
    const res = await fetch(`${publisherBase}/orgs/{sourcedId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${publisherToken}`, "Content-Type": "application/json" },
      // body: JSON.stringify(/* No request body; the target org is identified solely by the {sourcedId} path parameter. */),
    });
    expect(res.ok, `DELETE /orgs/{sourcedId} → ${res.status}`).toBe(true);
    // PROPAGATION (cdc): Wait the full CDC propagation window (e.g. 30 seconds) to allow any potential DynamoDB Stream REMOVE record processing to complete and confirm no SNS publish occurs.
  });

  // Post-propagation assertions — a runner fills these in (D-56):
  it.todo("[publisher] The DELETE /orgs/{sourcedId} response status code is exactly 200 OK.");
  it.todo("[publisher] After the DELETE, issuing GET /orgs/{sourcedId} on the publisher returns a 404 or empty result, confirming the org has been hard-deleted from DynamoDB and is no longer retrievable.");
  it.todo("[publisher] The org's sourcedId no longer appears in the 'items' array returned by GET /orgs on the publisher.");
  it.todo("[consumer] No CDC event (SNS message or equivalent) referencing the deleted org's sourcedId was received on the consumer during the propagation wait window — confirming that the DynamoDB Stream REMOVE record was NOT published to SNS per R-32.");
  it.todo("[consumer] The consumer's data store still contains whatever state it held for the org prior to the DELETE (i.e. it was not updated or removed via CDC), because no delete CDC event was propagated.");
});
