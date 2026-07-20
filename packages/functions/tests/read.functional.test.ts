import { describe, it, expect, vi, beforeEach } from "vitest";
import { repository } from "../src/repository.js";
import * as read from "../src/read.js";
import { requiredGroup, isAuthorized } from "../src/authorizer.js";

const ev = (pathParameters: any = {}) => ({ pathParameters }) as any;

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("functional-test-job read handlers (T-37 · §3.11, R-125, R-126)", () => {
  it("GET /functional-test-jobs lists jobs newest-first", async () => {
    vi.spyOn(repository, "listFunctionalJobs").mockResolvedValue([{ jobId: "fj-2" }, { jobId: "fj-1" }] as any);
    const res = await read.functionalJobs(ev());
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body!).jobs.map((j: any) => j.jobId)).toEqual(["fj-2", "fj-1"]);
  });

  it("GET /functional-test-jobs/latest returns the job + inline artifacts", async () => {
    vi.spyOn(repository, "getLatestFunctionalJob").mockResolvedValue({ jobId: "fj-2", status: "succeeded" } as any);
    vi.spyOn(repository, "getFunctionalArtifacts").mockResolvedValue({ manifest: { plans: [] }, files: [] } as any);
    const res = await read.functionalJobLatest(ev());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body!);
    expect(body.job.jobId).toBe("fj-2");
    expect(body.artifacts).toBeTruthy();
  });

  it("GET /functional-test-jobs/latest → 404 when there are no jobs", async () => {
    vi.spyOn(repository, "getLatestFunctionalJob").mockResolvedValue(undefined);
    expect((await read.functionalJobLatest(ev())).statusCode).toBe(404);
  });

  it("GET /functional-test-jobs/{jobId} returns job + inline artifacts, 404 when unknown", async () => {
    vi.spyOn(repository, "getFunctionalJob").mockResolvedValueOnce({ jobId: "fj-1", status: "running" } as any);
    vi.spyOn(repository, "getFunctionalArtifacts").mockResolvedValueOnce(undefined);
    const ok = await read.functionalJob(ev({ jobId: "fj-1" }));
    expect(ok.statusCode).toBe(200);
    expect(JSON.parse(ok.body!).job.jobId).toBe("fj-1");

    vi.spyOn(repository, "getFunctionalJob").mockResolvedValueOnce(undefined);
    expect((await read.functionalJob(ev({ jobId: "nope" }))).statusCode).toBe(404);
  });
});

describe("authorization for functional generation (T-37 · R-115a)", () => {
  it("POST /generate-functional-tests requires the writer group", () => {
    expect(requiredGroup("POST /generate-functional-tests")).toBe("writer");
    expect(isAuthorized("POST /generate-functional-tests", ["writer"])).toBe(true);
    expect(isAuthorized("POST /generate-functional-tests", ["reader"])).toBe(false);
  });

  it("the functional-test-job read routes require only reader", () => {
    expect(requiredGroup("GET /functional-test-jobs")).toBe("reader");
    expect(isAuthorized("GET /functional-test-jobs", ["reader"])).toBe(true);
    expect(isAuthorized("GET /functional-test-jobs", ["writer"])).toBe(true);
  });
});
