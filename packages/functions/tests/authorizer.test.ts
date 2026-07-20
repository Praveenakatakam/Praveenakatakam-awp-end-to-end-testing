import { describe, it, expect, vi } from "vitest";
import { isAuthorized, requiredGroup, handleAuthorization } from "../src/authorizer.js";

describe("group rule (T-09 · R-71, D-21 · AC-57)", () => {
  it("requires writer for POST /refresh, reader for GET routes", () => {
    expect(requiredGroup("POST /refresh")).toBe("writer");
    expect(requiredGroup("GET /contracts")).toBe("reader");
    expect(requiredGroup("GET /entities/{entity}")).toBe("reader");
  });

  it("writer may refresh and read; reader may read but not refresh", () => {
    expect(isAuthorized("POST /refresh", ["writer"])).toBe(true);
    expect(isAuthorized("POST /refresh", ["writer", "reader"])).toBe(true);
    expect(isAuthorized("POST /refresh", ["reader"])).toBe(false);
    expect(isAuthorized("GET /contracts", ["reader"])).toBe(true);
    expect(isAuthorized("GET /contracts", ["writer"])).toBe(true);
    expect(isAuthorized("GET /contracts", [])).toBe(false);
  });

  it("POST /generate-tests is writer-only; GET /test-artifacts is reader-ok (T-23 · R-80a)", () => {
    expect(requiredGroup("POST /generate-tests")).toBe("writer");
    expect(requiredGroup("GET /test-artifacts")).toBe("reader");
    expect(isAuthorized("POST /generate-tests", ["writer"])).toBe(true);
    expect(isAuthorized("POST /generate-tests", ["reader"])).toBe(false); // → 403
    expect(isAuthorized("GET /test-artifacts", ["reader"])).toBe(true);
    expect(isAuthorized("GET /test-artifacts/latest", ["reader"])).toBe(true);
  });
});

describe("handleAuthorization (T-09 · R-16, R-56, D-21)", () => {
  const evt = (routeKey: string, token = "Bearer good") =>
    ({ routeKey, identitySource: [token], headers: {} }) as any;

  it("allows a valid writer token on refresh and passes context through", async () => {
    const verify = vi.fn(async () => ({ sub: "s1", username: "writer@demo", "cognito:groups": ["writer", "reader"] }));
    const res = await handleAuthorization(evt("POST /refresh"), verify as any);
    expect(res.isAuthorized).toBe(true);
    expect(res.context).toMatchObject({ sub: "s1", username: "writer@demo", groups: "writer,reader" });
  });

  it("denies a valid reader token on refresh (403)", async () => {
    const verify = vi.fn(async () => ({ sub: "s2", username: "reader@demo", "cognito:groups": ["reader"] }));
    const res = await handleAuthorization(evt("POST /refresh"), verify as any);
    expect(res.isAuthorized).toBe(false);
  });

  it("denies an invalid/expired token (verifier throws → 403)", async () => {
    const verify = vi.fn(async () => { throw new Error("token expired"); });
    const res = await handleAuthorization(evt("GET /contracts"), verify as any);
    expect(res.isAuthorized).toBe(false);
  });
});
