// GENERATED — DO NOT EDIT. Regenerate via `npm run generate-tests` (see generated-tests/manifest.json).
// Manifest test #3 — compat enrollment (consumer-can-read-publisher).
// consumer consumer/c4a7e6d2-enrollment-oneroster-v12@4bfb62f33948
// publisher publisher/8d3e5f60-enrollment-oneroster-v12@dd3c103680d9
import { describe, it, expect } from "vitest";

const consumerRequired: { name: string; logicalType?: string }[] = [
  {
    "name": "class",
    "logicalType": "object"
  },
  {
    "name": "dateLastModified",
    "logicalType": "date"
  },
  {
    "name": "role",
    "logicalType": "string"
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
    "name": "user",
    "logicalType": "object"
  }
];
const publisherProps = new Map<string, string | undefined>(
  ([
  {
    "name": "beginDate",
    "logicalType": "date"
  },
  {
    "name": "class",
    "logicalType": "object"
  },
  {
    "name": "dateLastModified",
    "logicalType": "date"
  },
  {
    "name": "endDate",
    "logicalType": "date"
  },
  {
    "name": "metadata",
    "logicalType": "object"
  },
  {
    "name": "primary",
    "logicalType": "boolean"
  },
  {
    "name": "role",
    "logicalType": "string"
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
    "name": "user",
    "logicalType": "object"
  }
] as { name: string; logicalType?: string }[]).map((p) => [p.name, p.logicalType]),
);

describe("compat: enrollment (consumer-can-read-publisher)", () => {
  for (const req of consumerRequired) {
    it(`publisher provides consumer-required '${req.name}'`, () => {
      expect(publisherProps.has(req.name), `missing '${req.name}' in publisher`).toBe(true);
      expect(publisherProps.get(req.name), `type mismatch on '${req.name}'`).toBe(req.logicalType);
    });
  }
});
