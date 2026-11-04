import { describe, expect, it, vi } from "vitest";

// grant.ts reaches the database only through resolveGrant; these cases are pure.
vi.mock("@/server/db/context", () => ({ withConnectorUserTx: vi.fn() }));

import { consentChoice, decideGrant, LAST_USED_EVERY_MS, type GrantRow } from "./grant";

const NOW = new Date("2026-10-25T12:00:00Z");

function row(over: Partial<GrantRow> = {}): GrantRow {
  return {
    id: "g1",
    consentId: "app_consent_1",
    access: "READ",
    organizationId: null,
    clientName: null,
    lastUsedAt: new Date(NOW.getTime() - 60_000),
    revokedAt: null,
    ...over,
  };
}

describe("consentChoice", () => {
  it("defaults to READ and every space when the token carries no consent claims", () => {
    expect(consentChoice({ space: null, access: null }, false)).toEqual({
      access: "READ",
      organizationId: null,
    });
  });

  it("takes the member's choices: write, and one space they are in", () => {
    expect(consentChoice({ space: "all", access: "write" }, false)).toEqual({
      access: "WRITE",
      organizationId: null,
    });
    expect(consentChoice({ space: "org_club", access: "read" }, true)).toEqual({
      access: "READ",
      organizationId: "org_club",
    });
  });

  it('reads anything but "write" as READ', () => {
    expect(consentChoice({ space: null, access: "WRITE" }, false)?.access).toBe("READ");
    expect(consentChoice({ space: null, access: "admin" }, false)?.access).toBe("READ");
  });

  it("refuses a space the member is no longer in, rather than widening it to every space", () => {
    expect(consentChoice({ space: "org_left", access: "write" }, false)).toBeNull();
  });
});

describe("decideGrant", () => {
  const choice = { access: "WRITE" as const, organizationId: "org_club" };

  it("creates a grant on the first request from the consent's choices", () => {
    expect(decideGrant(null, "app_consent_1", choice, NOW)).toEqual({ kind: "create", choice });
  });

  it("renews a grant for a new consent, revoked or not", () => {
    expect(decideGrant(row(), "app_consent_2", choice, NOW)).toEqual({ kind: "renew", choice });
    expect(decideGrant(row({ revokedAt: NOW }), "app_consent_2", choice, NOW)).toEqual({
      kind: "renew",
      choice,
    });
  });

  it("refuses a revoked grant while the consent is the same, tokens issued before it included", () => {
    expect(decideGrant(row({ revokedAt: NOW }), "app_consent_1", null, NOW)).toEqual({
      kind: "refuse",
      reason: "revoked",
    });
  });

  it("refuses a new consent naming a space the member left", () => {
    expect(decideGrant(null, "app_consent_1", null, NOW)).toEqual({
      kind: "refuse",
      reason: "space",
    });
    expect(decideGrant(row(), "app_consent_2", null, NOW)).toEqual({
      kind: "refuse",
      reason: "space",
    });
  });

  it("keeps the stored choice for the same consent, whatever the token now says", () => {
    expect(decideGrant(row({ access: "READ" }), "app_consent_1", null, NOW)).toEqual({
      kind: "use",
      touch: false,
    });
  });

  it("writes lastUsedAt at most every 15 minutes", () => {
    const recent = new Date(NOW.getTime() - LAST_USED_EVERY_MS + 1000);
    const stale = new Date(NOW.getTime() - LAST_USED_EVERY_MS);
    expect(decideGrant(row({ lastUsedAt: recent }), "app_consent_1", null, NOW)).toEqual({
      kind: "use",
      touch: false,
    });
    expect(decideGrant(row({ lastUsedAt: stale }), "app_consent_1", null, NOW)).toEqual({
      kind: "use",
      touch: true,
    });
  });
});
