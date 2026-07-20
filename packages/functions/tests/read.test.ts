import { describe, it, expect, vi, beforeEach } from "vitest";
import { repository } from "../src/repository.js";
import * as read from "../src/read.js";

const ev = (pathParameters: any = {}, queryStringParameters: any = {}) =>
  ({ pathParameters, queryStringParameters }) as any;

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("read API handlers (T-13 · R-50..R-55)", () => {
  it("GET /contracts returns the catalog and forwards filters (AC-50)", async () => {
    const spy = vi.spyOn(repository, "listEntries").mockResolvedValue([{ source: "publisher", id: "org-1", entity: "org" } as any]);
    const res = await read.contracts(ev({}, { entity: "org" }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body!).items).toHaveLength(1);
    expect(spy).toHaveBeenCalledWith({ source: undefined, entity: "org", validation: undefined });
  });

  it("GET /contracts/{source}/{id} returns entry + history, 404 when missing (AC-51, AC-54)", async () => {
    vi.spyOn(repository, "getEntry").mockResolvedValueOnce({ entry: { id: "org-1" } as any, versions: [{ versionNumber: 1 }] });
    const ok = await read.contract(ev({ source: "publisher", id: "org-1" }));
    expect(ok.statusCode).toBe(200);
    expect(JSON.parse(ok.body!).versions).toHaveLength(1);

    vi.spyOn(repository, "getEntry").mockResolvedValueOnce(undefined);
    const missing = await read.contract(ev({ source: "publisher", id: "nope" }));
    expect(missing.statusCode).toBe(404);
  });

  it("GET /contracts/{source}/{id}/raw serves YAML, 404 when missing (AC-52, AC-54)", async () => {
    vi.spyOn(repository, "getRaw").mockResolvedValueOnce("version: 1.0.0\nkind: DataContract\n");
    const res = await read.raw(ev({ source: "publisher", id: "org-1" }, { version: "1" }));
    expect(res.statusCode).toBe(200);
    expect(res.headers!["content-type"]).toBe("application/yaml");
    expect(res.body).toContain("DataContract");

    vi.spyOn(repository, "getRaw").mockResolvedValueOnce(undefined);
    expect((await read.raw(ev({ source: "publisher", id: "x" }))).statusCode).toBe(404);
  });

  it("GET /entities/{entity} returns variants + divergent + diff for two variants (AC-53)", async () => {
    vi.spyOn(repository, "getEntityVariants").mockResolvedValue({
      entity: "user",
      variants: [
        { source: "publisher", id: "user-1", currentHash: "hA" },
        { source: "consumer", id: "user-1", currentHash: "hB" },
      ],
      divergent: true,
    });
    vi.spyOn(repository, "getRaw")
      .mockResolvedValueOnce("schema:\n  - name: user\n    properties:\n      - name: a\n        required: true\n")
      .mockResolvedValueOnce("schema:\n  - name: user\n    properties:\n      - name: a\n        required: false\n      - name: b\n");
    const res = await read.entity(ev({ entity: "user" }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body!);
    expect(body.divergent).toBe(true);
    expect(body.diff).toBeTruthy();
    expect(body.diff.onlyInB.map((p: any) => p.path)).toContain("user.b");
  });

  it("orders the diff publisher-first regardless of storage order (R-53; A=publisher)", async () => {
    // Real DynamoDB byEntity GSI returns source-ASCENDING → consumer BEFORE publisher.
    vi.spyOn(repository, "getEntityVariants").mockResolvedValue({
      entity: "user",
      variants: [
        { source: "consumer", id: "user-1", currentHash: "hB" },
        { source: "publisher", id: "user-1", currentHash: "hA" },
      ],
      divergent: true,
    } as any);
    // Resolve raw by source (not call order) so the assertion pins direction, not luck.
    vi.spyOn(repository, "getRaw").mockImplementation((async (source: string) =>
      source === "publisher"
        ? "schema:\n  - name: user\n    properties:\n      - name: pubOnly\n        required: true\n"
        : "schema:\n  - name: user\n    properties:\n      - name: conOnly\n        required: true\n") as any);
    const res = await read.entity(ev({ entity: "user" }));
    const body = JSON.parse(res.body!);
    // A = publisher: publisher-only prop is onlyInA, consumer-only is onlyInB.
    expect(body.diff.onlyInA.map((p: any) => p.path)).toContain("user.pubOnly");
    expect(body.diff.onlyInB.map((p: any) => p.path)).toContain("user.conOnly");
    // Variants are returned publisher-first too (matches the SPA's labels).
    expect(body.variants[0].source).toBe("publisher");
  });

  it("GET /entities/{entity} 404 when the entity is unknown (AC-54)", async () => {
    vi.spyOn(repository, "getEntityVariants").mockResolvedValue({ entity: "ghost", variants: [], divergent: false });
    expect((await read.entity(ev({ entity: "ghost" }))).statusCode).toBe(404);
  });

  it("GET /crawls and /crawls/{runId} (AC-55)", async () => {
    vi.spyOn(repository, "listRuns").mockResolvedValue([{ runId: "r1" }]);
    expect((await read.crawls(ev())).statusCode).toBe(200);
    vi.spyOn(repository, "getRun").mockResolvedValueOnce({ runId: "r1" });
    expect((await read.crawl(ev({ runId: "r1" }))).statusCode).toBe(200);
    vi.spyOn(repository, "getRun").mockResolvedValueOnce(undefined);
    expect((await read.crawl(ev({ runId: "z" }))).statusCode).toBe(404);
  });
});
