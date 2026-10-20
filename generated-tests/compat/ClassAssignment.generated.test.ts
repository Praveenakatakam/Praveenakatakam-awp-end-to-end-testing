// GENERATED — DO NOT EDIT. Regenerate via `npm run generate-tests` (see generated-tests/manifest.json).
// Manifest test #1 — compat ClassAssignment (consumer-can-read-publisher).
// consumer frontend/urn:bawp:frontend:class-assignment-monitor-consumer@c8514c64cdfb
// publisher deliver/urn:bawp:deliver:class-assignment-monitor-api@97a270748c02
import { describe, it, expect } from "vitest";

const consumerRequired: { name: string; logicalType?: string }[] = [
  {
    "name": "assignmentTitle",
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
    "name": "registrationCount",
    "logicalType": "integer"
  },
  {
    "name": "scheduledFor",
    "logicalType": "string"
  },
  {
    "name": "startedAt",
    "logicalType": "string"
  },
  {
    "name": "status",
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
    "name": "assignmentTitle",
    "logicalType": "string"
  },
  {
    "name": "classAssignmentInfo",
    "logicalType": "string"
  },
  {
    "name": "classId",
    "logicalType": "string"
  },
  {
    "name": "className",
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
    "name": "registrationCount",
    "logicalType": "integer"
  },
  {
    "name": "scheduledFor",
    "logicalType": "string"
  },
  {
    "name": "startedAt",
    "logicalType": "string"
  },
  {
    "name": "status",
    "logicalType": "string"
  },
  {
    "name": "tenantId",
    "logicalType": "string"
  }
] as { name: string; logicalType?: string }[]).map((p) => [p.name, p.logicalType]),
);

describe("compat: ClassAssignment (consumer-can-read-publisher)", () => {
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
