// GENERATED — DO NOT EDIT. Regenerate via `npm run generate-tests` (see generated-tests/manifest.json).
// Manifest test #5 — compat user (consumer-can-read-publisher).
// consumer consumer/7a1c9e02-user-oneroster-v12@4228731fdfdc
// publisher publisher/6b1c3d4e-user-oneroster-v12@c8a233c90c38
import { describe, it, expect } from "vitest";

const consumerRequired: { name: string; logicalType?: string }[] = [
  {
    "name": "dateLastModified",
    "logicalType": "date"
  },
  {
    "name": "enabledUser",
    "logicalType": "boolean"
  },
  {
    "name": "familyName",
    "logicalType": "string"
  },
  {
    "name": "givenName",
    "logicalType": "string"
  },
  {
    "name": "roles",
    "logicalType": "array"
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
    "name": "username",
    "logicalType": "string"
  }
];
const publisherProps = new Map<string, string | undefined>(
  ([
  {
    "name": "dateLastModified",
    "logicalType": "date"
  },
  {
    "name": "email",
    "logicalType": "string"
  },
  {
    "name": "enabledUser",
    "logicalType": "boolean"
  },
  {
    "name": "familyName",
    "logicalType": "string"
  },
  {
    "name": "givenName",
    "logicalType": "string"
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
    "name": "middleName",
    "logicalType": "string"
  },
  {
    "name": "password",
    "logicalType": "string"
  },
  {
    "name": "roles",
    "logicalType": "array"
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
    "name": "username",
    "logicalType": "string"
  }
] as { name: string; logicalType?: string }[]).map((p) => [p.name, p.logicalType]),
);

describe("compat: user (consumer-can-read-publisher)", () => {
  for (const req of consumerRequired) {
    it(`publisher provides consumer-required '${req.name}'`, () => {
      expect(publisherProps.has(req.name), `missing '${req.name}' in publisher`).toBe(true);
      expect(publisherProps.get(req.name), `type mismatch on '${req.name}'`).toBe(req.logicalType);
    });
  }
});
