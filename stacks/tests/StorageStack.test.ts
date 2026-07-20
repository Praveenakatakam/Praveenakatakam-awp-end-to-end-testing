import { describe, it, expect, beforeAll } from "vitest";
import { Match, type Template } from "aws-cdk-lib/assertions";
import { synthStack } from "./synth.js";
import { StorageStack } from "../StorageStack.js";

// T-06a — offline CloudFormation-synth assertions (R-40, R-42 · AC-40, AC-42).
describe("StorageStack", () => {
  let template: Template;
  beforeAll(async () => {
    template = await synthStack(StorageStack);
  });

  it("provisions exactly one DynamoDB table (single-table design)", () => {
    template.resourceCountIs("AWS::DynamoDB::Table", 1);
  });

  it("keys the table on PK (HASH) + SK (RANGE)", () => {
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      KeySchema: Match.arrayWith([
        { AttributeName: "PK", KeyType: "HASH" },
        { AttributeName: "SK", KeyType: "RANGE" },
      ]),
      BillingMode: "PAY_PER_REQUEST",
    });
  });

  it("defines the byEntity and byKind global secondary indexes", () => {
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      GlobalSecondaryIndexes: Match.arrayWith([
        Match.objectLike({ IndexName: "byEntity" }),
        Match.objectLike({ IndexName: "byKind" }),
      ]),
    });
  });

  it("enables TTL on `ttl` (for the crawl single-flight lock — D-15) and SSE at rest", () => {
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      TimeToLiveSpecification: { AttributeName: "ttl", Enabled: true },
      SSESpecification: { SSEEnabled: true },
    });
  });

  it("provisions an S3 bucket that blocks all public access", () => {
    template.resourceCountIs("AWS::S3::Bucket", 1);
    template.hasResourceProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      BucketEncryption: Match.anyValue(),
    });
  });
});
