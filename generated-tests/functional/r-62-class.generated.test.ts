// GENERATED — DO NOT EDIT. Regenerate via `npm run generate-tests -- --functional` (see generated-tests/functional/manifest.json).
// Manifest plan #32 — functional test for R-62.
// inputHash 5737ea0e8fa6a797 — regenerated only when grounded inputs change (R-119).
import { describe, it, expect } from "vitest";

const publisherBase = process.env.PUBLISHER_API_URL;
const publisherToken = process.env.PUBLISHER_TOKEN;
const consumerBase = process.env.CONSUMER_API_URL;
const consumerToken = process.env.CONSUMER_TOKEN;
// Skipped (not failed) when cross-service credentials are absent — R-83a, D-26.
const ready = Boolean(publisherBase && publisherToken && consumerBase && consumerToken);

// Setup / preconditions:
//   - Ensure a teacher account exists in the publisher with valid authentication credentials.
//   - Ensure at least one class entity exists in the publisher assigned to the teacher, with all required fields: classType, course, dateLastModified, school, sourcedId, status, terms, and title.
//   - Ensure the class has at least one student enrolled so the roster is non-empty.
//   - Ensure CDC pipeline between publisher and consumer is active and healthy.
//   - Authenticate as the teacher in both the publisher and consumer services and obtain valid session tokens.
describe.skipIf(!ready)("functional: Teacher-authenticated class list and roster display via CDC propagation", () => {
  it("POST /me/classes → CDC → consumer reflects change", async () => {
    // TRIGGER (publisher/class): POST /me/classes
    // payload shape: Object containing required fields: classType (string), course (object), dateLastModified (date), school (object), sourcedId (string), status (string), terms (array), title (string); and optional fields: classCode (string), grades (array), location (string), metadata (object), subjects (array)
    const res = await fetch(`${publisherBase}/me/classes`, {
      method: "POST",
      headers: { Authorization: `Bearer ${publisherToken}`, "Content-Type": "application/json" },
      // body: JSON.stringify(/* Object containing required fields: classType (string), course (object), dateLastModified (date), school (object), sourcedId (string), status (string), terms (array), title (string); and optional fields: classCode (string), grades (array), location (string), metadata (object), subjects (array) */),
    });
    expect(res.ok, `POST /me/classes → ${res.status}`).toBe(true);
    // PROPAGATION (cdc): CDC event for the new class entity to be received and indexed by the consumer service
  });

  // Post-propagation assertions — a runner fills these in (D-56):
  it.todo("[consumer] GET /me/classes returns HTTP 200 with a response body containing an 'items' array that includes the newly created class, identified by its sourcedId.");
  it.todo("[consumer] The class object within 'items' contains all required fields: classType, course, dateLastModified, school, sourcedId, status, terms, and title, with values matching those set on the publisher.");
  it.todo("[consumer] GET /me/classes/{id}/roster (where {id} is the sourcedId of the newly created class) returns HTTP 200.");
  it.todo("[consumer] The roster response for the selected class includes at least one student record corresponding to the enrolled student(s) set up in the precondition.");
  it.todo("[consumer] The roster is only accessible while authenticated as a teacher; an unauthenticated or unauthorized request to GET /me/classes/{id}/roster returns a non-200 status (e.g., 401 or 403).");
  it.todo("[consumer] The class list returned by GET /me/classes only includes classes assigned to the authenticated teacher (i.e., no classes belonging to other teachers are present in the 'items' array).");
});
