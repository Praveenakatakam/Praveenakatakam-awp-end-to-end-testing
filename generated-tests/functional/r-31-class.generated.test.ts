// GENERATED — DO NOT EDIT. Regenerate via `npm run generate-tests -- --functional` (see generated-tests/functional/manifest.json).
// Manifest plan #17 — functional test for R-31.
// inputHash 7566bc0aabecb2c5 — regenerated only when grounded inputs change (R-119).
import { describe, it, expect } from "vitest";

const publisherBase = process.env.PUBLISHER_API_URL;
const publisherToken = process.env.PUBLISHER_TOKEN;
const consumerBase = process.env.CONSUMER_API_URL;
const consumerToken = process.env.CONSUMER_TOKEN;
// Skipped (not failed) when cross-service credentials are absent — R-83a, D-26.
const ready = Boolean(publisherBase && publisherToken && consumerBase && consumerToken);

// Setup / preconditions:
//   - Ensure the rostering store is accessible and the consumer service is running with CDC ingestion active.
//   - Ensure a valid class record exists in the publisher with a known sourcedId, classType, course, dateLastModified, school, status, terms, and title.
//   - Ensure a valid user record exists in the publisher with a known sourcedId that will be referenced in the enrollment event.
//   - Confirm no existing enrollment record links the target user sourcedId to the target class sourcedId in the consumer rostering store before the test begins.
describe.skipIf(!ready)("functional: CDC propagation of enrollment event persists enrollment keyed by sourcedId with role, status, and GUIDRefs (by user and by class)", () => {
  it("POST /me/classes → CDC → consumer reflects change", async () => {
    // TRIGGER (publisher/class): POST /me/classes
    // payload shape: Object containing all required class fields: sourcedId (string, unique), status (string), dateLastModified (date), title (string), classType (string), course (object with GUIDRef), school (object with GUIDRef), terms (array of GUIDRefs); plus an associated enrollment sub-event carrying: sourcedId (string), role ('student' or 'teacher'), status (string), user (GUIDRef object), and class (GUIDRef object referencing the class sourcedId above).
    const res = await fetch(`${publisherBase}/me/classes`, {
      method: "POST",
      headers: { Authorization: `Bearer ${publisherToken}`, "Content-Type": "application/json" },
      // body: JSON.stringify(/* Object containing all required class fields: sourcedId (string, unique), status (string), dateLastModified (date), title (string), classType (string), course (object with GUIDRef), school (object with GUIDRef), terms (array of GUIDRefs); plus an associated enrollment sub-event carrying: sourcedId (string), role ('student' or 'teacher'), status (string), user (GUIDRef object), and class (GUIDRef object referencing the class sourcedId above). */),
    });
    expect(res.ok, `POST /me/classes → ${res.status}`).toBe(true);
    // PROPAGATION (cdc): Enrollment CDC event emitted by publisher is consumed and persisted by the rostering store in the consumer service.
  });

  // Post-propagation assertions — a runner fills these in (D-56):
  it.todo("[consumer] After CDC propagation, GET /me/classes returns an 'items' array that includes the class with the sourcedId matching the one sent in the trigger payload.");
  it.todo("[consumer] The enrollment record in the rostering store is keyed by the enrollment's sourcedId and can be retrieved uniquely by that key.");
  it.todo("[consumer] The enrollment record is indexed and retrievable by the user's sourcedId (lookup by user), and it references the correct user GUIDRef matching the one supplied in the enrollment event.");
  it.todo("[consumer] The enrollment record is indexed and retrievable by the class's sourcedId (lookup by class), and it references the correct class GUIDRef matching the class sourcedId supplied in the trigger.");
  it.todo("[consumer] The persisted enrollment record's 'role' field exactly matches the value sent in the enrollment event ('student' or 'teacher').");
  it.todo("[consumer] The persisted enrollment record's 'status' field exactly matches the value sent in the enrollment event.");
  it.todo("[consumer] The persisted enrollment record's 'user' GUIDRef field is present and matches the user sourcedId provided in the enrollment event payload.");
  it.todo("[consumer] The persisted enrollment record's 'class' GUIDRef field is present and matches the class sourcedId provided in the enrollment event payload.");
});
