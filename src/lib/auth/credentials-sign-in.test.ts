// @vitest-environment node
import { AuthError, CredentialsSignin } from "next-auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * How Auth.js's signIn("credentials") outcomes map to what the forms say:
 * only a credentials rejection is "wrong password"; a configuration error
 * (which Auth.js reports without throwing) and any other AuthError are a
 * server problem, logged with their type.
 */

const { signInMock } = vi.hoisted(() => ({ signInMock: vi.fn() }));
vi.mock("@/lib/auth/config", () => ({ signIn: signInMock }));
// next-auth itself does not load under vitest (see the stand-in).
vi.mock("next-auth", () => import("@/test/next-auth-errors"));

const { credentialsSignIn } = await import("./credentials-sign-in");

/** Like RateLimitedSignIn in config.ts. */
class RateLimited extends CredentialsSignin {
  code = "rate_limited";
}
/** An AuthError that is not a credentials rejection (e.g. an adapter failure). */
class AdapterError extends AuthError {
  static type = "AdapterError";
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  signInMock.mockReset();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe("credentialsSignIn", () => {
  it("signs in without letting Auth.js redirect, and reports success", async () => {
    signInMock.mockResolvedValue("https://clubport.smyan.dev/app");

    expect(await credentialsSignIn("a@example.edu", "pw", "/app")).toEqual({ ok: true });
    expect(signInMock).toHaveBeenCalledWith("credentials", {
      email: "a@example.edu",
      password: "pw",
      redirectTo: "/app",
      redirect: false,
    });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("calls a credentials rejection invalid, and keeps the rate-limit code apart", async () => {
    signInMock.mockRejectedValueOnce(new CredentialsSignin());
    expect(await credentialsSignIn("a@example.edu", "pw", "/app")).toEqual({
      ok: false,
      reason: "invalid",
    });

    signInMock.mockRejectedValueOnce(new RateLimited());
    expect(await credentialsSignIn("a@example.edu", "pw", "/app")).toEqual({
      ok: false,
      reason: "rate_limited",
    });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("reports a configuration error (no throw, Auth.js's own callback URL back) as unavailable", async () => {
    // What signIn() returns when @auth/core answers MissingSecret with a 500.
    signInMock.mockResolvedValue("https://clubport.smyan.dev/api/auth/callback/credentials?");

    expect(await credentialsSignIn("a@example.edu", "pw", "/app")).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/configuration error.*MissingSecret/),
    );
  });

  it("reports any other AuthError as unavailable and logs its type", async () => {
    signInMock.mockRejectedValue(new AdapterError("db down"));

    expect(await credentialsSignIn("a@example.edu", "pw", "/app")).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("AdapterError"));
  });

  it("rethrows what is not an Auth.js error", async () => {
    const boom = new Error("unexpected");
    signInMock.mockRejectedValue(boom);

    await expect(credentialsSignIn("a@example.edu", "pw", "/app")).rejects.toBe(boom);
  });
});
