// GENERATED — DO NOT EDIT. Regenerate via `npm run generate-tests -- --functional` (see generated-tests/functional/manifest.json).
// Manifest plan #28 — functional test for R-54.
// inputHash 3a31e66201cc8f17 — regenerated only when grounded inputs change (R-119).
import { describe, it, expect } from "vitest";

const publisherBase = process.env.PUBLISHER_API_URL;
const publisherToken = process.env.PUBLISHER_TOKEN;
const consumerBase = process.env.CONSUMER_API_URL;
const consumerToken = process.env.CONSUMER_TOKEN;
// Skipped (not failed) when cross-service credentials are absent — R-83a, D-26.
const ready = Boolean(publisherBase && publisherToken && consumerBase && consumerToken);

// Setup / preconditions:
//   - Ensure the publisher service is running and reachable, with CDC enabled for the `class` entity.
//   - Ensure the consumer service is running and reachable at /me/classes.
//   - Ensure the CDC pipeline (e.g. message broker / change log) between publisher and consumer is healthy and has no backlog.
//   - Record the current list of class items from the consumer at GET /me/classes so the newly propagated record can be isolated by its sourcedId.
//   - Prepare a valid class payload where `status` is set to `active` (a member of {active, tobedeleted}) and `classType` is set to `scheduled` (a member of {homeroom, scheduled}), along with all other required fields: sourcedId, title, course, school, terms, dateLastModified.
describe.skipIf(!ready)("functional: CDC propagation of a new class with enumerated field values (status, classType) from publisher to consumer", () => {
  it("POST /classes → CDC → consumer reflects change", async () => {
    // TRIGGER (publisher/class): POST /classes
    // payload shape: JSON object containing all required class fields: sourcedId (unique string), status ('active' or 'tobedeleted'), classType ('homeroom' or 'scheduled'), title (string), course (object with at minimum a sourcedId reference), school (object with at minimum a sourcedId reference), terms (non-empty array of term references each with a sourcedId), dateLastModified (ISO 8601 date string); optionally classCode (string), grades (array), location (string), subjects (array), metadata (object).
    const res = await fetch(`${publisherBase}/classes`, {
      method: "POST",
      headers: { Authorization: `Bearer ${publisherToken}`, "Content-Type": "application/json" },
      // body: JSON.stringify(/* JSON object containing all required class fields: sourcedId (unique string), status ('active' or 'tobedeleted'), classType ('homeroom' or 'scheduled'), title (string), course (object with at minimum a sourcedId reference), school (object with at minimum a sourcedId reference), terms (non-empty array of term references each with a sourcedId), dateLastModified (ISO 8601 date string); optionally classCode (string), grades (array), location (string), subjects (array), metadata (object). */),
    });
    expect(res.ok, `POST /classes → ${res.status}`).toBe(true);
    // PROPAGATION (cdc): CDC event for the newly created class sourcedId to appear in the consumer's /me/classes items list
  });

  // Post-propagation assertions — a runner fills these in (D-56):
  it.todo("[consumer] GET /me/classes returns an HTTP 200 response and the `items` array contains exactly one entry whose `sourcedId` matches the sourcedId used in the publisher POST trigger.");
  it.todo("[consumer] The propagated class record's `status` field is present and equals the value posted to the publisher ('active'), confirming it is a valid member of the enumerated set {active, tobedeleted}.");
  it.todo("[consumer] The propagated class record's `classType` field is present and equals the value posted to the publisher ('scheduled'), confirming it is a valid member of the enumerated set {homeroom, scheduled}.");
  it.todo("[consumer] The propagated class record's `title` field matches the title value sent in the publisher POST payload.");
  it.todo("[consumer] The propagated class record's `course` object is present and its sourcedId matches the course reference sent in the publisher POST payload.");
  it.todo("[consumer] The propagated class record's `school` object is present and its sourcedId matches the school reference sent in the publisher POST payload.");
  it.todo("[consumer] The propagated class record's `terms` array is present, non-empty, and each term entry's sourcedId matches the corresponding term reference sent in the publisher POST payload.");
  it.todo("[consumer] The propagated class record's `dateLastModified` field is present and matches the dateLastModified value sent in the publisher POST payload.");
  it.todo("[consumer] No additional unexpected class records sharing the same sourcedId appear more than once in the `items` array (i.e. no duplicate CDC delivery).");
});
