import { describe, it, expect, vi, beforeEach } from "vitest";
import { repository } from "../src/repository.js";
import * as read from "../src/read.js";

const ev = (pathParameters: any = {}) => ({ pathParameters }) as any;

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("test-artifacts read handlers (T-22 · R-90)", () => {
  it("GET /test-artifacts lists generation runs (AC-90)", async () => {
    vi.spyOn(repository, "listGenRuns").mockResolvedValue([{ runId: "g-2" }, { runId: "g-1" }] as any);
    const res = await read.testArtifacts(ev());
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body!).runs.map((r: any) => r.runId)).toEqual(["g-2", "g-1"]);
  });

  it("GET /test-artifacts/latest returns the run + inline artifacts (AC-90, D-32)", async () => {
    vi.spyOn(repository, "getLatestGenRun").mockResolvedValue({ runId: "g-2", counts: { conformance: 2 } } as any);
    vi.spyOn(repository, "getArtifacts").mockResolvedValue({ manifest: { tests: [] }, files: [] } as any);
    const res = await read.testArtifactsLatest(ev());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body!);
    expect(body.run.runId).toBe("g-2");
    expect(body.artifacts).toBeTruthy();
  });

  it("GET /test-artifacts/latest → 404 when there are no runs", async () => {
    vi.spyOn(repository, "getLatestGenRun").mockResolvedValue(undefined);
    expect((await read.testArtifactsLatest(ev())).statusCode).toBe(404);
  });

  it("GET /test-artifacts/{runId} returns run + inline artifacts, 404 when unknown (AC-90)", async () => {
    vi.spyOn(repository, "getGenRun").mockResolvedValueOnce({ runId: "g-1" } as any);
    vi.spyOn(repository, "getArtifacts").mockResolvedValueOnce({ manifest: { tests: [] }, files: [] } as any);
    const ok = await read.testArtifact(ev({ runId: "g-1" }));
    expect(ok.statusCode).toBe(200);
    expect(JSON.parse(ok.body!).run.runId).toBe("g-1");

    vi.spyOn(repository, "getGenRun").mockResolvedValueOnce(undefined);
    expect((await read.testArtifact(ev({ runId: "nope" }))).statusCode).toBe(404);
  });
});
