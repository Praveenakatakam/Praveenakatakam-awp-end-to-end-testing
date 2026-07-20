// GENERATED — DO NOT EDIT. Regenerate via `npm run generate-tests -- --functional` (see generated-tests/functional/manifest.json).
// Manifest plan #20 — functional test for R-33.
// inputHash 3ec5594b9f5f7a2c — regenerated only when grounded inputs change (R-119).
import { describe, it, expect } from "vitest";

const publisherBase = process.env.PUBLISHER_API_URL;
const publisherToken = process.env.PUBLISHER_TOKEN;
const consumerBase = process.env.CONSUMER_API_URL;
const consumerToken = process.env.CONSUMER_TOKEN;
// Skipped (not failed) when cross-service credentials are absent — R-83a, D-26.
const ready = Boolean(publisherBase && publisherToken && consumerBase && consumerToken);

// Setup / preconditions:
//   - Ensure the publisher service is running and connected to the CDC pipeline (Stream → Pipe → Publisher → SNS).
//   - Ensure the dead-letter queue (DLQ) is accessible and currently empty (or its message count is recorded as a baseline) so new arrivals can be detected.
//   - Ensure the SNS topic used for org publish events is accessible and its message count / delivery log is baselined.
//   - Confirm the ODCS org schema is loaded by the publisher, with required fields: dateLastModified, name, sourcedId, status, type.
//   - Prepare an intentionally invalid org envelope whose `data` payload is missing at least one required field (e.g., omit `status` and `type`) so that schema validation is guaranteed to fail.
describe.skipIf(!ready)("functional: CDC Pipeline: Publisher DLQ Routing on Invalid org Envelope Payload (R-33)", () => {
  it("POST /orgs → CDC → consumer reflects change", async () => {
    // TRIGGER (publisher/org): POST /orgs
    // payload shape: An org envelope object whose `data` field contains an org record missing one or more ODCS-required fields (e.g., `status` and `type` are absent); all other envelope wrapper fields (e.g., sourcedId, name, dateLastModified) may be present but the deliberately invalid `data` payload must fail ODCS org schema validation.
    const res = await fetch(`${publisherBase}/orgs`, {
      method: "POST",
      headers: { Authorization: `Bearer ${publisherToken}`, "Content-Type": "application/json" },
      // body: JSON.stringify(/* An org envelope object whose `data` field contains an org record missing one or more ODCS-required fields (e.g., `status` and `type` are absent); all other envelope wrapper fields (e.g., sourcedId, name, dateLastModified) may be present but the deliberately invalid `data` payload must fail ODCS org schema validation. */),
    });
    expect(res.ok, `POST /orgs → ${res.status}`).toBe(true);
    // PROPAGATION (cdc): Publisher has completed its validation step and made a routing decision (publish to SNS or route to DLQ); allow sufficient time for the CDC pipeline to process and for the DLQ to receive the message if routed.
  });

  // Post-propagation assertions — a runner fills these in (D-56):
  it.todo("[publisher] The publisher's validation step returns a schema-validation failure for the submitted org `data` payload, specifically citing the missing required ODCS fields (e.g., `status`, `type`).");
  it.todo("[publisher] The publisher does NOT emit the invalid org message to the SNS topic; the SNS topic's message count / delivery log remains unchanged from the baseline recorded during setup.");
  it.todo("[publisher] The publisher routes the invalid org envelope to the DLQ; the DLQ contains exactly one new message compared to the baseline, and that message's `data` payload matches the invalid org record that was submitted.");
  it.todo("[publisher] The DLQ message includes sufficient metadata to identify the failure reason (e.g., a validation-error descriptor referencing the ODCS org schema and the specific missing required fields).");
  it.todo("[consumer] The consumer does NOT receive any org update event on its CDC stream for this invalid submission; no new org record corresponding to the submitted sourcedId appears under /orgs `items` on the consumer side.");
});
