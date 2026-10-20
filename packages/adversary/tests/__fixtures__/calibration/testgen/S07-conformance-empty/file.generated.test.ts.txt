// GENERATED — DO NOT EDIT. Regenerate via `npm run generate-tests` (see generated-tests/manifest.json).
// Manifest test #0 — conformance get-ready/TaskPublished (contract urn:bawp:get-ready:assignments-api@72642b9a766c).
import { describe, it, expect } from "vitest";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const baseUrl = process.env["GET_READY_API_URL"];
const token = process.env["GET_READY_TOKEN"];
const ready = Boolean(baseUrl && token);

const schema = {
  "type": "object",
  "required": [
    "description",
    "duration",
    "id",
    "itemTypes",
    "standards",
    "title",
    "totalItemCount",
    "type"
  ],
  "properties": {
    "description": {
      "type": "string"
    },
    "duration": {
      "type": "integer"
    },
    "id": {
      "type": "string"
    },
    "itemTypes": {
      "type": "array"
    },
    "standards": {
      "type": "array"
    },
    "title": {
      "type": "string"
    },
    "totalItemCount": {
      "type": "integer"
    },
    "type": {
      "type": "string",
      "enum": [
        "practice",
        "quiz",
        "homework",
        "classwork",
        "assessment"
      ]
    }
  },
  "additionalProperties": true
} as const;
const recordsAt = "";

function pluck(body: unknown): unknown[] {
  if (!recordsAt) return Array.isArray(body) ? body : [];
  const at = recordsAt.split(".").reduce<any>((o, k) => (o == null ? o : o[k]), body);
  return Array.isArray(at) ? at : [];
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
    records.forEach((rec, i) => {
      const valid = validate(rec);
      // Name the offending record (index + contents) and the failing rule (R-83).
      expect(valid, `record #${i} ${JSON.stringify(rec)} violates the TaskPublished schema: ${JSON.stringify(validate.errors)}`).toBe(true);
    });
  });
});
