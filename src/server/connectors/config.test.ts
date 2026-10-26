import { describe, expect, it } from "vitest";

import { claudeConnectorUrl, connectorsConfig, connectorsConfigProblems } from "./config";

const ON = {
  CONNECTORS_ENABLED: "true",
  WORKOS_API_KEY: "sk_test_x",
  WORKOS_AUTHKIT_DOMAIN: "https://club-123.authkit.app/",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
};

describe("connectorsConfig", () => {
  it("is on only with the flag and both WorkOS settings", () => {
    expect(connectorsConfig(ON)).toEqual({
      apiKey: "sk_test_x",
      authkitOrigin: "https://club-123.authkit.app",
      resourceUrl: "http://localhost:3000/api/mcp",
      resourceMetadataUrl: "http://localhost:3000/.well-known/oauth-protected-resource/api/mcp",
    });
    expect(connectorsConfig({ ...ON, CONNECTORS_ENABLED: "" })).toBeNull();
    expect(connectorsConfig({ ...ON, CONNECTORS_ENABLED: "1" })).toBeNull();
    expect(connectorsConfig({ ...ON, WORKOS_API_KEY: " " })).toBeNull();
    expect(connectorsConfig({ ...ON, WORKOS_AUTHKIT_DOMAIN: "" })).toBeNull();
  });

  it("wants https for AuthKit, except on this machine (the WorkOS emulator)", () => {
    expect(
      connectorsConfig({ ...ON, WORKOS_AUTHKIT_DOMAIN: "http://auth.example.org" }),
    ).toBeNull();
    expect(connectorsConfig({ ...ON, WORKOS_AUTHKIT_DOMAIN: "not a url" })).toBeNull();
    expect(
      connectorsConfig({ ...ON, WORKOS_AUTHKIT_DOMAIN: "http://localhost:4100" })?.authkitOrigin,
    ).toBe("http://localhost:4100");
  });

  it("stays off when production has no usable app URL, instead of failing the page", () => {
    expect(
      connectorsConfig({ ...ON, NEXT_PUBLIC_APP_URL: "", VERCEL_ENV: "production" }),
    ).toBeNull();
  });
});

describe("connectorsConfigProblems", () => {
  it("says nothing while the flag is off", () => {
    expect(connectorsConfigProblems({})).toEqual([]);
    expect(connectorsConfigProblems({ WORKOS_API_KEY: "x" })).toEqual([]);
  });

  it("names what a wanted configuration lacks", () => {
    expect(connectorsConfigProblems({ CONNECTORS_ENABLED: "true" })).toEqual([
      "WORKOS_API_KEY is not set",
      "WORKOS_AUTHKIT_DOMAIN is not set",
    ]);
    expect(
      connectorsConfigProblems({ ...ON, WORKOS_AUTHKIT_DOMAIN: "http://auth.example.org" }),
    ).toEqual(["WORKOS_AUTHKIT_DOMAIN must be an https URL (http only on localhost)"]);
    expect(connectorsConfigProblems(ON)).toEqual([]);
  });
});

describe("claudeConnectorUrl", () => {
  it("opens Claude's Add custom connector dialog with the MCP URL filled in", () => {
    const url = new URL(claudeConnectorUrl("https://bananasplit.fyi/api/mcp"));
    expect(url.origin + url.pathname).toBe("https://claude.ai/customize/connectors");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      modal: "add-custom-connector",
      connectorName: "Bananasplit",
      connectorUrl: "https://bananasplit.fyi/api/mcp",
    });
  });
});
