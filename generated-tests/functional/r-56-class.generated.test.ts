// GENERATED — DO NOT EDIT. Regenerate via `npm run generate-tests -- --functional` (see generated-tests/functional/manifest.json).
// Manifest plan #30 — functional test for R-56.
// inputHash 97b738eff24fa623 — regenerated only when grounded inputs change (R-119).
import { describe, it, expect } from "vitest";

const publisherBase = process.env.PUBLISHER_API_URL;
const publisherToken = process.env.PUBLISHER_TOKEN;
const consumerBase = process.env.CONSUMER_API_URL;
const consumerToken = process.env.CONSUMER_TOKEN;
// Skipped (not failed) when cross-service credentials are absent — R-83a, D-26.
const ready = Boolean(publisherBase && publisherToken && consumerBase && consumerToken);

// Setup / preconditions:
//   - Ensure a known class record exists on the publisher with a valid sourcedId, title, classType, course, dateLastModified, school, status, and terms populated; at least one active student (sourcedId, name) is enrolled; at least one teacher is assigned to the class.
//   - Confirm that the consumer's /me/classes/{classSourcedId}/roster endpoint is reachable and authenticated credentials for the caller (with a known role) are available.
//   - Confirm that the consumer has ingested the class record (i.e., the class appears under GET /me/classes items) before triggering the write.
//   - Record the current state of the target class on the consumer so post-propagation changes can be compared.
describe.skipIf(!ready)("functional: CDC propagation of class update triggers outbound roster-payload contract validation on the consumer (R-56)", () => {
  it("PUT /classes/{classSourcedId} → CDC → consumer reflects change", async () => {
    // TRIGGER (publisher/class): PUT /classes/{classSourcedId}
    // payload shape: Full class object with required fields: sourcedId (string), title (string), classType (string), course (object), dateLastModified (date), school (object), status (string), terms (array); optionally classCode (string), grades (array), location (string), metadata (object), subjects (array). The title field MUST be changed to a new distinct value to produce an observable delta.
    const res = await fetch(`${publisherBase}/classes/{classSourcedId}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${publisherToken}`, "Content-Type": "application/json" },
      // body: JSON.stringify(/* Full class object with required fields: sourcedId (string), title (string), classType (string), course (object), dateLastModified (date), school (object), status (string), terms (array); optionally classCode (string), grades (array), location (string), metadata (object), subjects (array). The title field MUST be changed to a new distinct value to produce an observable delta. */),
    });
    expect(res.ok, `PUT /classes/{classSourcedId} → ${res.status}`).toBe(true);
    // PROPAGATION (cdc): Consumer reflects the updated class title under GET /me/classes items for the affected classSourcedId
  });

  // Post-propagation assertions — a runner fills these in (D-56):
  it.todo("[consumer] GET /me/classes/{classSourcedId}/roster returns HTTP 200, confirming that outbound payload validation against the ODCS v3.1.0 class-roster contract succeeded (i.e., the assembled payload conformed to the contract and was not suppressed).");
  it.todo("[consumer] The roster response body contains a class-view composite that includes the updated title value pushed by the publisher, confirming CDC propagation reached the consumer before the response was assembled.");
  it.todo("[consumer] The roster response body includes the required class-view fields: sourcedId, title, classType, and the caller's role, as well as a teachers array — all present and non-null.");
  it.todo("[consumer] The roster response body includes a students array where every entry contains at minimum sourcedId and name fields, and all listed students are in active status.");
  it.todo("[consumer] classCode, when present in the response, is a string; its absence is also acceptable (optional field per contract).");
  it.todo("[consumer] If a subsequent GET /me/classes/{classSourcedId}/roster is attempted while the assembled payload is forced to be non-conforming (e.g., by temporarily removing a required field via a contract-violating update), the consumer API MUST respond with HTTP 500 and MUST NOT return the non-conforming body — the response body must not contain recognisable roster data fields.");
});
