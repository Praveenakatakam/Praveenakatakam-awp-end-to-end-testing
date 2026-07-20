// GENERATED — DO NOT EDIT. Regenerate via `npm run generate-tests -- --functional` (see generated-tests/functional/manifest.json).
// Manifest plan #3 — functional test for R-06.
// inputHash 3814f8e76e03d7f4 — regenerated only when grounded inputs change (R-119).
import { describe, it, expect } from "vitest";

const publisherBase = process.env.PUBLISHER_API_URL;
const publisherToken = process.env.PUBLISHER_TOKEN;
const consumerBase = process.env.CONSUMER_API_URL;
const consumerToken = process.env.CONSUMER_TOKEN;
// Skipped (not failed) when cross-service credentials are absent — R-83a, D-26.
const ready = Boolean(publisherBase && publisherToken && consumerBase && consumerToken);

// Setup / preconditions:
//   - Ensure the publisher service is running and reachable at its live API base URL with access to the /orgs endpoint.
//   - Ensure the consumer service is running and connected to the CDC pipeline that receives org change events from the publisher.
//   - Ensure no pre-existing org record shares the sourcedId value chosen for this test, guaranteeing uniqueness preconditions are clean.
//   - Confirm CDC infrastructure (e.g. event bus / outbox) is active and capable of propagating org write events from publisher to consumer.
describe.skipIf(!ready)("functional: R-06: sourcedId declared as unique primary key of the org object — CDC propagation from publisher to consumer", () => {
  it("POST /orgs → CDC → consumer reflects change", async () => {
    // TRIGGER (publisher/org): POST /orgs
    // payload shape: A JSON object representing a new org with all required fields: sourcedId (a unique string acting as primary key), name (string), status (string), type (string), and dateLastModified (date). Optional fields such as identifier, metadata, parent, and children may be omitted.
    const res = await fetch(`${publisherBase}/orgs`, {
      method: "POST",
      headers: { Authorization: `Bearer ${publisherToken}`, "Content-Type": "application/json" },
      // body: JSON.stringify(/* A JSON object representing a new org with all required fields: sourcedId (a unique string acting as primary key), name (string), status (string), type (string), and dateLastModified (date). Optional fields such as identifier, metadata, parent, and children may be omitted. */),
    });
    expect(res.ok, `POST /orgs → ${res.status}`).toBe(true);
    // PROPAGATION (cdc): Consumer service has received and processed the CDC event for the newly created org identified by the posted sourcedId.
  });

  // Post-propagation assertions — a runner fills these in (D-56):
  it.todo("[publisher] The POST /orgs response returns a success status code (2xx), confirming the org was created.");
  it.todo("[publisher] The created org record returned by the publisher contains a sourcedId field whose value exactly matches the sourcedId provided in the request payload, confirming it is stored as the primary key.");
  it.todo("[publisher] A second POST to /orgs with the same sourcedId value must be rejected (non-2xx, e.g. 409 Conflict), confirming sourcedId uniqueness is enforced at the publisher.");
  it.todo("[consumer] After CDC propagation, the consumer holds an org record whose sourcedId matches the one posted to the publisher, confirming the primary key is preserved end-to-end.");
  it.todo("[consumer] The org record on the consumer side contains all required fields (sourcedId, name, status, type, dateLastModified) with values identical to those sent in the original publisher POST payload.");
  it.todo("[consumer] No duplicate org records with the same sourcedId exist on the consumer, confirming that sourcedId uniqueness semantics are upheld across the CDC boundary.");
});
