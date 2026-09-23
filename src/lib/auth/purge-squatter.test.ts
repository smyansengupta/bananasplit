import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/db/clients", () => ({ authDb: {} }));

import { verifiedGoogleEmail } from "./purge-squatter";

// The purge itself runs from googleSignInGate; see google-linking.test.ts.
describe("verified Google address for the squatter purge (0A Fix 4(d))", () => {
  it("acts only on a Google sign-in whose address Google verified", () => {
    expect(
      verifiedGoogleEmail({
        account: { provider: "google" },
        profile: { email: " Real.Owner@Example.edu ", email_verified: true },
      }),
    ).toBe("real.owner@example.edu");
    expect(
      verifiedGoogleEmail({
        account: { provider: "google" },
        profile: { email: "x@example.edu", email_verified: false },
      }),
    ).toBeNull();
    expect(
      verifiedGoogleEmail({ account: { provider: "google" }, profile: { email: "x@example.edu" } }),
    ).toBeNull();
    expect(
      verifiedGoogleEmail({
        account: { provider: "credentials" },
        profile: { email: "x@example.edu", email_verified: true },
      }),
    ).toBeNull();
  });
});
