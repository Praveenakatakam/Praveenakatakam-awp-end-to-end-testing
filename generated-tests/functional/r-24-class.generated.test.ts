// GENERATED — DO NOT EDIT. Regenerate via `npm run generate-tests -- --functional` (see generated-tests/functional/manifest.json).
// Manifest plan #13 — functional test for R-24, R-55, R-35.
// inputHash 20cf832fa88dbb94 — regenerated only when grounded inputs change (R-119).
import { describe, it, expect } from "vitest";

const publisherBase = process.env.PUBLISHER_API_URL;
const publisherToken = process.env.PUBLISHER_TOKEN;
const consumerBase = process.env.CONSUMER_API_URL;
const consumerToken = process.env.CONSUMER_TOKEN;
// Skipped (not failed) when cross-service credentials are absent — R-83a, D-26.
const ready = Boolean(publisherBase && publisherToken && consumerBase && consumerToken);

// Setup / preconditions:
//   - Ensure a user record exists with roles containing only 'administrator' (explicitly excluding 'student' and 'teacher') in the publisher system, with a known sourcedId.
//   - Ensure the administrator user has been provisioned a login account in Cognito via the user-events → account-provisioning flow (R-24/R-55), confirming operator endpoint access is available.
//   - Ensure at least one class record exists in the publisher with a valid sourcedId, classType, course, dateLastModified, school, status, terms, and title; this class will serve as the roster baseline.
//   - Confirm no prior association exists between the administrator user and any class roster on the consumer side before the test trigger is fired.
describe.skipIf(!ready)("functional: Administrator user SHALL NOT appear on any class roster after CDC propagation of class write", () => {
  it("PUT /classes/{sourcedId} → CDC → consumer reflects change", async () => {
    // TRIGGER (publisher/class): PUT /classes/{sourcedId}
    // payload shape: Object containing required fields: sourcedId (string), classType (string), course (object), dateLastModified (date), school (object), status (string), terms (array), title (string); and optional fields: classCode (string), grades (array), location (string), metadata (object), subjects (array). The enrolled/associated user references, if any, must reference only users with 'student' or 'teacher' roles — the administrator user's sourcedId must NOT appear in any enrollment or membership associations within this payload.
    const res = await fetch(`${publisherBase}/classes/{sourcedId}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${publisherToken}`, "Content-Type": "application/json" },
      // body: JSON.stringify(/* Object containing required fields: sourcedId (string), classType (string), course (object), dateLastModified (date), school (object), status (string), terms (array), title (string); and optional fields: classCode (string), grades (array), location (string), metadata (object), subjects (array). The enrolled/associated user references, if any, must reference only users with 'student' or 'teacher' roles — the administrator user's sourcedId must NOT appear in any enrollment or membership associations within this payload. */),
    });
    expect(res.ok, `PUT /classes/{sourcedId} → ${res.status}`).toBe(true);
    // PROPAGATION (cdc): CDC event for the class entity emitted by the publisher is fully consumed and processed by the consumer service, updating the consumer's class roster data store.
  });

  // Post-propagation assertions — a runner fills these in (D-56):
  it.todo("[consumer] GET /me/classes returns HTTP 200 with a response body containing an 'items' array; the class updated by the trigger is present in 'items' (matched by sourcedId), confirming CDC propagation succeeded.");
  it.todo("[consumer] None of the entries in the 'items' array returned by GET /me/classes are associated with the administrator user's sourcedId — the administrator does not appear as an enrolled member, student, or teacher on any class roster.");
  it.todo("[consumer] The class record present in GET /me/classes 'items' contains only user associations (if any) whose roles are 'student' or 'teacher', never 'administrator', confirming R-35 roster exclusivity.");
  it.todo("[consumer] The administrator user, when authenticating via the provisioned Cognito login account, receives access to operator endpoints (R-55) but a GET /me/classes for that administrator session returns an 'items' array that contains no roster entries attributing the administrator as a class participant.");
});
