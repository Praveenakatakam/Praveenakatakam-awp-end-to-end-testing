import { describe, it, expect, vi, beforeEach } from "vitest";
import { repository } from "../src/repository.js";
import * as read from "../src/read.js";
import { isAuthorized, requiredGroup } from "../src/authorizer.js";

const ev = (pathParameters: any = {}, queryStringParameters: any = {}) =>
  ({ pathParameters, queryStringParameters }) as any;

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("requirements read handlers (T-30 · R-109…R-112)", () => {
  it("GET /requirements returns rows carrying the enumerated fields + forwards filters (AC-109)", async () => {
    const row = {
      source: "publisher", id: "R-10", section: "3.2 API", earsType: "event",
      modality: "SHALL", earsConforming: true, changedInLastCrawl: false,
    };
    const spy = vi.spyOn(repository, "listRequirements").mockResolvedValue([row as any]);
    const res = await read.requirements(ev({}, { source: "publisher", earsType: "event", conforming: "false" }));
    expect(res.statusCode).toBe(200);
    const items = JSON.parse(res.body!).items;
    expect(items).toHaveLength(1);
    // the response row carries every field AC-109 enumerates
    expect(items[0]).toMatchObject({
      source: "publisher", id: "R-10", section: "3.2 API", earsType: "event",
      modality: "SHALL", earsConforming: true, changedInLastCrawl: false,
    });
    expect(spy).toHaveBeenCalledWith({ source: "publisher", earsType: "event", conforming: false });
  });

  it("GET /requirements maps conforming=true → true (not just the false path)", async () => {
    const spy = vi.spyOn(repository, "listRequirements").mockResolvedValue([]);
    await read.requirements(ev({}, { conforming: "true" }));
    expect(spy).toHaveBeenCalledWith({ source: undefined, earsType: undefined, conforming: true });
  });

  it("GET /requirements leaves conforming undefined when the param is absent", async () => {
    const spy = vi.spyOn(repository, "listRequirements").mockResolvedValue([]);
    await read.requirements(ev({}, {}));
    expect(spy).toHaveBeenCalledWith({ source: undefined, earsType: undefined, conforming: undefined });
  });

  it("GET /requirements/{source} returns the set, 404 when unknown (AC-110, AC-112)", async () => {
    vi.spyOn(repository, "getRequirementsForSource").mockResolvedValueOnce({
      source: "publisher", specVersion: "0.1.0", specHash: "h1", lastCrawledAt: "t", requirements: [{ id: "R-01" } as any],
    });
    const ok = await read.requirementsForSource(ev({ source: "publisher" }));
    expect(ok.statusCode).toBe(200);
    expect(JSON.parse(ok.body!)).toMatchObject({ source: "publisher", specVersion: "0.1.0" });

    vi.spyOn(repository, "getRequirementsForSource").mockResolvedValueOnce(undefined);
    expect((await read.requirementsForSource(ev({ source: "nope" }))).statusCode).toBe(404);
  });

  it("GET /requirements/{source}/{id} returns one, 404 when unknown (AC-111, AC-112)", async () => {
    vi.spyOn(repository, "getRequirement").mockResolvedValueOnce({ source: "publisher", id: "R-01" } as any);
    const ok = await read.requirement(ev({ source: "publisher", id: "R-01" }));
    expect(ok.statusCode).toBe(200);
    expect(JSON.parse(ok.body!).id).toBe("R-01");

    vi.spyOn(repository, "getRequirement").mockResolvedValueOnce(undefined);
    expect((await read.requirement(ev({ source: "publisher", id: "R-404" }))).statusCode).toBe(404);
  });
});

describe("requirements routes are reader-authorised (T-30 · R-112, D-21)", () => {
  it("a reader may call the GET /requirements routes; they are not writer-gated", () => {
    for (const routeKey of ["GET /requirements", "GET /requirements/{source}", "GET /requirements/{source}/{id}"]) {
      expect(requiredGroup(routeKey)).toBe("reader");
      expect(isAuthorized(routeKey, ["reader"])).toBe(true);
      expect(isAuthorized(routeKey, [])).toBe(false); // no group → denied
    }
  });
});
