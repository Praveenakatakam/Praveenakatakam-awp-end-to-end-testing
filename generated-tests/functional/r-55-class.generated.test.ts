// GENERATED — DO NOT EDIT. Regenerate via `npm run generate-tests -- --functional` (see generated-tests/functional/manifest.json).
// Manifest plan #29 — functional test for R-55.
// inputHash b519fff0fd0e13f7 — regenerated only when grounded inputs change (R-119).
import { describe, it, expect } from "vitest";

const publisherBase = process.env.PUBLISHER_API_URL;
const publisherToken = process.env.PUBLISHER_TOKEN;
const consumerBase = process.env.CONSUMER_API_URL;
const consumerToken = process.env.CONSUMER_TOKEN;
// Skipped (not failed) when cross-service credentials are absent — R-83a, D-26.
const ready = Boolean(publisherBase && publisherToken && consumerBase && consumerToken);

// Setup / preconditions:
//   - Ensure the publisher service is running and accessible with valid authentication credentials.
//   - Ensure the consumer service is running and accessible at /me/classes with valid authentication credentials.
//   - Ensure CDC pipeline between publisher and consumer is active and healthy.
//   - Prepare a unique GUID to be used as sourcedId for the test class record, ensuring it does not already exist in either service.
//   - Prepare valid GUIDRef objects for course, school, and terms[] fields — each with the correct GUIDRef shape (i.e., sourcedId, type, and href fields as defined by D-8) but not necessarily referencing real resolved entities.
describe.skipIf(!ready)("functional: R-55: class.sourcedId as primary key and GUIDRef shape validation propagates via CDC from publisher to consumer", () => {
  it("POST /classes → CDC → consumer reflects change", async () => {
    // TRIGGER (publisher/class): POST /classes
    // payload shape: JSON object containing: sourcedId (required, unique GUID string), status (required, string), dateLastModified (required, ISO-8601 date string), title (required, string), classType (required, string), course (required, GUIDRef object with sourcedId/type/href), school (required, GUIDRef object with sourcedId/type/href), terms (required, non-empty array of GUIDRef objects each with sourcedId/type/href), and optionally classCode, grades, location, metadata, subjects
    const res = await fetch(`${publisherBase}/classes`, {
      method: "POST",
      headers: { Authorization: `Bearer ${publisherToken}`, "Content-Type": "application/json" },
      // body: JSON.stringify(/* JSON object containing: sourcedId (required, unique GUID string), status (required, string), dateLastModified (required, ISO-8601 date string), title (required, string), classType (required, string), course (required, GUIDRef object with sourcedId/type/href), school (required, GUIDRef object with sourcedId/type/href), terms (required, non-empty array of GUIDRef objects each with sourcedId/type/href), and optionally classCode, grades, location, metadata, subjects */),
    });
    expect(res.ok, `POST /classes → ${res.status}`).toBe(true);
    // PROPAGATION (cdc): The CDC event triggered by the publisher POST is fully consumed and the class record is visible in the consumer service at /me/classes
  });

  // Post-propagation assertions — a runner fills these in (D-56):
  it.todo("[publisher] The POST /classes response returns a success status (2xx) and the response body includes the sourcedId matching the unique GUID supplied in the request, confirming it was accepted as the primary key.");
  it.todo("[publisher] The publisher response confirms that all required GUIDRef fields (course, school, terms[]) are present in the stored class record and each conforms to the D-8 GUIDRef shape (containing at minimum sourcedId, type, and href properties).");
  it.todo("[consumer] A GET to /me/classes returns a collection whose 'items' array contains exactly one entry whose sourcedId matches the GUID used in the publisher POST, confirming CDC propagation delivered the record with the correct primary key.");
  it.todo("[consumer] The propagated class record in 'items' has the course field as a GUIDRef object conforming to D-8 shape (sourcedId, type, href present), matching what was submitted to the publisher.");
  it.todo("[consumer] The propagated class record in 'items' has the school field as a GUIDRef object conforming to D-8 shape (sourcedId, type, href present), matching what was submitted to the publisher.");
  it.todo("[consumer] The propagated class record in 'items' has the terms field as a non-empty array where every element is a GUIDRef object conforming to D-8 shape (sourcedId, type, href present), matching what was submitted to the publisher.");
  it.todo("[consumer] All other required fields in the propagated class record (status, dateLastModified, title, classType) match the values originally submitted to the publisher, with no data loss or transformation during CDC propagation.");
});
