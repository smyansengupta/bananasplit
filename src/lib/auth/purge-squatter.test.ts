import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db/clients", () => ({ authDb: {} }));

import { purgeSquatterBeforeGoogleSignIn, squatterStore, verifiedGoogleEmail } from "./purge-squatter";

afterEach(() => vi.restoreAllMocks());

describe("squatter purge before a verified Google sign-in (0A Fix 4(d))", () => {
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

  it("purges the address through app.purge_unverified_users before Auth.js looks it up", async () => {
    const purge = vi.spyOn(squatterStore, "purge").mockResolvedValue(1);
    await purgeSquatterBeforeGoogleSignIn({
      account: { provider: "google" },
      profile: { email: "owner@example.edu", email_verified: true },
    });
    expect(purge).toHaveBeenCalledWith("owner@example.edu");
  });

  it("never blocks the sign-in when the purge fails, and skips unverified profiles", async () => {
    const purge = vi.spyOn(squatterStore, "purge").mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(
      purgeSquatterBeforeGoogleSignIn({
        account: { provider: "google" },
        profile: { email: "owner@example.edu", email_verified: true },
      }),
    ).resolves.toBeUndefined();

    purge.mockClear();
    await purgeSquatterBeforeGoogleSignIn({
      account: { provider: "google" },
      profile: { email: "owner@example.edu", email_verified: false },
    });
    expect(purge).not.toHaveBeenCalled();
  });
});
