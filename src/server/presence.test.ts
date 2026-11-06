import { describe, expect, it, vi } from "vitest";

// The members module reaches the auth stack; pageOf needs none of it.
vi.mock("@/server/members", () => ({ userPublicSelect: {} }));

const { markHere, pageOf, presenceOrg, RESTAMP_MS } = await import("./presence");

describe("pageOf", () => {
  it("names a page by its sidebar section, and links to the section, not the page", () => {
    expect(pageOf("/app/cbc/tasks/abc123", "cbc", null)).toEqual({
      href: "/app/cbc/tasks",
      label: "Tasks",
    });
    expect(pageOf("/app/cbc", "cbc", null)).toEqual({ href: "/app/cbc", label: "Home" });
    expect(pageOf("/app/cbc/inbox/", "cbc", null)).toEqual({
      href: "/app/cbc/inbox",
      label: "Inbox",
    });
  });

  it("never carries an id: a private note, a transaction or a person stays unnamed", () => {
    expect(pageOf("/app/cbc/notes/n_private", "cbc", null)?.href).toBe("/app/cbc/notes");
    expect(pageOf("/app/cbc/people/u_123", "cbc", null)?.href).toBe("/app/cbc/people");
    expect(pageOf("/app/cbc/org-chart/v1", "cbc", null)?.href).toBe("/app/cbc/people");
  });

  it("takes the longest match, so a sign-up page is Meetings and not Calendar", () => {
    expect(pageOf("/app/cbc/calendar/rsvp/x", "cbc", null)?.label).toBe("Meetings");
    expect(pageOf("/app/cbc/calendar", "cbc", null)?.label).toBe("Calendar");
    expect(pageOf("/app/cbc/calendar/polls/p1", "cbc", null)?.label).toBe("Forms");
  });

  it("uses the organization's own name for a section", () => {
    const sidebar = {
      groups: [],
      items: [{ id: "notes", group: "workspace", hidden: false, label: "Docs" }],
    };
    expect(pageOf("/app/cbc/notes/n1", "cbc", sidebar)?.label).toBe("Docs");
  });

  it("names settings, and nothing outside this organization", () => {
    expect(pageOf("/app/cbc/settings/members", "cbc", null)).toEqual({
      href: "/app/cbc/settings",
      label: "Settings",
    });
    expect(pageOf("/app/other/tasks", "cbc", null)).toBeNull();
    expect(pageOf("/app/cbcx/tasks", "cbc", null)).toBeNull();
    expect(pageOf("/elsewhere", "cbc", null)).toBeNull();
    expect(pageOf(42, "cbc", null)).toBeNull();
    expect(pageOf(`/app/cbc/${"x".repeat(400)}`, "cbc", null)).toBeNull();
  });

  it("refuses dot segments and empty segments, which could point elsewhere", () => {
    expect(pageOf("/app/cbc/tasks/../../other/tasks", "cbc", null)).toBeNull();
    expect(pageOf("/app/cbc/./tasks", "cbc", null)).toBeNull();
    expect(pageOf("/app/cbc/tasks/..", "cbc", null)).toBeNull();
    expect(pageOf("/app/cbc//evil.example/tasks", "cbc", null)).toBeNull();
    expect(pageOf("//app/cbc/tasks", "cbc", null)).toBeNull();
  });

  it("drops the query string", () => {
    expect(pageOf("/app/cbc/inbox?view=updates", "cbc", null)?.href).toBe("/app/cbc/inbox");
  });
});

function presenceDb(
  last: { lastSeenAt: Date; pageHref: string | null; pageLabel: string | null } | null,
) {
  return {
    memberPresence: {
      findUnique: vi.fn().mockResolvedValue(last),
      upsert: vi.fn().mockResolvedValue({}),
    },
    organization: {
      findUnique: vi.fn().mockResolvedValue({ slug: "cbc", settings: { sidebar: null } }),
    },
  };
}

describe("markHere", () => {
  const page = { href: "/app/cbc/tasks", label: "Tasks" };

  it("skips the write when the page is the same and the last stamp is fresh", async () => {
    const db = presenceDb({ lastSeenAt: new Date(), pageHref: page.href, pageLabel: page.label });
    await markHere(db as never, "org_1", "u_me", page);
    expect(db.memberPresence.upsert).not.toHaveBeenCalled();
  });

  it("writes when the page changed, or the stamp is old, or there's no row yet", async () => {
    const moved = presenceDb({ lastSeenAt: new Date(), pageHref: "/app/cbc", pageLabel: "Home" });
    await markHere(moved as never, "org_1", "u_me", page);
    expect(moved.memberPresence.upsert).toHaveBeenCalledTimes(1);
    const old = presenceDb({
      lastSeenAt: new Date(Date.now() - RESTAMP_MS - 1000),
      pageHref: page.href,
      pageLabel: page.label,
    });
    await markHere(old as never, "org_1", "u_me", page);
    expect(old.memberPresence.upsert).toHaveBeenCalledTimes(1);
    const fresh = presenceDb(null);
    await markHere(fresh as never, "org_1", "u_me", page);
    expect(fresh.memberPresence.upsert).toHaveBeenCalledTimes(1);
  });
});

describe("presenceOrg", () => {
  it("reads the organization once a minute, not on every beat", async () => {
    const db = presenceDb(null);
    const t = 1_700_000_000_000;
    expect(await presenceOrg(db as never, "org_cache", t)).toMatchObject({ slug: "cbc" });
    await presenceOrg(db as never, "org_cache", t + 30_000);
    expect(db.organization.findUnique).toHaveBeenCalledTimes(1);
    await presenceOrg(db as never, "org_cache", t + 61_000);
    expect(db.organization.findUnique).toHaveBeenCalledTimes(2);
  });
});
