// GENERATED — DO NOT EDIT. Regenerate via `npm run generate-tests -- --functional` (see generated-tests/functional/manifest.json).
// Manifest plan #0 — functional test for CRE-R-24.
// inputHash 86f940e2fb09ef5c — regenerated only when grounded inputs change (R-119).
import { describe, it, expect } from "vitest";

const publisherBase = process.env.PUBLISHER_API_URL;
const publisherToken = process.env.PUBLISHER_TOKEN;
const consumerBase = process.env.CONSUMER_API_URL;
const consumerToken = process.env.CONSUMER_TOKEN;
// Skipped (not failed) when cross-service credentials are absent — R-83a, D-26.
const ready = Boolean(publisherBase && publisherToken && consumerBase && consumerToken);

// Setup / preconditions:
//   - Ensure a valid tenant exists and tenantId is available for use in all requests.
//   - Ensure a Task exists in the publisher (awp-app-plane / create service) with at least one Item, a valid taskType, duration, title, and a populated items[] array (each item carrying itemId, itemType, sectionIndex, itemIndex, scoringRule, and MCQ keys/answerOptions).
//   - Ensure the Task's review workflow has review steps order=1, order=2, and order=3 already in an Approved/Ready state, leaving the 4th review step (order=4) as the final pending step.
//   - Confirm the create-evb EventBridge bus is reachable and a consumer (get-ready service) is subscribed to events with source=bawp.create and detail-type=TaskPublished.
//   - Record the taskId and all item metadata (itemId, itemType, sectionIndex, itemIndex, scoringRule, keys, answerOptions) for later assertion.
describe.skipIf(!ready)("functional: TaskPublished CDC propagation when Item's 4th review step (order=4) is approved via review.advance", () => {
  it("POST /api/review/advance → CDC → consumer reflects change", async () => {
    // TRIGGER (create/TaskPublished): POST /api/review/advance
    // payload shape: Object containing taskId (string, required), tenantId (string, required), and review step advancement data targeting the 4th review step (order=4) with an Approved/Ready decision.
    const res = await fetch(`${publisherBase}/api/review/advance`, {
      method: "POST",
      headers: { Authorization: `Bearer ${publisherToken}`, "Content-Type": "application/json" },
      // body: JSON.stringify(/* Object containing taskId (string, required), tenantId (string, required), and review step advancement data targeting the 4th review step (order=4) with an Approved/Ready decision. */),
    });
    expect(res.ok, `POST /api/review/advance → ${res.status}`).toBe(true);
    // PROPAGATION (cdc): TaskPublished event delivered to create-evb EventBridge bus (source=bawp.create, detail-type=TaskPublished) and consumed by the get-ready service.
  });

  // Post-propagation assertions — a runner fills these in (D-56):
  it.todo("[publisher] The review.advance call for the 4th review step (order=4) returns a success response (HTTP 2xx), confirming the step transitioned to Approved/Ready.");
  it.todo("[publisher] A TaskPublished event is emitted to the create-evb EventBridge bus with source exactly equal to 'bawp.create' and detail-type exactly equal to 'TaskPublished'.");
  it.todo("[publisher] The TaskPublished event detail contains all required fields: schemaVersion, eventId, tenantId, taskId, title, taskType, itemCount, items[], publishedAt, and publishedBy — all non-null and non-empty.");
  it.todo("[publisher] The taskId in the event payload matches the taskId of the Task whose 4th review step was just approved.");
  it.todo("[publisher] The tenantId in the event payload matches the tenantId used in the review.advance request.");
  it.todo("[publisher] The itemCount field equals the actual number of entries in the items[] array in the event payload.");
  it.todo("[publisher] Each entry in items[] contains itemId, itemType, sectionIndex, itemIndex, and scoringRule fields; MCQ-typed items additionally carry non-empty keys and answerOptions fields.");
  it.todo("[publisher] publishedAt is a valid ISO 8601 timestamp string representing the approximate time of the review.advance action.");
  it.todo("[publisher] If standards were associated with the Task, the standards array in the event is non-empty and matches the Task's configured standards; otherwise the standards field is an empty array or omitted.");
  it.todo("[publisher] If duration was set on the Task, the duration integer field in the event matches the Task's configured duration value.");
  it.todo("[consumer] After CDC propagation, calling GET /api/grdy/assignments/getTasks on the get-ready service returns a response that includes the newly published Task, identifiable by the matching taskId.");
  it.todo("[consumer] The Task record visible in get-ready contains title, taskType, itemCount, and taskId values that are consistent with those in the published TaskPublished event payload.");
  it.todo("[consumer] The items[] data visible for the Task in get-ready reflects the serialised items from the TaskPublished event, with each item retaining its itemId, itemType, sectionIndex, itemIndex, and scoringRule.");
});
