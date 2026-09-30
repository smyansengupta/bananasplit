// @vitest-environment node
import { AuthError, CredentialsSignin } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The sign-in form's action, down to Auth.js's signIn(): what the user is
 * told for each outcome, and where a successful sign-in goes (an unverified
 * account included: /app sends it on to onboarding's "check your email").
 */

const { signInMock, redirectMock } = vi.hoisted(() => ({
  signInMock: vi.fn(),
  redirectMock: vi.fn((url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT ${url}`), { url });
  }),
}));
vi.mock("@/lib/auth/config", () => ({ signIn: signInMock }));
// next-auth itself does not load under vitest (see the stand-in).
vi.mock("next-auth", () => import("@/test/next-auth-errors"));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

const { passwordSignInAction } = await import("./actions");

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
}

async function submit(fields: Record<string, string>) {
  try {
    return await passwordSignInAction({}, form(fields));
  } catch (error) {
    const url = (error as { url?: string }).url;
    if (url) return { redirectedTo: url };
    throw error;
  }
}

const credentials = { email: "verify-test@example.edu", password: "pw" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  signInMock.mockImplementation(async (_provider: string, options: { redirectTo: string }) =>
    new URL(options.redirectTo, "https://bananasplit.fyi").toString(),
  );
});

describe("passwordSignInAction", () => {
  it("signs in and goes to /app (onboarding for an account with no org)", async () => {
    expect(await submit(credentials)).toEqual({ redirectedTo: "/app" });
    expect(signInMock).toHaveBeenCalledWith(
      "credentials",
      expect.objectContaining({ ...credentials, redirectTo: "/app", redirect: false }),
    );
  });

  it("returns to a safe callbackUrl, and drops an unsafe one", async () => {
    expect(await submit({ ...credentials, callbackUrl: "/invite/tok" })).toEqual({
      redirectedTo: "/invite/tok",
    });
    expect(await submit({ ...credentials, callbackUrl: "https://evil.example/x" })).toEqual({
      redirectedTo: "/app",
    });
  });

  it("says 'incorrect email or password' only for a credentials rejection", async () => {
    signInMock.mockRejectedValue(new CredentialsSignin());
    expect(await submit(credentials)).toEqual({ error: "Incorrect email or password." });
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("keeps the rate-limit message", async () => {
    class RateLimited extends CredentialsSignin {
      code = "rate_limited";
    }
    signInMock.mockRejectedValue(new RateLimited());
    expect(await submit(credentials)).toEqual({
      error: "Too many sign-in attempts. Wait a few minutes and try again.",
    });
  });

  it("reports a server configuration error instead of a wrong password (the production bug)", async () => {
    // AUTH_SECRET missing: Auth.js answers 500 without throwing, and signIn()
    // hands back its own callback URL, where the browser used to be sent.
    signInMock.mockResolvedValue("https://bananasplit.fyi/api/auth/callback/credentials?");

    const state = await submit(credentials);

    expect(state).toEqual({
      error:
        "Sign-in isn't available right now because of a problem on our end. Please try again later.",
    });
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("reports any other AuthError as a server problem too", async () => {
    class CallbackRouteError extends AuthError {
      static type = "CallbackRouteError";
    }
    signInMock.mockRejectedValue(new CallbackRouteError("authorize threw"));

    expect(await submit(credentials)).toEqual({
      error: expect.stringMatching(/isn't available right now/),
    });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("CallbackRouteError"));
  });

  it("asks for both fields before calling Auth.js", async () => {
    expect(await submit({ email: "a@example.edu" })).toEqual({
      error: "Enter your email and password.",
    });
    expect(signInMock).not.toHaveBeenCalled();
  });
});
