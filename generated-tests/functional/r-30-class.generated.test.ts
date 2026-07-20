// GENERATED — DO NOT EDIT. Regenerate via `npm run generate-tests -- --functional` (see generated-tests/functional/manifest.json).
// Manifest plan #16 — functional test for R-30.
// inputHash fd168565ef9d7e3e — regenerated only when grounded inputs change (R-119).
import { describe, it, expect } from "vitest";

const publisherBase = process.env.PUBLISHER_API_URL;
const publisherToken = process.env.PUBLISHER_TOKEN;
const consumerBase = process.env.CONSUMER_API_URL;
const consumerToken = process.env.CONSUMER_TOKEN;
// Skipped (not failed) when cross-service credentials are absent — R-83a, D-26.
const ready = Boolean(publisherBase && publisherToken && consumerBase && consumerToken);

// Setup / preconditions:
//   - Ensure the rostering store (consumer) is accessible at /me/classes and no pre-existing class record exists for the test sourcedId that will be used in the trigger.
//   - Ensure the publisher CDC pipeline is active and configured to emit `class` events to the consumer rostering store.
//   - Prepare a valid class payload with all required fields: sourcedId, status, dateLastModified, title, classType, course (GUIDRef object), school (GUIDRef object), and terms (array of GUIDRef objects), plus an optional classCode.
describe.skipIf(!ready)("functional: CDC propagation of a valid `class` event persists class keyed by sourcedId with required fields in the rostering store", () => {
  it("POST /me/classes → CDC → consumer reflects change", async () => {
    // TRIGGER (publisher/class): POST /me/classes
    // payload shape: Object containing: sourcedId (required, string, unique identifier), status (required, string), dateLastModified (required, date), title (required, string), classType (required, string), classCode (string), course (required, GUIDRef object), school (required, GUIDRef object), terms (required, array of GUIDRef objects)
    const res = await fetch(`${publisherBase}/me/classes`, {
      method: "POST",
      headers: { Authorization: `Bearer ${publisherToken}`, "Content-Type": "application/json" },
      // body: JSON.stringify(/* Object containing: sourcedId (required, string, unique identifier), status (required, string), dateLastModified (required, date), title (required, string), classType (required, string), classCode (string), course (required, GUIDRef object), school (required, GUIDRef object), terms (required, array of GUIDRef objects) */),
    });
    expect(res.ok, `POST /me/classes → ${res.status}`).toBe(true);
    // PROPAGATION (cdc): CDC pipeline delivers the class event to the consumer rostering store
  });

  // Post-propagation assertions — a runner fills these in (D-56):
  it.todo("[consumer] A GET to /me/classes returns a response whose `items` array contains a record whose `sourcedId` exactly matches the sourcedId submitted in the trigger payload.");
  it.todo("[consumer] The matched record in `items` has a `title` field whose value exactly matches the `title` submitted in the trigger payload.");
  it.todo("[consumer] The matched record in `items` has a `classCode` field whose value exactly matches the `classCode` submitted in the trigger payload.");
  it.todo("[consumer] The matched record in `items` has a `classType` field whose value exactly matches the `classType` submitted in the trigger payload.");
  it.todo("[consumer] The matched record in `items` has a `course` field that is a GUIDRef object whose identifier matches the `course` GUIDRef submitted in the trigger payload.");
  it.todo("[consumer] The matched record in `items` has a `school` field that is a GUIDRef object whose identifier matches the `school` GUIDRef submitted in the trigger payload.");
  it.todo("[consumer] The matched record in `items` has a `terms` field that is a non-empty array of GUIDRef objects whose identifiers match those of the `terms` array submitted in the trigger payload.");
  it.todo("[consumer] The matched record in `items` is keyed (retrievable) by its `sourcedId`, confirming persistence in the rostering store under that key.");
});
