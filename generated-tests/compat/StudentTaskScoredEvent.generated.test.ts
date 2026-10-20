// GENERATED — DO NOT EDIT. Regenerate via `npm run generate-tests` (see generated-tests/manifest.json).
// Manifest test #3 — compat StudentTaskScoredEvent (consumer-can-read-publisher).
// consumer report/urn:bawp:report:student-scored-task-consumer@6c4993c4ddfe
// publisher score/urn:bawp:score:student-scored-task@6b616339965e
import { describe, it, expect } from "vitest";

const consumerRequired: { name: string; logicalType?: string }[] = [
  {
    "name": "eventId",
    "logicalType": "string"
  },
  {
    "name": "items",
    "logicalType": "array"
  },
  {
    "name": "schemaVersion",
    "logicalType": "string"
  },
  {
    "name": "task",
    "logicalType": "object"
  }
];
const publisherProps = new Map<string, string | undefined>(
  ([
  {
    "name": "eventId",
    "logicalType": "string"
  },
  {
    "name": "items",
    "logicalType": "array"
  },
  {
    "name": "items[].assignmentId",
    "logicalType": "string"
  },
  {
    "name": "items[].classId",
    "logicalType": "string"
  },
  {
    "name": "items[].comment",
    "logicalType": "string"
  },
  {
    "name": "items[].createdAt",
    "logicalType": "string"
  },
  {
    "name": "items[].itemId",
    "logicalType": "string"
  },
  {
    "name": "items[].maxScore",
    "logicalType": "number"
  },
  {
    "name": "items[].responseKey",
    "logicalType": "string"
  },
  {
    "name": "items[].score",
    "logicalType": "number"
  },
  {
    "name": "items[].scoredAt",
    "logicalType": "string"
  },
  {
    "name": "items[].sessionId",
    "logicalType": "string"
  },
  {
    "name": "items[].status",
    "logicalType": "string"
  },
  {
    "name": "items[].studentId",
    "logicalType": "string"
  },
  {
    "name": "items[].taskId",
    "logicalType": "string"
  },
  {
    "name": "items[].tenantId",
    "logicalType": "string"
  },
  {
    "name": "items[].type",
    "logicalType": "string"
  },
  {
    "name": "items[].updatedAt",
    "logicalType": "string"
  },
  {
    "name": "schemaVersion",
    "logicalType": "string"
  },
  {
    "name": "task",
    "logicalType": "object"
  }
] as { name: string; logicalType?: string }[]).map((p) => [p.name, p.logicalType]),
);

describe("compat: StudentTaskScoredEvent (consumer-can-read-publisher)", () => {
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
