// GENERATED — DO NOT EDIT. Regenerate via `npm run generate-tests -- --functional` (see generated-tests/functional/manifest.json).
// Manifest plan #25 — functional test for R-51.
// inputHash 34aba7d8afcbb8df — regenerated only when grounded inputs change (R-119).
import { describe, it, expect } from "vitest";

const publisherBase = process.env.PUBLISHER_API_URL;
const publisherToken = process.env.PUBLISHER_TOKEN;
const consumerBase = process.env.CONSUMER_API_URL;
const consumerToken = process.env.CONSUMER_TOKEN;
// Skipped (not failed) when cross-service credentials are absent — R-83a, D-26.
const ready = Boolean(publisherBase && publisherToken && consumerBase && consumerToken);

// Setup / preconditions:
//   - Ensure a known student account exists in the publisher with valid authentication credentials.
//   - Create or confirm at least two class records on the publisher: one (Class A) in which the student holds an active `student` enrollment, and one (Class B) in which the student holds no enrollment or a non-active enrollment (e.g., status=inactive or tobedeleted).
//   - Create or confirm a third class record (Class C) in which the student holds an active enrollment with a role other than `student` (e.g., `teacher`), to verify role filtering.
//   - For Class A, ensure at least one teacher is associated with an active `teacher` enrollment so that teacher name(s) can be verified in the response.
//   - Verify that each class record in the publisher contract has all required fields populated: sourcedId, status, classType, course, dateLastModified, school, terms, title — and classCode where applicable.
//   - Allow CDC propagation to complete so the consumer service reflects the current publisher state before the test trigger is executed.
describe.skipIf(!ready)("functional: Student GET /me/classes returns only active-enrolled classes with title, code, and teacher name(s) via CDC propagation", () => {
  it("PUT /classes/{classSourcedId} → CDC → consumer reflects change", async () => {
    // TRIGGER (publisher/class): PUT /classes/{classSourcedId}
    // payload shape: Object containing required class fields: sourcedId (string), status (string, value='active'), classType (string), course (object with sourcedId), dateLastModified (date), school (object with sourcedId), terms (array of term references), title (string); optionally classCode (string), grades (array), location (string), metadata (object), subjects (array). Used to establish or update Class A as active and fully formed before the student queries their classes.
    const res = await fetch(`${publisherBase}/classes/{classSourcedId}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${publisherToken}`, "Content-Type": "application/json" },
      // body: JSON.stringify(/* Object containing required class fields: sourcedId (string), status (string, value='active'), classType (string), course (object with sourcedId), dateLastModified (date), school (object with sourcedId), terms (array of term references), title (string); optionally classCode (string), grades (array), location (string), metadata (object), subjects (array). Used to establish or update Class A as active and fully formed before the student queries their classes. */),
    });
    expect(res.ok, `PUT /classes/{classSourcedId} → ${res.status}`).toBe(true);
    // PROPAGATION (cdc): Consumer service reflects the updated class record for Class A with status=active before the student authentication and GET /me/classes call is executed.
  });

  // Post-propagation assertions — a runner fills these in (D-56):
  it.todo("[consumer] GET /me/classes authenticated as the known student returns HTTP 200 with a response body containing an `items` array.");
  it.todo("[consumer] The `items` array contains Class A (identified by its classCode and/or sourcedId), which has an active `student` enrollment for the authenticated student.");
  it.todo("[consumer] Each item in `items` includes the class `title` field (non-null, non-empty string matching the publisher's title for that class).");
  it.todo("[consumer] Each item in `items` includes the class `classCode` field matching the value stored on the publisher for that class.");
  it.todo("[consumer] Each item in `items` includes a representation of the teacher name(s) associated with the class (e.g., a teachers array or embedded teacher objects), and for Class A this matches the teacher(s) with an active `teacher` enrollment on the publisher.");
  it.todo("[consumer] Class B (student has no enrollment, or enrollment status is non-active) does NOT appear in the `items` array.");
  it.todo("[consumer] Class C (student holds an active enrollment with a role other than `student`) does NOT appear in the `items` array.");
  it.todo("[consumer] The total count of items in the `items` array equals exactly the number of classes in which the student holds an active `student` enrollment on the publisher — no more, no less.");
});
