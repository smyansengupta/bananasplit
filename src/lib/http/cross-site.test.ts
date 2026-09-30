import { describe, expect, it } from "vitest";

import { isCrossSite } from "./cross-site";

function req(url: string, headers: Record<string, string>): Request {
  return new Request(url, { method: "POST", headers });
}

describe("isCrossSite", () => {
  it("lets same-site requests through even when request.url names an internal host", () => {
    // Behind a proxy, request.url is the bound host; the browser's Host is the public one.
    expect(
      isCrossSite(req("http://localhost:3000/api/profile/avatar", { origin: "https://clubport.app", host: "clubport.app" })),
    ).toBe(false);
  });

  it("refuses another site's browser request", () => {
    expect(
      isCrossSite(req("https://clubport.app/api/profile/avatar", { origin: "https://evil.example", host: "clubport.app" })),
    ).toBe(true);
  });

  it("treats a request with no Origin as not cross-site, and a garbled Origin as cross-site", () => {
    expect(isCrossSite(req("https://clubport.app/api/x", { host: "clubport.app" }))).toBe(false);
    expect(isCrossSite(req("https://clubport.app/api/x", { origin: "not a url", host: "clubport.app" }))).toBe(true);
  });

  it("compares ports too", () => {
    expect(
      isCrossSite(req("http://localhost:3510/api/x", { origin: "http://localhost:3999", host: "localhost:3510" })),
    ).toBe(true);
  });
});
