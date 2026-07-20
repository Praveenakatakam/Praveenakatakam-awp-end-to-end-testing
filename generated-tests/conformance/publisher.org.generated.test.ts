// GENERATED — DO NOT EDIT. Regenerate via `npm run generate-tests` (see generated-tests/manifest.json).
// Manifest test #1 — conformance publisher/org (contract 5d8f2b4a-org-oneroster-v12@70da82acc8ea).
import { describe, it, expect } from "vitest";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const baseUrl = process.env["PUBLISHER_API_URL"];
const token = process.env["PUBLISHER_TOKEN"];
const ready = Boolean(baseUrl && token);

const schema = {
  "type": "object",
  "required": [
    "dateLastModified",
    "name",
    "sourcedId",
    "status",
    "type"
  ],
  "properties": {
    "children": {
      "type": "array"
    },
    "dateLastModified": {
      "type": "string",
      "format": "date-time"
    },
    "identifier": {
      "type": "string"
    },
    "metadata": {
      "type": "object"
    },
    "name": {
      "type": "string"
    },
    "parent": {
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
    "type": {
      "type": "string",
      "enum": [
        "department",
        "school",
        "district",
        "local",
        "state",
        "national"
      ]
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
describe.skipIf(!ready)("conformance: publisher/org", () => {
  it("every record from /orgs conforms to the org contract schema", async () => {
    const validate = addFormats(new Ajv({ allErrors: true })).compile(schema);
    const res = await fetch(`${baseUrl}/orgs`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok, `GET /orgs → ${res.status}`).toBe(true);
    const records = pluck(await res.json());
    for (const rec of records) {
      const valid = validate(rec);
      expect(valid, JSON.stringify(validate.errors)).toBe(true);
    }
  });
});
