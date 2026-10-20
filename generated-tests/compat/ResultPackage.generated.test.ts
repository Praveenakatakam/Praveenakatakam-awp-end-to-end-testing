// GENERATED — DO NOT EDIT. Regenerate via `npm run generate-tests` (see generated-tests/manifest.json).
// Manifest test #2 — compat ResultPackage (consumer-can-read-publisher).
// consumer score/urn:bawp:score:result-package-consumer@6129a4cf2778
// publisher deliver/urn:bawp:deliver:result-package@5be92a0fe024
import { describe, it, expect } from "vitest";

const consumerRequired: { name: string; logicalType?: string }[] = [
  {
    "name": "assignmentId",
    "logicalType": "string"
  },
  {
    "name": "classId",
    "logicalType": "string"
  },
  {
    "name": "eventId",
    "logicalType": "string"
  },
  {
    "name": "itemResponses",
    "logicalType": "array"
  },
  {
    "name": "schemaVersion",
    "logicalType": "string"
  },
  {
    "name": "sessionId",
    "logicalType": "string"
  },
  {
    "name": "studentId",
    "logicalType": "string"
  },
  {
    "name": "taskId",
    "logicalType": "string"
  },
  {
    "name": "tenantId",
    "logicalType": "string"
  }
];
const publisherProps = new Map<string, string | undefined>(
  ([
  {
    "name": "assignmentId",
    "logicalType": "string"
  },
  {
    "name": "classId",
    "logicalType": "string"
  },
  {
    "name": "eventId",
    "logicalType": "string"
  },
  {
    "name": "itemResponses",
    "logicalType": "array"
  },
  {
    "name": "itemResponses[].itemId",
    "logicalType": "string"
  },
  {
    "name": "itemResponses[].response",
    "logicalType": "object"
  },
  {
    "name": "itemResponses[].responseKey",
    "logicalType": "string"
  },
  {
    "name": "resultsPackageLocation",
    "logicalType": "string"
  },
  {
    "name": "schemaVersion",
    "logicalType": "string"
  },
  {
    "name": "sessionId",
    "logicalType": "string"
  },
  {
    "name": "studentId",
    "logicalType": "string"
  },
  {
    "name": "taskId",
    "logicalType": "string"
  },
  {
    "name": "tenantId",
    "logicalType": "string"
  }
] as { name: string; logicalType?: string }[]).map((p) => [p.name, p.logicalType]),
);

describe("compat: ResultPackage (consumer-can-read-publisher)", () => {
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
