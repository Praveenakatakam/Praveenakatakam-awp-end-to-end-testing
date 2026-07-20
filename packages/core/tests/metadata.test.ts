import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import yaml from "js-yaml";
import { extractMetadata } from "../src/metadata.js";

const here = dirname(fileURLToPath(import.meta.url));
const validOrg = yaml.load(
  readFileSync(resolve(here, "__fixtures__/valid-org.odcs.yaml"), "utf8"),
);

describe("extractMetadata (T-03 · R-22, D-12)", () => {
  // AC-22a: metadata + entity from schema[0].name.
  it("extracts catalog metadata and entity = schema[0].name", () => {
    const m = extractMetadata(validOrg, "contract/org.odcs.yaml");
    expect(m.entity).toBe("org");
    expect(m.id).toBe("5d8f2b4a-org-oneroster-v12");
    expect(m.apiVersion).toBe("v3.1.0");
    expect(m.kind).toBe("DataContract");
    expect(m.status).toBe("active");
    expect(m.version).toBe("1.0.0");
    expect(m.name).toBe("OneRoster v1.2 Org");
    expect(m.domain).toBe("education");
    expect(Array.isArray(m.tags)).toBe(true);
  });

  // AC-22b: empty/nameless schema[] → filename-stem fallback.
  it("falls back to the filename stem when schema[] has no usable name", () => {
    const noSchema = { version: "1.0.0", apiVersion: "v3.1.0", kind: "DataContract", id: "x", status: "active" };
    const m = extractMetadata(noSchema, "contract/enrollment.odcs.yaml");
    expect(m.entity).toBe("enrollment");
  });

  it("prefers schema[0].name over the filename when both exist", () => {
    const doc = { schema: [{ name: "user" }], id: "u", version: "1.0.0", apiVersion: "v3.1.0", kind: "DataContract", status: "active" };
    const m = extractMetadata(doc, "contract/renamed.odcs.yaml");
    expect(m.entity).toBe("user");
  });
});
