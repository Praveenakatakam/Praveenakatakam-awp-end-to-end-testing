// GENERATED — DO NOT EDIT. Regenerate via `npm run generate-tests` (see generated-tests/manifest.json).
// Manifest test #2 — compat class (consumer-can-read-publisher).
// consumer consumer/b3f6d5c1-class-oneroster-v12@8f734db9c0c9
// publisher publisher/7c2d4e5f-class-oneroster-v12@955990121e05
import { describe, it, expect } from "vitest";

const consumerRequired: { name: string; logicalType?: string }[] = [
  {
    "name": "classType",
    "logicalType": "string"
  },
  {
    "name": "course",
    "logicalType": "object"
  },
  {
    "name": "dateLastModified",
    "logicalType": "date"
  },
  {
    "name": "school",
    "logicalType": "object"
  },
  {
    "name": "sourcedId",
    "logicalType": "string"
  },
  {
    "name": "status",
    "logicalType": "string"
  },
  {
    "name": "terms",
    "logicalType": "array"
  },
  {
    "name": "title",
    "logicalType": "string"
  }
];
const publisherProps = new Map<string, string | undefined>(
  ([
  {
    "name": "classCode",
    "logicalType": "string"
  },
  {
    "name": "classType",
    "logicalType": "string"
  },
  {
    "name": "course",
    "logicalType": "object"
  },
  {
    "name": "dateLastModified",
    "logicalType": "date"
  },
  {
    "name": "grades",
    "logicalType": "array"
  },
  {
    "name": "location",
    "logicalType": "string"
  },
  {
    "name": "metadata",
    "logicalType": "object"
  },
  {
    "name": "school",
    "logicalType": "object"
  },
  {
    "name": "sourcedId",
    "logicalType": "string"
  },
  {
    "name": "status",
    "logicalType": "string"
  },
  {
    "name": "subjects",
    "logicalType": "array"
  },
  {
    "name": "terms",
    "logicalType": "array"
  },
  {
    "name": "title",
    "logicalType": "string"
  }
] as { name: string; logicalType?: string }[]).map((p) => [p.name, p.logicalType]),
);

describe("compat: class (consumer-can-read-publisher)", () => {
  for (const req of consumerRequired) {
    it(`publisher provides consumer-required '${req.name}'`, () => {
      expect(publisherProps.has(req.name), `missing '${req.name}' in publisher`).toBe(true);
      expect(publisherProps.get(req.name), `type mismatch on '${req.name}'`).toBe(req.logicalType);
    });
  }
});
