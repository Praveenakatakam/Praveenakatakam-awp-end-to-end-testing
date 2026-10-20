// GENERATED — DO NOT EDIT. Regenerate via `npm run generate-tests` (see generated-tests/manifest.json).
// Manifest test #0 — conformance get-ready/TaskPublished (contract urn:bawp:get-ready:assignments-api@078a5a3b3bf8).
import { describe, it, expect } from "vitest";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const baseUrl = process.env["GET_READY_API_URL"];
const token = process.env["GET_READY_TOKEN"];
const ready = Boolean(baseUrl && token);

const schema = {
  "type": "object",
  "required": [
    "itemCount",
    "items",
    "taskId",
    "taskType",
    "title"
  ],
  "properties": {
    "description": {
      "type": [
        "string",
        "null"
      ]
    },
    "duration": {
      "type": [
        "integer",
        "null"
      ]
    },
    "itemCount": {
      "type": "integer"
    },
    "items": {
      "type": "array",
      "minItems": 1
    },
    "standards": {
      "type": [
        "array",
        "null"
      ]
    },
    "taskId": {
      "type": "string",
      "format": "uuid"
    },
    "taskType": {
      "type": "string",
      "enum": [
        "quiz",
        "practice",
        "homework",
        "classwork",
        "assessment"
      ]
    },
    "title": {
      "type": "string"
    }
  },
  "additionalProperties": true
} as const;
const recordsAt = "";

const asArray = (v: unknown): unknown[] | undefined => (Array.isArray(v) ? v : undefined);

function pluck(body: unknown): unknown[] {
  if (recordsAt) return asArray(recordsAt.split(".").reduce<any>((o, k) => (o == null ? o : o[k]), body)) ?? [];
  // recordsAt "" = the body is the array. A tRPC response wraps it: { result: { data } } (or data.json under superjson).
  const data = (body as any)?.result?.data;
  return asArray(body) ?? asArray(data) ?? asArray(data?.json) ?? [];
}

// Skipped (not failed) when live credentials are absent — R-83a, D-26.
describe.skipIf(!ready)("conformance: get-ready/TaskPublished", () => {
  it("every record from /api/grdy/assignments/getTasks conforms to the TaskPublished contract schema", async () => {
    const validate = addFormats(new Ajv({ allErrors: true })).compile(schema);
    const res = await fetch(`${baseUrl}/api/grdy/assignments/getTasks`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok, `GET /api/grdy/assignments/getTasks → ${res.status}`).toBe(true);
    const records = pluck(await res.json());
    // Zero records validates nothing: a wrong recordsAt or an error envelope would otherwise stay green (R-134h).
    expect(records.length, `GET /api/grdy/assignments/getTasks returned no records (recordsAt ""), so nothing was validated`).toBeGreaterThan(0);
    records.forEach((rec, i) => {
      const valid = validate(rec);
      // Name the offending record (index + contents) and the failing rule (R-83).
      expect(valid, `record #${i} ${JSON.stringify(rec)} violates the TaskPublished schema: ${JSON.stringify(validate.errors)}`).toBe(true);
    });
  });
});
