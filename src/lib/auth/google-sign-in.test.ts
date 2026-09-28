import { afterEach, describe, expect, it, vi } from "vitest";

import { googleSignInEnabled } from "./google-sign-in";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("googleSignInEnabled", () => {
  it("is on when both the client ID and secret are set", () => {
    expect(googleSignInEnabled({ AUTH_GOOGLE_ID: "id", AUTH_GOOGLE_SECRET: "secret" })).toBe(true);
  });

  it.each([
    ["neither", {}],
    ["only the ID", { AUTH_GOOGLE_ID: "id" }],
    ["only the secret", { AUTH_GOOGLE_SECRET: "secret" }],
  ])("is off with %s set", (_label, env) => {
    expect(googleSignInEnabled(env)).toBe(false);
  });

  it.each([
    ["an empty ID", { AUTH_GOOGLE_ID: "", AUTH_GOOGLE_SECRET: "secret" }],
    ["an empty secret", { AUTH_GOOGLE_ID: "id", AUTH_GOOGLE_SECRET: "" }],
    ["a whitespace ID", { AUTH_GOOGLE_ID: "  \t", AUTH_GOOGLE_SECRET: "secret" }],
    ["a whitespace secret", { AUTH_GOOGLE_ID: "id", AUTH_GOOGLE_SECRET: " \n " }],
  ])("is off with %s", (_label, env) => {
    expect(googleSignInEnabled(env)).toBe(false);
  });

  it("reads process.env by default", () => {
    vi.stubEnv("AUTH_GOOGLE_ID", "id");
    vi.stubEnv("AUTH_GOOGLE_SECRET", "secret");
    expect(googleSignInEnabled()).toBe(true);
    vi.stubEnv("AUTH_GOOGLE_SECRET", "");
    expect(googleSignInEnabled()).toBe(false);
  });
});
