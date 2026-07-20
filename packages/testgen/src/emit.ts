/**
 * Emit executable Vitest `*.generated.test.ts` from manifest entries (T-19 · R-87, D-28).
 *
 * Each file is self-contained and deterministic (R-88): no timestamps, run ids,
 * or random values. A "GENERATED — DO NOT EDIT" header names the manifest entry
 * it derives from. Conformance tests skip (never fail) when their live-target
 * env vars are unset (R-83a, D-26); compat tests are static and embed both
 * variants' property facts (D-24).
 */
import type { ConformanceTest, CompatTest } from "./manifest.js";

const HEADER = "// GENERATED — DO NOT EDIT. Regenerate via `npm run generate-tests` (see generated-tests/manifest.json).";

/** Conformance file: fetch live records, validate each against the embedded schema (R-83, R-83a). */
export function emitConformanceTest(t: ConformanceTest, index: number): string {
  const schema = JSON.stringify(t.jsonSchema, null, 2);
  const recordsAt = JSON.stringify(t.target.recordsAt);
  return `${HEADER}
// Manifest test #${index} — conformance ${t.source}/${t.entity} (contract ${t.contractId}@${t.contentHash.slice(0, 12)}).
import { describe, it, expect } from "vitest";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const baseUrl = process.env[${JSON.stringify(t.target.baseUrlEnv)}];
const token = process.env[${JSON.stringify(t.target.tokenEnv)}];
const ready = Boolean(baseUrl && token);

const schema = ${schema} as const;
const recordsAt = ${recordsAt};

function pluck(body: unknown): unknown[] {
  if (!recordsAt) return Array.isArray(body) ? body : [];
  const at = recordsAt.split(".").reduce<any>((o, k) => (o == null ? o : o[k]), body);
  return Array.isArray(at) ? at : [];
}

// Skipped (not failed) when live credentials are absent — R-83a, D-26.
describe.skipIf(!ready)("conformance: ${t.source}/${t.entity}", () => {
  it("every record from ${t.target.path} conforms to the ${t.entity} contract schema", async () => {
    const validate = addFormats(new Ajv({ allErrors: true })).compile(schema);
    const res = await fetch(\`\${baseUrl}${t.target.path}\`, {
      headers: { Authorization: \`Bearer \${token}\` },
    });
    expect(res.ok, \`GET ${t.target.path} → \${res.status}\`).toBe(true);
    const records = pluck(await res.json());
    records.forEach((rec, i) => {
      const valid = validate(rec);
      // Name the offending record (index + contents) and the failing rule (R-83).
      expect(valid, \`record #\${i} \${JSON.stringify(rec)} violates the ${t.entity} schema: \${JSON.stringify(validate.errors)}\`).toBe(true);
    });
  });
});
`;
}

/** Compat file: static consumer-can-read-publisher over embedded property facts (R-84, D-24). */
export function emitCompatTest(t: CompatTest, index: number): string {
  const consumerRequired = JSON.stringify(t.consumerRequired, null, 2);
  const publisherProps = JSON.stringify(t.publisherProps, null, 2);
  return `${HEADER}
// Manifest test #${index} — compat ${t.entity} (consumer-can-read-publisher).
// consumer ${t.consumer.source}/${t.consumer.contractId}@${t.consumer.contentHash.slice(0, 12)}
// publisher ${t.publisher.source}/${t.publisher.contractId}@${t.publisher.contentHash.slice(0, 12)}
import { describe, it, expect } from "vitest";

const consumerRequired: { name: string; logicalType?: string }[] = ${consumerRequired};
const publisherProps = new Map<string, string | undefined>(
  (${publisherProps} as { name: string; logicalType?: string }[]).map((p) => [p.name, p.logicalType]),
);

describe("compat: ${t.entity} (consumer-can-read-publisher)", () => {
  for (const req of consumerRequired) {
    it(\`publisher provides consumer-required '\${req.name}'\`, () => {
      expect(publisherProps.has(req.name), \`missing '\${req.name}' in publisher\`).toBe(true);
      expect(publisherProps.get(req.name), \`type mismatch on '\${req.name}'\`).toBe(req.logicalType);
    });
  }
});
`;
}
