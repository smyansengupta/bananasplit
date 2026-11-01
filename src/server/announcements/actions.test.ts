import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Announcements on the member path: any member posts as themselves, the
 * author or an owner/admin edits and removes, whoever removed it or an
 * owner/admin puts it back, a linked event must be one the member can see,
 * and seeing is recorded for the member alone. The week's recap is written
 * on the server, as any member would see it.
 */

const { ctx, db, refresh, loadRecapWeek } = vi.hoisted(() => ({
  ctx: { role: "MEMBER" as string, userId: "u_me" },
  db: {
    announcement: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    announcementSeen: { createMany: vi.fn() },
    event: { findFirst: vi.fn() },
    itemLink: { create: vi.fn(), deleteMany: vi.fn() },
    organization: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
  },
  refresh: vi.fn(),
  loadRecapWeek: vi.fn(),
}));

vi.mock("@/server/db/context", () => ({
  withOrgAction:
    (handler: (c: unknown, ...a: unknown[]) => unknown) =>
    (organizationId: string, ...args: unknown[]) =>
      handler({ db, organizationId, userId: ctx.userId, role: ctx.role, kind: "action" }, ...args),
}));
vi.mock("next/cache", () => ({ refresh }));
vi.mock("@/server/members", () => ({ userPublicSelect: {} }));
vi.mock("@/server/overview/recap-week", () => ({ loadRecapWeek }));

const {
  deleteAnnouncement,
  editAnnouncement,
  markAnnouncementsSeen,
  postAnnouncement,
  postRecapAnnouncement,
  restoreAnnouncement,
} = await import("./actions");

const ORG = "org_1";

beforeEach(() => {
  vi.clearAllMocks();
  ctx.role = "MEMBER";
  ctx.userId = "u_me";
  db.announcement.create.mockResolvedValue({ id: "an_1" });
  db.announcement.findMany.mockImplementation(
    async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map((id) => ({ id })),
  );
  db.announcementSeen.createMany.mockResolvedValue({ count: 1 });
  db.event.findFirst.mockResolvedValue({ id: "ev_1" });
});

describe("postAnnouncement", () => {
  it("any member posts as themselves, about an event they can see, and has seen it", async () => {
    const result = await postAnnouncement(ORG, {
      title: " Fall Social ",
      body: "Bring a friend",
      eventId: "ev_1",
    });
    expect(result).toEqual({ ok: true, id: "an_1" });
    expect(db.announcement.create).toHaveBeenCalledWith({
      data: { organizationId: ORG, authorId: "u_me", title: "Fall Social", body: "Bring a friend" },
      select: { id: true },
    });
    expect(db.itemLink.create).toHaveBeenCalledWith({
      data: {
        organizationId: ORG,
        fromKind: "announcement",
        fromId: "an_1",
        toKind: "event",
        toId: "ev_1",
        createdById: "u_me",
      },
      select: { id: true },
    });
    expect(db.announcementSeen.createMany).toHaveBeenCalledWith({
      data: [{ organizationId: ORG, announcementId: "an_1", userId: "u_me" }],
      skipDuplicates: true,
    });
    expect(refresh).toHaveBeenCalled();
  });

  it("refuses an event the member can't see, and a post with no title", async () => {
    db.event.findFirst.mockResolvedValue(null);
    expect(await postAnnouncement(ORG, { title: "Hi", body: "", eventId: "ev_gone" })).toEqual({
      ok: false,
      error: "That event is gone.",
    });
    expect(await postAnnouncement(ORG, { title: "  ", body: "x" })).toEqual({
      ok: false,
      error: "Give it a title.",
    });
    expect(db.announcement.create).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("editing and removing", () => {
  it("the author edits their post, keeping its event when eventId is left out", async () => {
    db.announcement.findFirst.mockResolvedValue({ id: "an_1", authorId: "u_me" });
    const result = await editAnnouncement(ORG, "an_1", { title: "Moved to Saturday", body: "" });
    expect(result).toEqual({ ok: true, id: "an_1" });
    expect(db.announcement.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ title: "Moved to Saturday" }) }),
    );
    expect(db.itemLink.deleteMany).not.toHaveBeenCalled();
  });

  it("another member can't edit or remove it", async () => {
    db.announcement.findFirst.mockResolvedValue({ id: "an_1", authorId: "u_author" });
    const refused = { ok: false, error: "Only whoever posted it, or an admin, can change it." };
    expect(await editAnnouncement(ORG, "an_1", { title: "x", body: "" })).toEqual(refused);
    expect(await deleteAnnouncement(ORG, "an_1")).toEqual(refused);
    ctx.role = "TREASURER";
    expect(await deleteAnnouncement(ORG, "an_1")).toEqual(refused);
    expect(db.announcement.update).not.toHaveBeenCalled();
  });

  it("an admin removes anyone's post as themselves, and puts it back", async () => {
    ctx.role = "ADMIN";
    db.announcement.findFirst.mockResolvedValue({
      id: "an_1",
      authorId: "u_author",
      deletedAt: null,
      deletedById: null,
    });
    expect(await deleteAnnouncement(ORG, "an_1")).toEqual({ ok: true, id: "an_1" });
    expect(db.announcement.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ deletedAt: expect.any(Date), deletedById: "u_me" }),
      }),
    );
    db.announcement.findFirst.mockResolvedValue({
      id: "an_1",
      authorId: "u_author",
      deletedAt: new Date(),
      deletedById: "u_me",
    });
    expect(await restoreAnnouncement(ORG, "an_1")).toEqual({ ok: true, id: "an_1" });
    expect(db.announcement.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ deletedAt: null, deletedById: null }),
      }),
    );
  });

  it("the author can't put back a post an admin took down, but can undo their own", async () => {
    db.announcement.findFirst.mockResolvedValue({
      id: "an_1",
      authorId: "u_me",
      deletedAt: new Date(),
      deletedById: "u_admin",
    });
    expect(await restoreAnnouncement(ORG, "an_1")).toEqual({
      ok: false,
      error: "Only whoever took it down, or an admin, can put it back.",
    });
    // Removing it again doesn't take the removal over.
    expect(await deleteAnnouncement(ORG, "an_1")).toEqual({ ok: true, id: "an_1" });
    expect(db.announcement.update).not.toHaveBeenCalled();
    db.announcement.findFirst.mockResolvedValue({
      id: "an_1",
      authorId: "u_me",
      deletedAt: new Date(),
      deletedById: "u_me",
    });
    expect(await restoreAnnouncement(ORG, "an_1")).toEqual({ ok: true, id: "an_1" });
  });

  it("an edit with eventId null unlinks the event", async () => {
    db.announcement.findFirst.mockResolvedValue({ id: "an_1", authorId: "u_me" });
    await editAnnouncement(ORG, "an_1", { title: "x", body: "", eventId: null });
    expect(db.itemLink.deleteMany).toHaveBeenCalledTimes(1);
    expect(db.itemLink.create).not.toHaveBeenCalled();
  });

  it("says so when the post is gone", async () => {
    db.announcement.findFirst.mockResolvedValue(null);
    expect(await editAnnouncement(ORG, "an_x", { title: "x", body: "" })).toEqual({
      ok: false,
      error: "That announcement is gone.",
    });
  });
});

describe("postRecapAnnouncement", () => {
  beforeEach(() => {
    db.organization.findUnique.mockResolvedValue({ slug: "cbc", timezone: "America/New_York" });
    db.user.findUnique.mockResolvedValue({ timezone: null });
    loadRecapWeek.mockResolvedValue({
      title: "The week, recapped: Oct 25 to Oct 31",
      text: "The team finished 12 tasks.",
    });
  });

  it("writes the recap on the server, as a plain member sees it, and posts it", async () => {
    ctx.role = "OWNER";
    expect(await postRecapAnnouncement(ORG)).toEqual({ ok: true, id: "an_1" });
    expect(loadRecapWeek).toHaveBeenCalledWith(db, {
      orgId: ORG,
      orgSlug: "cbc",
      userId: "u_me",
      role: "MEMBER",
      timeZone: "America/New_York",
      now: expect.any(Date),
      audience: "organization",
    });
    expect(db.announcement.create).toHaveBeenCalledWith({
      data: {
        organizationId: ORG,
        authorId: "u_me",
        title: "The week, recapped: Oct 25 to Oct 31",
        body: "The team finished 12 tasks.",
      },
      select: { id: true },
    });
  });

  it("posts nothing for a quiet week", async () => {
    loadRecapWeek.mockResolvedValue({ title: "The week, recapped: Oct 25 to Oct 31", text: "" });
    expect(await postRecapAnnouncement(ORG)).toEqual({
      ok: false,
      error: "Nothing to recap this week.",
    });
    expect(db.announcement.create).not.toHaveBeenCalled();
  });
});

describe("markAnnouncementsSeen", () => {
  it("records the member's own sightings, once each, without refreshing", async () => {
    expect(await markAnnouncementsSeen(ORG, ["an_1", "an_1", "an_2"])).toEqual({ ok: true });
    expect(db.announcementSeen.createMany).toHaveBeenCalledWith({
      data: [
        { organizationId: ORG, announcementId: "an_1", userId: "u_me" },
        { organizationId: ORG, announcementId: "an_2", userId: "u_me" },
      ],
      skipDuplicates: true,
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refuses anything but a short list of ids", async () => {
    expect(await markAnnouncementsSeen(ORG, "an_1" as unknown as string[])).toMatchObject({
      ok: false,
    });
    expect(db.announcementSeen.createMany).not.toHaveBeenCalled();
  });
});
