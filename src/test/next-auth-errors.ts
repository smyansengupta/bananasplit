/**
 * Stand-ins for the error classes "next-auth" re-exports from
 * @auth/core/errors, for unit tests: next-auth's entry point imports
 * next/server by a path vitest cannot resolve. Same shape where the app
 * relies on it: `type` comes from the class's static `type`, and
 * CredentialsSignin carries a `code` ("credentials" unless a subclass sets
 * its own, like RateLimitedSignIn's "rate_limited").
 *
 *   vi.mock("next-auth", () => import("@/test/next-auth-errors"));
 */

export class AuthError extends Error {
  type: string;

  constructor(message?: string) {
    super(message);
    this.name = new.target.name;
    this.type = (new.target as unknown as { type?: string }).type ?? "AuthError";
  }
}

export class CredentialsSignin extends AuthError {
  static type = "CredentialsSignin";
  code = "credentials";
}
