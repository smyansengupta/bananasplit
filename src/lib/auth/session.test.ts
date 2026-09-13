import { describe, expect, it } from "vitest";

import { requireUser } from "@/lib/auth/session";

describe("requireUser", () => {
  it("redirects to sign-in when there is no session (Auth.js isn't wired up until Phase 1.1, so getSession() always returns null today)", async () => {
    // next/navigation's redirect() throws a NEXT_REDIRECT control-flow signal.
    await expect(requireUser()).rejects.toThrow();
  });
});
