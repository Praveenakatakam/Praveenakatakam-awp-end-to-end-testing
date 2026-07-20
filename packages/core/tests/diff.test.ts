import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import yaml from "js-yaml";
import { diffContracts } from "../src/diff.js";

const here = dirname(fileURLToPath(import.meta.url));
const org = yaml.load(readFileSync(resolve(here, "__fixtures__/valid-org.odcs.yaml"), "utf8"));

const base = {
  schema: [
    {
      name: "user",
      properties: [
        { name: "sourcedId", required: true, logicalType: "string" },
        { name: "username", required: true, logicalType: "string" },
        { name: "email", required: true, logicalType: "string" },
      ],
    },
  ],
};
const variant = {
  schema: [
    {
      name: "user",
      properties: [
        { name: "sourcedId", required: true, logicalType: "string" },
        { name: "username", required: true, logicalType: "string" },
        { name: "email", required: false, logicalType: "string" }, // changed
        { name: "middleName", required: false, logicalType: "string" }, // added in variant
        // "email" kept but "password"? none removed here; remove username instead:
      ],
    },
  ],
};

describe("diffContracts (T-05 · R-53, D-18)", () => {
  // AC-53 (identical org): no divergence.
  it("reports no differences for identical contracts", () => {
    const d = diffContracts(org, org);
    expect(d.onlyInA).toEqual([]);
    expect(d.onlyInB).toEqual([]);
    expect(d.changed).toEqual([]);
  });

  // AC-53 (divergent): added / removed / changed by property path.
  it("detects added, removed, and changed properties by path", () => {
    // Remove "email" from base-vs-variant symmetry by using a 3rd shape:
    const a = base;
    const b = {
      schema: [
        {
          name: "user",
          properties: [
            { name: "sourcedId", required: true, logicalType: "string" },
            // username removed
            { name: "email", required: false, logicalType: "string" }, // required changed
            { name: "middleName", required: false, logicalType: "string" }, // added
          ],
        },
      ],
    };
    const d = diffContracts(a, b);
    expect(d.onlyInB.map((p) => p.path)).toContain("user.middleName");
    expect(d.onlyInA.map((p) => p.path)).toContain("user.username");
    const emailChange = d.changed.find((c) => c.path === "user.email");
    expect(emailChange).toBeTruthy();
    expect(emailChange!.field).toBe("required");
    expect(emailChange!.a).toBe(true);
    expect(emailChange!.b).toBe(false);
  });

  it("is order-insensitive (reordering properties is not a change)", () => {
    const reordered = {
      schema: [
        {
          name: "user",
          properties: [...base.schema[0].properties].reverse(),
        },
      ],
    };
    const d = diffContracts(base, reordered);
    expect(d.onlyInA).toEqual([]);
    expect(d.onlyInB).toEqual([]);
    expect(d.changed).toEqual([]);
  });
});
