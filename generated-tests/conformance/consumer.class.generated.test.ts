// GENERATED — DO NOT EDIT. Regenerate via `npm run generate-tests` (see generated-tests/manifest.json).
// Manifest test #0 — conformance consumer/class (contract b3f6d5c1-class-oneroster-v12@8f734db9c0c9).
import { describe, it, expect } from "vitest";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const baseUrl = process.env["CONSUMER_API_URL"];
const token = process.env["CONSUMER_TOKEN"];
const ready = Boolean(baseUrl && token);

const schema = {
  "type": "object",
  "required": [
    "classType",
    "course",
    "dateLastModified",
    "school",
    "sourcedId",
    "status",
    "terms",
    "title"
  ],
  "properties": {
    "classCode": {
      "type": "string"
    },
    "classType": {
      "type": "string",
      "enum": [
        "homeroom",
        "scheduled"
      ]
    },
    "course": {
      "type": "object"
    },
    "dateLastModified": {
      "type": "string",
      "format": "date-time"
    },
    "grades": {
      "type": "array"
    },
    "location": {
      "type": "string"
    },
    "metadata": {
      "type": "object"
    },
    "school": {
      "type": "object"
    },
    "sourcedId": {
      "type": "string"
    },
    "status": {
      "type": "string",
      "enum": [
        "active",
        "tobedeleted"
      ]
    },
    "subjects": {
      "type": "array"
    },
    "terms": {
      "type": "array"
    },
    "title": {
      "type": "string"
    }
  },
  "additionalProperties": true
} as const;
const recordsAt = "items";

function pluck(body: unknown): unknown[] {
  if (!recordsAt) return Array.isArray(body) ? body : [];
  const at = recordsAt.split(".").reduce<any>((o, k) => (o == null ? o : o[k]), body);
  return Array.isArray(at) ? at : [];
}

// Skipped (not failed) when live credentials are absent — R-83a, D-26.
describe.skipIf(!ready)("conformance: consumer/class", () => {
  it("every record from /me/classes conforms to the class contract schema", async () => {
    const validate = addFormats(new Ajv({ allErrors: true })).compile(schema);
    const res = await fetch(`${baseUrl}/me/classes`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok, `GET /me/classes → ${res.status}`).toBe(true);
    const records = pluck(await res.json());
    for (const rec of records) {
      const valid = validate(rec);
      expect(valid, JSON.stringify(validate.errors)).toBe(true);
    }
  });
});
