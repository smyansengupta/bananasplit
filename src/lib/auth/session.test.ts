import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the next-auth config leaf directly (not session.ts, which is the code
// under test here). Importing the real config.ts pulls in next-auth, which
// fails to resolve under Vitest's module graph outside of Next's own build.
const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));
vi.mock("@/lib/auth/config", () => ({ auth: authMock }));

const { getSession, requireUser } = await import("@/lib/auth/session");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getSession", () => {
  it("returns null when there is no Auth.js session", async () => {
    authMock.mockResolvedValue(null);
    await expect(getSession()).resolves.toBeNull();
  });

  it("maps the Auth.js session to our SessionUser shape", async () => {
    authMock.mockResolvedValue({
      user: { id: "user_1", email: "member@example.edu", name: "Test User" },
    });
    await expect(getSession()).resolves.toEqual({
      user: { id: "user_1", email: "member@example.edu", name: "Test User" },
    });
  });
});

describe("requireUser", () => {
  it("redirects to sign-in when there is no session", async () => {
    authMock.mockResolvedValue(null);
    // next/navigation's redirect() throws a NEXT_REDIRECT control-flow signal.
    await expect(requireUser()).rejects.toThrow();
  });

  it("returns the session user when signed in", async () => {
    authMock.mockResolvedValue({
      user: { id: "user_1", email: "member@example.edu", name: "Test User" },
    });
    await expect(requireUser()).resolves.toEqual({
      id: "user_1",
      email: "member@example.edu",
      name: "Test User",
    });
  });
});
