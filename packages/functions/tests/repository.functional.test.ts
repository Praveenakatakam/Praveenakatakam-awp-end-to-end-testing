import { describe, it, expect, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { repository, type FunctionalJobRecord } from "../src/repository.js";

const ddb = mockClient(DynamoDBDocumentClient);
const s3 = mockClient(S3Client);

beforeEach(() => {
  ddb.reset();
  s3.reset();
});

function job(over: Partial<FunctionalJobRecord> = {}): FunctionalJobRecord {
  return {
    jobId: "fj-1",
    status: "pending",
    startedAt: "2026-07-16T00:00:00Z",
    modelId: "claude-opus-4-8",
    promptVersion: "v1",
    ...over,
  };
}

/** Minimal S3 body that mimics the AWS SDK's transformToString(). */
function s3Body(text: string) {
  return { transformToString: async () => text } as any;
}

describe("functional-job repository (T-35 · §3.11, R-124)", () => {
  it("writeFunctionalJob persists an FJOB item with kind=FUNCTIONAL_GEN", async () => {
    ddb.on(PutCommand).resolves({});
    await repository.writeFunctionalJob(job());
    const item = (ddb.commandCalls(PutCommand)[0].args[0].input as any).Item;
    expect(item.PK).toBe("FJOB#fj-1");
    expect(item.SK).toBe("FJOB");
    expect(item.kind).toBe("FUNCTIONAL_GEN");
    expect(item.status).toBe("pending");
    expect(item.modelId).toBe("claude-opus-4-8");
  });

  it("listFunctionalJobs queries byKind=FUNCTIONAL_GEN newest-first (disjoint from CRAWL/GENERATION)", async () => {
    ddb.on(QueryCommand).resolves({ Items: [{ jobId: "fj-2" }, { jobId: "fj-1" }] });
    const jobs = await repository.listFunctionalJobs();
    const input = ddb.commandCalls(QueryCommand)[0].args[0].input as any;
    expect(input.IndexName).toBe("byKind");
    expect(input.ExpressionAttributeValues[":k"]).toBe("FUNCTIONAL_GEN");
    expect(input.ScanIndexForward).toBe(false);
    expect(jobs.map((j) => j.jobId)).toEqual(["fj-2", "fj-1"]);
  });

  it("getFunctionalJob fetches by jobId", async () => {
    ddb.on(GetCommand).resolves({ Item: job({ status: "succeeded", planCount: 3 }) });
    const got = await repository.getFunctionalJob("fj-1");
    const key = (ddb.commandCalls(GetCommand)[0].args[0].input as any).Key;
    expect(key).toEqual({ PK: "FJOB#fj-1", SK: "FJOB" });
    expect(got?.status).toBe("succeeded");
    expect(got?.planCount).toBe(3);
  });

  it("getLatestFunctionalJob returns the newest, undefined when none", async () => {
    ddb.on(QueryCommand).resolves({ Items: [{ jobId: "fj-9" }, { jobId: "fj-8" }] });
    expect((await repository.getLatestFunctionalJob())?.jobId).toBe("fj-9");
    ddb.on(QueryCommand).resolves({ Items: [] });
    expect(await repository.getLatestFunctionalJob()).toBeUndefined();
  });

  it("putFunctionalArtifacts stores JSON under functional-tests/{jobId}/ and returns the key", async () => {
    s3.on(PutObjectCommand).resolves({});
    const key = await repository.putFunctionalArtifacts("fj-1", { manifest: {}, files: [] });
    expect(key).toBe("functional-tests/fj-1/artifacts.json");
    const put = s3.commandCalls(PutObjectCommand)[0].args[0].input as any;
    expect(put.Key).toBe("functional-tests/fj-1/artifacts.json");
    expect(put.ContentType).toBe("application/json");
  });

  it("getFunctionalArtifacts parses the stored object, undefined on NoSuchKey", async () => {
    s3.on(GetObjectCommand).resolves({ Body: s3Body(JSON.stringify({ files: [{ path: "functional/x.ts" }] })) });
    const arts = await repository.getFunctionalArtifacts("fj-1");
    expect(arts.files[0].path).toBe("functional/x.ts");

    s3.reset();
    s3.on(GetObjectCommand).rejects(Object.assign(new Error("missing"), { name: "NoSuchKey" }));
    expect(await repository.getFunctionalArtifacts("nope")).toBeUndefined();
  });
});

describe("plan cache (T-35 · §3.11, R-119, D-52 lockfile)", () => {
  it("putCachedPlan writes JSON keyed by input hash", async () => {
    s3.on(PutObjectCommand).resolves({});
    await repository.putCachedPlan("abc123", { title: "t", inputHash: "abc123" });
    const put = s3.commandCalls(PutObjectCommand)[0].args[0].input as any;
    expect(put.Key).toBe("functional-tests/plan-cache/abc123.json");
  });

  it("getCachedPlan returns a hit, undefined on a miss (NoSuchKey)", async () => {
    s3.on(GetObjectCommand).resolves({ Body: s3Body(JSON.stringify({ title: "t", inputHash: "abc123" })) });
    expect((await repository.getCachedPlan("abc123"))?.inputHash).toBe("abc123");

    s3.reset();
    s3.on(GetObjectCommand).rejects(Object.assign(new Error("missing"), { name: "NoSuchKey" }));
    expect(await repository.getCachedPlan("missing")).toBeUndefined();
  });
});
