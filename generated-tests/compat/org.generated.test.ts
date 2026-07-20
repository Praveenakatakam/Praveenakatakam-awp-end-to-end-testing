// GENERATED — DO NOT EDIT. Regenerate via `npm run generate-tests` (see generated-tests/manifest.json).
// Manifest test #4 — compat org (consumer-can-read-publisher).
// consumer consumer/5d8f2b4a-org-oneroster-v12@70da82acc8ea
// publisher publisher/5d8f2b4a-org-oneroster-v12@70da82acc8ea
import { describe, it, expect } from "vitest";

const consumerRequired: { name: string; logicalType?: string }[] = [
  {
    "name": "dateLastModified",
    "logicalType": "date"
  },
  {
    "name": "name",
    "logicalType": "string"
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
    "name": "type",
    "logicalType": "string"
  }
];
const publisherProps = new Map<string, string | undefined>(
  ([
  {
    "name": "children",
    "logicalType": "array"
  },
  {
    "name": "dateLastModified",
    "logicalType": "date"
  },
  {
    "name": "identifier",
    "logicalType": "string"
  },
  {
    "name": "metadata",
    "logicalType": "object"
  },
  {
    "name": "name",
    "logicalType": "string"
  },
  {
    "name": "parent",
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
    "name": "type",
    "logicalType": "string"
  }
] as { name: string; logicalType?: string }[]).map((p) => [p.name, p.logicalType]),
);

describe("compat: org (consumer-can-read-publisher)", () => {
  for (const req of consumerRequired) {
    it(`publisher provides consumer-required '${req.name}'`, () => {
      expect(publisherProps.has(req.name), `missing '${req.name}' in publisher`).toBe(true);
      expect(publisherProps.get(req.name), `type mismatch on '${req.name}'`).toBe(req.logicalType);
    });
  }
});
