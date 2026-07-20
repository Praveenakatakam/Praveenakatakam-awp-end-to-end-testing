import { describe, it, expect, beforeAll } from "vitest";
import { type Template } from "aws-cdk-lib/assertions";
import { synthStacks } from "./synth.js";
import { StorageStack } from "../StorageStack.js";
import { AuthStack } from "../AuthStack.js";
import { ApiStack } from "../ApiStack.js";
import { WebStack } from "../WebStack.js";

// T-14 (infra) — validates the full four-stack chain wires up and WebStack synths.
describe("WebStack (full-app wiring)", () => {
  let template: Template;
  beforeAll(async () => {
    template = await synthStacks([StorageStack, AuthStack, ApiStack, WebStack], WebStack);
  });

  it("provisions the static site bucket", () => {
    const buckets = template.findResources("AWS::S3::Bucket");
    expect(Object.keys(buckets).length).toBeGreaterThanOrEqual(1);
  });
});
