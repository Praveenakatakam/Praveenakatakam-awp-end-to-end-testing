// GENERATED — DO NOT EDIT. Regenerate via `npm run generate-tests -- --functional` (see generated-tests/functional/manifest.json).
// Manifest plan #12 — functional test for R-21.
// inputHash e377816f6f66b035 — regenerated only when grounded inputs change (R-119).
import { describe, it, expect } from "vitest";

const publisherBase = process.env.PUBLISHER_API_URL;
const publisherToken = process.env.PUBLISHER_TOKEN;
const consumerBase = process.env.CONSUMER_API_URL;
const consumerToken = process.env.CONSUMER_TOKEN;
// Skipped (not failed) when cross-service credentials are absent — R-83a, D-26.
const ready = Boolean(publisherBase && publisherToken && consumerBase && consumerToken);

// Setup / preconditions:
//   - Record the current UTC timestamp (T_before) immediately before issuing the write request to the publisher.
//   - Ensure no org with the test sourcedId exists on the publisher; if one does, delete it or use a unique sourcedId to guarantee a clean state.
//   - Prepare a request payload that includes a deliberately incorrect/stale dateLastModified value (e.g. a date far in the past such as 2000-01-01) to confirm the server ignores it.
describe.skipIf(!ready)("functional: Server-side dateLastModified is set on org create/update, ignoring any client-supplied value", () => {
  it("POST /orgs → CDC → consumer reflects change", async () => {
    // TRIGGER (publisher/org): POST /orgs
    // payload shape: Object with required fields: sourcedId (unique string), status (string), name (string), type (string), dateLastModified (intentionally stale/incorrect UTC date string); optionally: identifier (string), children (array), parent (object), metadata (object)
    const res = await fetch(`${publisherBase}/orgs`, {
      method: "POST",
      headers: { Authorization: `Bearer ${publisherToken}`, "Content-Type": "application/json" },
      // body: JSON.stringify(/* Object with required fields: sourcedId (unique string), status (string), name (string), type (string), dateLastModified (intentionally stale/incorrect UTC date string); optionally: identifier (string), children (array), parent (object), metadata (object) */),
    });
    expect(res.ok, `POST /orgs → ${res.status}`).toBe(true);
    // PROPAGATION (cdc): CDC pipeline delivers the newly created/updated org record to the consumer, confirmed when the consumer can retrieve the org by its sourcedId
  });

  // Post-propagation assertions — a runner fills these in (D-56):
  it.todo("[publisher] The HTTP response status code is 2xx (201 Created or 200 OK).");
  it.todo("[publisher] The response body contains the org record with a dateLastModified field that is a valid UTC timestamp.");
  it.todo("[publisher] The dateLastModified value in the response is NOT equal to the client-supplied stale date (e.g. 2000-01-01); it must reflect the server-generated timestamp.");
  it.todo("[publisher] The dateLastModified value in the response is greater than or equal to T_before and less than or equal to T_after (timestamp recorded immediately after the request completes), confirming server set it to the current UTC time.");
  it.todo("[publisher] All other required fields (sourcedId, status, name, type) in the response match the values supplied in the request payload.");
  it.todo("[consumer] After CDC propagation, the consumer's copy of the org (retrieved by sourcedId) contains a dateLastModified field equal to the server-generated value observed in the publisher response, not the client-supplied stale date.");
  it.todo("[consumer] The consumer's org record contains all required fields (sourcedId, status, name, type, dateLastModified) with values consistent with those returned by the publisher.");
  it.todo("[consumer] If the same org is subsequently updated via PUT/PATCH on the publisher with another stale dateLastModified value, the consumer reflects the new server-generated dateLastModified (more recent than the first), confirming the behaviour holds for updates as well.");
});
