// GENERATED — DO NOT EDIT. Regenerate via `npm run generate-tests` (see generated-tests/manifest.json).
// Manifest test #4 — compat TaskPublished (consumer-can-read-publisher).
// consumer get-ready/urn:bawp:get-ready:assignments-api@078a5a3b3bf8
// publisher create/urn:bawp:create:content-events@506cbbada717
import { describe, it, expect } from "vitest";

const consumerRequired: { name: string; logicalType?: string }[] = [
  {
    "name": "itemCount",
    "logicalType": "integer"
  },
  {
    "name": "items",
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
    "name": "title",
    "logicalType": "string"
  }
];
const publisherProps = new Map<string, string | undefined>(
  ([
  {
    "name": "description",
    "logicalType": "string"
  },
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
    "name": "items[].answerOptions",
    "logicalType": "array"
  },
  {
    "name": "items[].itemId",
    "logicalType": "string"
  },
  {
    "name": "items[].itemIndex",
    "logicalType": "integer"
  },
  {
    "name": "items[].itemType",
    "logicalType": "string"
  },
  {
    "name": "items[].keys",
    "logicalType": "array"
  },
  {
    "name": "items[].scoringRule",
    "logicalType": "object"
  },
  {
    "name": "items[].sectionIndex",
    "logicalType": "integer"
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
      const name = req.name;
      expect(publisherProps.has(name), `missing '${name}' in publisher`).toBe(true);
      // Two missing types are not "equal types" (R-84a): without a declared type nothing was compared.
      expect(req.logicalType !== undefined, `'${req.name}' declares no logicalType, so type equality cannot be established`).toBe(true);
      expect(publisherProps.get(name), `type mismatch on '${req.name}'`).toBe(req.logicalType);
    });
  }
});
