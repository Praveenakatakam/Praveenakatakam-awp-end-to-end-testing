// GENERATED — DO NOT EDIT. Regenerate via `npm run generate-tests -- --functional` (see generated-tests/functional/manifest.json).
// Manifest plan #1 — functional test for XCT-R-11.
// inputHash 604729cb3807e06b — regenerated only when grounded inputs change (R-119).
import { describe, it, expect } from "vitest";

const publisherBase = process.env.PUBLISHER_API_URL;
const publisherToken = process.env.PUBLISHER_TOKEN;
const consumerBase = process.env.CONSUMER_API_URL;
const consumerToken = process.env.CONSUMER_TOKEN;
// Skipped (not failed) when cross-service credentials are absent — R-83a, D-26.
const ready = Boolean(publisherBase && publisherToken && consumerBase && consumerToken);

// Setup / preconditions:
//   - Ensure the create service is running and connected to the create-evb EventBridge bus.
//   - Ensure the get-ready service is running and subscribed to TaskPublished events on create-evb.
//   - Ensure a valid tenantId and publishedBy user identity are available for the test.
//   - Ensure the get-ready consumer endpoint /api/grdy/assignments/getTasks is reachable and queryable.
//   - Record the current list of tasks visible to the get-ready consumer so a post-propagation diff can be made.
describe.skipIf(!ready)("functional: TaskPublished CDC propagation from create service to get-ready consumer via create-evb", () => {
  it("POST /api/create/tasks → CDC → consumer reflects change", async () => {
    // TRIGGER (create/TaskPublished): POST /api/create/tasks
    // payload shape: Object containing: taskId (UUID string), taskType (string), title (string), tenantId (string), publishedBy (string), publishedAt (ISO-8601 datetime string), items (non-empty array with at least 1 entry), itemCount (integer matching items length), schemaVersion (string, value '1.0.0'), eventId (UUID string); optionally duration (integer) and standards (array).
    const res = await fetch(`${publisherBase}/api/create/tasks`, {
      method: "POST",
      headers: { Authorization: `Bearer ${publisherToken}`, "Content-Type": "application/json" },
      // body: JSON.stringify(/* Object containing: taskId (UUID string), taskType (string), title (string), tenantId (string), publishedBy (string), publishedAt (ISO-8601 datetime string), items (non-empty array with at least 1 entry), itemCount (integer matching items length), schemaVersion (string, value '1.0.0'), eventId (UUID string); optionally duration (integer) and standards (array). */),
    });
    expect(res.ok, `POST /api/create/tasks → ${res.status}`).toBe(true);
    // PROPAGATION (cdc): TaskPublished event emitted on create-evb and consumed by get-ready service
  });

  // Post-propagation assertions — a runner fills these in (D-56):
  it.todo("[publisher] The create service emits a TaskPublished event onto create-evb with schemaVersion exactly equal to '1.0.0'.");
  it.todo("[publisher] The emitted TaskPublished event carries a non-null, well-formed UUID in the eventId field.");
  it.todo("[publisher] The emitted TaskPublished event's items array contains at least 1 entry, and itemCount matches the length of items.");
  it.todo("[publisher] All required fields (eventId, itemCount, items, publishedAt, publishedBy, schemaVersion, taskId, taskType, tenantId, title) are present and non-null in the emitted TaskPublished event.");
  it.todo("[consumer] After CDC propagation, a GET to /api/grdy/assignments/getTasks returns a response that includes a task record whose taskId matches the taskId supplied in the trigger payload.");
  it.todo("[consumer] The task record returned by /api/grdy/assignments/getTasks reflects the correct title, taskType, tenantId, publishedBy, and publishedAt values from the TaskPublished event — confirming event-driven metadata ingest replaced any prior HTTP poll.");
  it.todo("[consumer] The task record returned by /api/grdy/assignments/getTasks contains schemaVersion '1.0.0', confirming the get-ready service persisted or forwarded the schema version carried in the event.");
  it.todo("[consumer] The task record was available in get-ready without any manual polling action by the test — its presence confirms the consumer reacted to the TaskPublished event asynchronously via create-evb.");
});
