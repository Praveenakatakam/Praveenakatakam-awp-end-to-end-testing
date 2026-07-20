// GENERATED — DO NOT EDIT. Regenerate via `npm run generate-tests -- --functional` (see generated-tests/functional/manifest.json).
// Manifest plan #33 — functional test for R-70.
// inputHash 497bf576ee49fdfd — regenerated only when grounded inputs change (R-119).
import { describe, it, expect } from "vitest";

const publisherBase = process.env.PUBLISHER_API_URL;
const publisherToken = process.env.PUBLISHER_TOKEN;
const consumerBase = process.env.CONSUMER_API_URL;
const consumerToken = process.env.CONSUMER_TOKEN;
// Skipped (not failed) when cross-service credentials are absent — R-83a, D-26.
const ready = Boolean(publisherBase && publisherToken && consumerBase && consumerToken);

// Setup / preconditions:
//   - Ensure the rostering store on the consumer is reachable and the integrity validator tooling is available and pointed at the consumer's rostering store.
//   - Seed the publisher with a known valid org (school) record, capturing its sourcedId (e.g., knownOrgId).
//   - Seed the publisher with a valid class record whose school.sourcedId references knownOrgId, classType is a valid enum value (e.g., 'scheduled'), status is a valid enum value (e.g., 'active'), and all required fields (sourcedId, title, course, dateLastModified, terms, school, classType, status) are populated.
//   - Confirm the valid class has fully propagated to the consumer store via CDC before beginning the write trigger step.
//   - Record the sourcedId of the valid class as baseClassId for reference in assertions.
describe.skipIf(!ready)("functional: Integrity Validator: class.school Referential Constraint & classType/status Enum Validation via CDC Propagation", () => {
  it("POST /me/classes → CDC → consumer reflects change", async () => {
    // TRIGGER (publisher/class): POST /me/classes
    // payload shape: Object containing all required class fields: sourcedId (string, unique), title (string), classType (valid enum string, e.g. 'scheduled'), status (valid enum string, e.g. 'active'), course (object with sourcedId), dateLastModified (ISO date string), terms (non-empty array of term references), school (object whose sourcedId intentionally references a NON-EXISTENT org to exercise the referential integrity failure path), and optionally classCode, grades, location, metadata, subjects.
    const res = await fetch(`${publisherBase}/me/classes`, {
      method: "POST",
      headers: { Authorization: `Bearer ${publisherToken}`, "Content-Type": "application/json" },
      // body: JSON.stringify(/* Object containing all required class fields: sourcedId (string, unique), title (string), classType (valid enum string, e.g. 'scheduled'), status (valid enum string, e.g. 'active'), course (object with sourcedId), dateLastModified (ISO date string), terms (non-empty array of term references), school (object whose sourcedId intentionally references a NON-EXISTENT org to exercise the referential integrity failure path), and optionally classCode, grades, location, metadata, subjects. */),
    });
    expect(res.ok, `POST /me/classes → ${res.status}`).toBe(true);
    // PROPAGATION (cdc): The newly created class record (identified by its sourcedId) is visible in the consumer store at GET /me/classes (present in the items array).
  });

  // Post-propagation assertions — a runner fills these in (D-56):
  it.todo("[consumer] GET /me/classes returns an items array that contains the newly created class record, identified by its sourcedId — confirming CDC propagation completed.");
  it.todo("[consumer] Run the standalone integrity validator against the consumer rostering store. The validator MUST return a structured pass/fail report (e.g., JSON object or equivalent structured format), not plain text or an unstructured error message.");
  it.todo("[consumer] The structured report MUST contain at least one failure entry for the newly created class record, identifying the specific entity type as 'class', the specific sourcedId of the offending record, and the specific field 'school' as the failing referential constraint (school.sourcedId does not resolve to a known org in the store).");
  it.todo("[consumer] The structured report MUST NOT declare the overall store state as 'healthy' — the presence of the unresolved class.school reference is a hard stop for a healthy declaration.");
  it.todo("[consumer] The structured report for the previously seeded valid class (baseClassId) MUST NOT contain any failures — confirming the validator correctly distinguishes passing records from failing ones and reports only genuine violations.");
  it.todo("[consumer] If any additional class records exist in the consumer store whose classType value is not a recognized valid enum (e.g., not one of 'scheduled', 'homeroom', or equivalent contract-defined values), each such record MUST appear in the structured report with entity 'class', its specific sourcedId, and field 'classType' named as the failure.");
  it.todo("[consumer] If any additional class records exist in the consumer store whose status value is not a recognized valid enum (e.g., not one of 'active', 'tobedeleted', or equivalent contract-defined values), each such record MUST appear in the structured report with entity 'class', its specific sourcedId, and field 'status' named as the failure.");
  it.todo("[consumer] The structured report MUST enumerate every failure individually — multiple distinct violations across different records or fields must each appear as separate named entries, not collapsed or aggregated into a single generic error.");
});
