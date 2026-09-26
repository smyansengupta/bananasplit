import { describe, expect, it } from "vitest";

import { safeCallbackUrl, signInPath } from "./callback-url";

describe("safeCallbackUrl (same-origin relative only)", () => {
  it.each([
    ["/app/claude-builders-club/tasks/abc123", "/app/claude-builders-club/tasks/abc123"],
    ["/app/cbc/tasks?view=mine#x", "/app/cbc/tasks?view=mine#x"],
    ["/app/cbc/../cbc/tasks", "/app/cbc/tasks"],
  ])("keeps %s", (input, expected) => {
    expect(safeCallbackUrl(input)).toBe(expected);
  });

  it.each([
    "https://evil.example/app",
    "//evil.example/app",
    "/\\evil.example",
    "javascript:alert(1)",
    "app/cbc",
    "/sign-in",
    "/sign-in?callbackUrl=/app",
    "/api/cron/jobs",
    "/app/\ncbc",
    "",
    null,
    42,
  ])("drops %s", (input) => {
    expect(safeCallbackUrl(input)).toBeNull();
  });

  it("builds the sign-in path", () => {
    expect(signInPath("/app/cbc/tasks/t1")).toBe("/sign-in?callbackUrl=%2Fapp%2Fcbc%2Ftasks%2Ft1");
    expect(signInPath("https://evil.example")).toBe("/sign-in");
  });
});
