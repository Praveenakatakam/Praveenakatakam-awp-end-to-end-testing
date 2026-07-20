// GENERATED — DO NOT EDIT. Regenerate via `npm run generate-tests -- --functional` (see generated-tests/functional/manifest.json).
// Manifest plan #26 — functional test for R-52.
// inputHash cdf2ab620aa6e36e — regenerated only when grounded inputs change (R-119).
import { describe, it, expect } from "vitest";

const publisherBase = process.env.PUBLISHER_API_URL;
const publisherToken = process.env.PUBLISHER_TOKEN;
const consumerBase = process.env.CONSUMER_API_URL;
const consumerToken = process.env.CONSUMER_TOKEN;
// Skipped (not failed) when cross-service credentials are absent — R-83a, D-26.
const ready = Boolean(publisherBase && publisherToken && consumerBase && consumerToken);

// Setup / preconditions:
//   - Ensure a teacher account (Teacher A) exists in the publisher with valid authentication credentials.
//   - Ensure at least two classes exist in the publisher: Class-1 and Class-2, each with required fields (sourcedId, title, classType, course, school, terms, status, dateLastModified).
//   - Ensure Teacher A has an active 'teacher' enrollment in Class-1 but NOT in Class-2 (Teacher A has no enrollment or an inactive enrollment in Class-2).
//   - Ensure at least two active student members are enrolled in Class-1, and at least one active student is enrolled in Class-2.
//   - Wait for CDC propagation so that all enrollment and class records are reflected in the consumer service before test execution.
describe.skipIf(!ready)("functional: Teacher receives only their active-enrolled classes and can fetch rosters only for classes they teach", () => {
  it("PUT /classes/{classSourcedId} → CDC → consumer reflects change", async () => {
    // TRIGGER (publisher/class): PUT /classes/{classSourcedId}
    // payload shape: Object containing required class fields: sourcedId (string), title (string), classType (string), course (object), school (object), terms (array), status (string set to 'active'), dateLastModified (date); plus optional fields classCode (string), grades (array), location (string), subjects (array), metadata (object). Represents the canonical class record for Class-1 to confirm it is active and associated with Teacher A's enrollment.
    const res = await fetch(`${publisherBase}/classes/{classSourcedId}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${publisherToken}`, "Content-Type": "application/json" },
      // body: JSON.stringify(/* Object containing required class fields: sourcedId (string), title (string), classType (string), course (object), school (object), terms (array), status (string set to 'active'), dateLastModified (date); plus optional fields classCode (string), grades (array), location (string), subjects (array), metadata (object). Represents the canonical class record for Class-1 to confirm it is active and associated with Teacher A's enrollment. */),
    });
    expect(res.ok, `PUT /classes/{classSourcedId} → ${res.status}`).toBe(true);
    // PROPAGATION (cdc): Class and enrollment records for Teacher A, Class-1, and Class-2 are fully replicated to the consumer service and visible via /me/classes
  });

  // Post-propagation assertions — a runner fills these in (D-56):
  it.todo("[consumer] Authenticated GET /me/classes as Teacher A returns HTTP 200 with a response body containing an 'items' array that includes Class-1 (matching sourcedId, title, classType, status='active').");
  it.todo("[consumer] The 'items' array returned by GET /me/classes does NOT include Class-2, confirming only classes with an active 'teacher' enrollment for Teacher A are returned.");
  it.todo("[consumer] Each class object in the 'items' array contains all required contract fields: sourcedId, title, classType, course, school, terms, status, dateLastModified.");
  it.todo("[consumer] Authenticated GET /me/classes/{Class-1-sourcedId}/roster as Teacher A returns HTTP 200 and the response contains only active student members enrolled in Class-1.");
  it.todo("[consumer] Authenticated GET /me/classes/{Class-2-sourcedId}/roster as Teacher A returns HTTP 403 (or equivalent authorization error), confirming that a teacher cannot access the roster of a class they do not teach.");
});
