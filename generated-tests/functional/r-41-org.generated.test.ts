// GENERATED — DO NOT EDIT. Regenerate via `npm run generate-tests -- --functional` (see generated-tests/functional/manifest.json).
// Manifest plan #22 — functional test for R-41.
// inputHash b49fe4aa8785a7f1 — regenerated only when grounded inputs change (R-119).
import { describe, it, expect } from "vitest";

const publisherBase = process.env.PUBLISHER_API_URL;
const publisherToken = process.env.PUBLISHER_TOKEN;
const consumerBase = process.env.CONSUMER_API_URL;
const consumerToken = process.env.CONSUMER_TOKEN;
// Skipped (not failed) when cross-service credentials are absent — R-83a, D-26.
const ready = Boolean(publisherBase && publisherToken && consumerBase && consumerToken);

// Setup / preconditions:
//   - Ensure a valid authenticated session/token is available for the publisher service, with sufficient permissions to create and edit orgs.
//   - Ensure the consumer service is running and subscribed to CDC events for the org entity.
//   - Record any pre-existing org entries on both publisher (/orgs) and consumer to establish a baseline for assertions.
describe.skipIf(!ready)("functional: Cross-service CDC propagation: Authenticated org creation on publisher propagates to consumer", () => {
  it("POST /orgs → CDC → consumer reflects change", async () => {
    // TRIGGER (publisher/org): POST /orgs
    // payload shape: An object containing all required org fields: sourcedId (string), status (string), dateLastModified (date), name (string), type (string); optionally including identifier (string), children (array), parent (object), and metadata (object).
    const res = await fetch(`${publisherBase}/orgs`, {
      method: "POST",
      headers: { Authorization: `Bearer ${publisherToken}`, "Content-Type": "application/json" },
      // body: JSON.stringify(/* An object containing all required org fields: sourcedId (string), status (string), dateLastModified (date), name (string), type (string); optionally including identifier (string), children (array), parent (object), and metadata (object). */),
    });
    expect(res.ok, `POST /orgs → ${res.status}`).toBe(true);
    // PROPAGATION (cdc): Consumer service reflects the newly created org record, detectable by querying the consumer's org list and finding the matching sourcedId.
  });

  // Post-propagation assertions — a runner fills these in (D-56):
  it.todo("[publisher] After POST /orgs, the response status is 2xx and the returned org object contains all submitted fields: sourcedId, status, dateLastModified, name, and type match the values sent in the request payload.");
  it.todo("[publisher] GET /orgs returns a collection under 'items' that includes the newly created org, identified by its sourcedId, with name, type, status, dateLastModified, and any optional fields (identifier, children, parent, metadata) matching the created values.");
  it.todo("[consumer] After CDC propagation, the consumer's org list includes a record whose sourcedId matches the newly created org's sourcedId.");
  it.todo("[consumer] The propagated org record on the consumer has name, type, status, and dateLastModified values that exactly match those submitted by the publisher.");
  it.todo("[consumer] If optional fields (identifier, children, parent, metadata) were included in the publisher POST payload, the propagated consumer record reflects those same values without loss or corruption.");
});
