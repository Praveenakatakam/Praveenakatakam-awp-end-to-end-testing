// GENERATED — DO NOT EDIT. Regenerate via `npm run generate-tests` (see generated-tests/manifest.json).
// Manifest test #1 — compat TaskPublished (consumer-can-read-publisher).
// consumer get-ready/urn:bawp:get-ready:assignments-api@72642b9a766c
// publisher create/urn:bawp:create:content-events@f9c3a51c653b
import { describe, it, expect } from "vitest";

const consumerRequired: { name: string; logicalType?: string }[] = [
  {
    "name": "description",
    "logicalType": "string"
  },
  {
    "name": "duration",
    "logicalType": "integer"
  },
  {
    "name": "id",
    "logicalType": "string"
  },
  {
    "name": "itemTypes",
    "logicalType": "array"
  },
  {
    "name": "standards",
    "logicalType": "array"
  },
  {
    "name": "title",
    "logicalType": "string"
  },
  {
    "name": "totalItemCount",
    "logicalType": "integer"
  },
  {
    "name": "type",
    "logicalType": "string"
  }
];
const publisherProps = new Map<string, string | undefined>(
  ([
  {
    "name": "duration",
    "logicalType": "integer"
  },
  {
    "name": "eventId",
    "logicalType": "string"
  },
  {
    "name": "itemCount",
    "logicalType": "integer"
  },
  {
    "name": "items",
    "logicalType": "array"
  },
  {
    "name": "publishedAt",
    "logicalType": "string"
  },
  {
    "name": "publishedBy",
    "logicalType": "string"
  },
  {
    "name": "schemaVersion",
    "logicalType": "string"
  },
  {
    "name": "standards",
    "logicalType": "array"
  },
  {
    "name": "taskId",
    "logicalType": "string"
  },
  {
    "name": "taskType",
    "logicalType": "string"
  },
  {
    "name": "tenantId",
    "logicalType": "string"
  },
  {
    "name": "title",
    "logicalType": "string"
  }
] as { name: string; logicalType?: string }[]).map((p) => [p.name, p.logicalType]),
);

describe("compat: TaskPublished (consumer-can-read-publisher)", () => {
  for (const req of consumerRequired) {
    it(`publisher provides consumer-required '${req.name}'`, () => {
      expect(publisherProps.has(req.name), `missing '${req.name}' in publisher`).toBe(true);
      expect(publisherProps.get(req.name), `type mismatch on '${req.name}'`).toBe(req.logicalType);
    });
  }
});
