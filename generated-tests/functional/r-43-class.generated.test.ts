// GENERATED — DO NOT EDIT. Regenerate via `npm run generate-tests -- --functional` (see generated-tests/functional/manifest.json).
// Manifest plan #23 — functional test for R-43.
// inputHash 38df842b407961d9 — regenerated only when grounded inputs change (R-119).
import { describe, it, expect } from "vitest";

const publisherBase = process.env.PUBLISHER_API_URL;
const publisherToken = process.env.PUBLISHER_TOKEN;
const consumerBase = process.env.CONSUMER_API_URL;
const consumerToken = process.env.CONSUMER_TOKEN;
// Skipped (not failed) when cross-service credentials are absent — R-83a, D-26.
const ready = Boolean(publisherBase && publisherToken && consumerBase && consumerToken);

// Setup / preconditions:
//   - Provision User A (teacher) in the publisher with a known username; obtain a valid bearer token whose username claim resolves to User A's user.sourcedId.
//   - Provision User B (teacher) in the publisher with a distinct username; obtain a valid bearer token whose username claim resolves to User B's user.sourcedId.
//   - Create at least two class records in the publisher: Class-A assigned to User A (as teacher/roster member) and Class-B assigned exclusively to User B (as teacher/roster member). Each class must satisfy the required contract fields: sourcedId, status, title, classType, course, dateLastModified, school, terms.
//   - Allow CDC propagation to complete so that both class records are fully replicated to the consumer service before the test assertions begin.
describe.skipIf(!ready)("functional: R-43: Authenticated caller is scoped exclusively to their own class data — cross-user isolation via CDC propagation", () => {
  it("POST /classes → CDC → consumer reflects change", async () => {
    // TRIGGER (publisher/class): POST /classes
    // payload shape: Object containing all required class fields: sourcedId (unique string), status (string), title (string), classType (string), course (object with sourcedId), dateLastModified (ISO-8601 date), school (object with sourcedId), terms (non-empty array of term references); optionally classCode, grades, location, metadata, subjects. Two separate POST requests are made — one creating Class-A linked to User A, one creating Class-B linked to User B.
    const res = await fetch(`${publisherBase}/classes`, {
      method: "POST",
      headers: { Authorization: `Bearer ${publisherToken}`, "Content-Type": "application/json" },
      // body: JSON.stringify(/* Object containing all required class fields: sourcedId (unique string), status (string), title (string), classType (string), course (object with sourcedId), dateLastModified (ISO-8601 date), school (object with sourcedId), terms (non-empty array of term references); optionally classCode, grades, location, metadata, subjects. Two separate POST requests are made — one creating Class-A linked to User A, one creating Class-B linked to User B. */),
    });
    expect(res.ok, `POST /classes → ${res.status}`).toBe(true);
    // PROPAGATION (cdc): Both Class-A and Class-B appear as replicated records accessible on the consumer service before assertions are evaluated.
  });

  // Post-propagation assertions — a runner fills these in (D-56):
  it.todo("[consumer] When User A's token is used to GET /me/classes, the response HTTP status is 200 and the 'items' array contains Class-A (matching its sourcedId).");
  it.todo("[consumer] When User A's token is used to GET /me/classes, the 'items' array does NOT contain Class-B (User B's sourcedId must be absent), confirming cross-user isolation.");
  it.todo("[consumer] When User B's token is used to GET /me/classes, the response HTTP status is 200 and the 'items' array contains Class-B (matching its sourcedId).");
  it.todo("[consumer] When User B's token is used to GET /me/classes, the 'items' array does NOT contain Class-A (User A's sourcedId must be absent), confirming cross-user isolation.");
  it.todo("[consumer] Each class object returned in 'items' for User A contains all required contract fields: sourcedId, status, title, classType, course, dateLastModified, school, and terms — and all field values match those originally published for Class-A.");
  it.todo("[consumer] Each class object returned in 'items' for User B contains all required contract fields: sourcedId, status, title, classType, course, dateLastModified, school, and terms — and all field values match those originally published for Class-B.");
  it.todo("[consumer] A request to GET /me/classes made with no token (unauthenticated) returns a non-200 status (e.g., 401 Unauthorized), confirming the endpoint is protected.");
});
