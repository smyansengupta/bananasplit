import { describe, expect, it } from "vitest";

import {
  domainToVerify,
  needsReconnect,
  suggestFormsAddOn,
  suggestGoogleCalendar,
  syncToRetry,
} from "./integrations";

const now = new Date("2026-11-02T12:00:00Z");

describe("Reconnect", () => {
  it("shows for an expired sign-in or a broken app, with when it was checked", () => {
    expect(
      needsReconnect({ status: "NEEDS_REAUTH", lastVerifiedAt: "2026-11-01T09:00:00Z" }, now),
    ).toEqual({ reason: "Its sign-in stopped working, last checked yesterday" });
    expect(needsReconnect({ status: "NEEDS_REAUTH" }, now)?.reason).toBe("Its sign-in expired");
    expect(
      needsReconnect({ status: "ERROR", lastVerifiedAt: "2026-10-28T12:00:00Z" }, now)?.reason,
    ).toBe("It stopped working, last checked 5 days ago");
  });
  it("is quiet when it works", () => {
    expect(needsReconnect({ status: "CONNECTED" }, now)).toBeNull();
  });
});

describe("Retry now", () => {
  it("shows for failed items or a failed sync on a working connection", () => {
    expect(syncToRetry({ status: "CONNECTED", failed: 3, lastError: null })?.reason).toBe(
      "3 items didn't sync",
    );
    expect(syncToRetry({ status: "ERROR", failed: 0, lastError: null })).not.toBeNull();
    expect(syncToRetry({ status: "CONNECTED", failed: 0, lastError: "timeout" })).not.toBeNull();
  });
  it("leaves a lost sign-in to Reconnect, and is quiet when all synced", () => {
    expect(syncToRetry({ status: "NEEDS_REAUTH", failed: 2, lastError: "x" })).toBeNull();
    expect(syncToRetry({ status: "CONNECTED", failed: 0, lastError: null })).toBeNull();
  });
});

describe("Connect Google Calendar", () => {
  it("shows for admins of an organization making events without Google", () => {
    expect(
      suggestGoogleCalendar({ googleStatus: null, canManage: true, recentEvents: 6 })?.reason,
    ).toBe("6 events made in the last 30 days");
    expect(
      suggestGoogleCalendar({ googleStatus: "DISCONNECTED", canManage: true, recentEvents: 2 }),
    ).not.toBeNull();
  });
  it("is quiet when connected, for members, or with few events", () => {
    expect(
      suggestGoogleCalendar({ googleStatus: "CONNECTED", canManage: true, recentEvents: 9 }),
    ).toBeNull();
    expect(
      suggestGoogleCalendar({ googleStatus: "NEEDS_REAUTH", canManage: true, recentEvents: 9 }),
    ).toBeNull();
    expect(
      suggestGoogleCalendar({ googleStatus: null, canManage: false, recentEvents: 9 }),
    ).toBeNull();
    expect(
      suggestGoogleCalendar({ googleStatus: null, canManage: true, recentEvents: 1 }),
    ).toBeNull();
  });
});

describe("Verify domain", () => {
  it("shows for your own sender on an unverified domain", () => {
    expect(domainToVerify({ hasSecret: true, domainStatus: "not_started" })?.reason).toBe(
      "Your sending domain is not started",
    );
    expect(domainToVerify({ hasSecret: true, domainStatus: "verified" })).toBeNull();
    expect(domainToVerify({ hasSecret: false, domainStatus: "pending" })).toBeNull();
    expect(domainToVerify({ hasSecret: true, domainStatus: null })).toBeNull();
  });
});

describe("Add Forms", () => {
  const base = { added: false, locked: false, canManage: true, forms: 3 };
  it("shows when forms are in use and the add-on is off", () => {
    expect(suggestFormsAddOn(base)?.reason).toBe("Your organization has 3 forms");
    expect(suggestFormsAddOn({ ...base, forms: 1 })?.reason).toBe("Your organization has a form");
  });
  it("is quiet once added, off the plan, for members, or with no forms", () => {
    expect(suggestFormsAddOn({ ...base, added: true })).toBeNull();
    expect(suggestFormsAddOn({ ...base, locked: true })).toBeNull();
    expect(suggestFormsAddOn({ ...base, canManage: false })).toBeNull();
    expect(suggestFormsAddOn({ ...base, forms: 0 })).toBeNull();
  });
});
