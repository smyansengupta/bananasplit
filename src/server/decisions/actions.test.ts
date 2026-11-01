import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Decisions on the member path: any member raises one (createdById pinned)
 * and takes one nobody owns; deciding, dropping and linking are for the
 * owner, the raiser, or an owner/admin (so one nobody owns is taken first).
 * Links must be to things the member can see.
 */

const { ctx, db, refresh, resolve } = vi.hoisted(() => ({
  ctx: { role: "MEMBER" as string, userId: "u_me" },
  db: {
    decision: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    itemLink: { findMany: vi.fn(), createMany: vi.fn() },
  },
  refresh: vi.fn(),
  resolve: vi.fn(),
}));

vi.mock("@/server/db/context", () => ({
  withOrgAction:
    (handler: (c: unknown, ...a: unknown[]) => unknown) =>
    (organizationId: string, ...args: unknown[]) =>
      handler({ db, organizationId, userId: ctx.userId, role: ctx.role, kind: "action" }, ...args),
}));
vi.mock("next/cache", () => ({ refresh }));
vi.mock("./linked-refs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./linked-refs")>()),
  resolveHomeRefs: resolve,
}));

const { createDecision, decide, dropDecision, linkDecision, takeDecision } =
  await import("./actions");

const ORG = "org_1";
const open = (over: Record<string, unknown> = {}) => ({
  id: "dc_1",
  status: "OPEN",
  ownerId: null,
  createdById: "u_raiser",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  ctx.role = "MEMBER";
  ctx.userId = "u_me";
  db.decision.create.mockResolvedValue({ id: "dc_1" });
  db.itemLink.findMany.mockResolvedValue([]);
  // Everything asked about resolves for the member unless a test says not.
  resolve.mockImplementation(
    async (_db: unknown, _org: string, _slug: string, refs: { kind: string; id: string }[]) =>
      new Map(refs.map((r) => [`${r.kind}:${r.id}`, {}])),
  );
});

describe("createDecision", () => {
  it("any member raises one as themselves, linked to what it came from", async () => {
    const result = await createDecision(ORG, {
      question: "Hackathon date",
      links: [
        { kind: "event", id: "ev_exec" },
        { kind: "poll", id: "poll_1" },
      ],
    });
    expect(result).toEqual({ ok: true, id: "dc_1" });
    expect(db.decision.create).toHaveBeenCalledWith({
      data: { organizationId: ORG, question: "Hackathon date", detail: null, createdById: "u_me" },
      select: { id: true },
    });
    expect(db.itemLink.createMany).toHaveBeenCalledWith({
      data: [
        {
          organizationId: ORG,
          fromKind: "decision",
          fromId: "dc_1",
          toKind: "event",
          toId: "ev_exec",
          createdById: "u_me",
        },
        {
          organizationId: ORG,
          fromKind: "decision",
          fromId: "dc_1",
          toKind: "poll",
          toId: "poll_1",
          createdById: "u_me",
        },
      ],
      skipDuplicates: true,
    });
    expect(refresh).toHaveBeenCalled();
  });

  it("refuses a link the member can't see, an unknown kind, and an empty question", async () => {
    resolve.mockResolvedValue(new Map());
    expect(
      await createDecision(ORG, { question: "x", links: [{ kind: "note", id: "n_private" }] }),
    ).toEqual({
      ok: false,
      error: "Couldn't find that to link.",
    });
    expect(
      await createDecision(ORG, { question: "x", links: [{ kind: "budget", id: "b1" }] }),
    ).toMatchObject({
      ok: false,
    });
    expect(await createDecision(ORG, { question: " " })).toEqual({
      ok: false,
      error: "Say what needs deciding.",
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("takeDecision", () => {
  it("makes you the owner of one nobody owns", async () => {
    db.decision.findFirst.mockResolvedValue(open());
    expect(await takeDecision(ORG, "dc_1")).toEqual({ ok: true, id: "dc_1" });
    expect(db.decision.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ownerId: "u_me" }) }),
    );
  });

  it("won't take one someone owns, or one already settled", async () => {
    db.decision.findFirst.mockResolvedValue(open({ ownerId: "u_other" }));
    expect(await takeDecision(ORG, "dc_1")).toEqual({
      ok: false,
      error: "Someone already owns it.",
    });
    db.decision.findFirst.mockResolvedValue(open({ status: "DECIDED" }));
    expect(await takeDecision(ORG, "dc_1")).toEqual({
      ok: false,
      error: "That's already been settled.",
    });
    expect(db.decision.update).not.toHaveBeenCalled();
  });
});

describe("decide and dropDecision", () => {
  it("the owner decides, with what was decided", async () => {
    db.decision.findFirst.mockResolvedValue(open({ ownerId: "u_me" }));
    expect(await decide(ORG, "dc_1", " Dec 5 ")).toEqual({ ok: true, id: "dc_1" });
    expect(db.decision.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "DECIDED",
          outcome: "Dec 5",
          decidedAt: expect.any(Date),
          ownerId: "u_me",
        }),
      }),
    );
  });

  it("whoever raised one nobody owns decides it, and becomes its owner", async () => {
    ctx.userId = "u_raiser";
    db.decision.findFirst.mockResolvedValue(open());
    await decide(ORG, "dc_1", "Wednesdays");
    expect(db.decision.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ownerId: "u_raiser" }) }),
    );
  });

  it("another member can only take one nobody owns, not decide or drop it", async () => {
    db.decision.findFirst.mockResolvedValue(open());
    const refused = {
      ok: false,
      error: "Only its owner, whoever raised it, or an admin can do that.",
    };
    expect(await decide(ORG, "dc_1", "Wednesdays")).toEqual(refused);
    expect(await dropDecision(ORG, "dc_1")).toEqual(refused);
    expect(db.decision.update).not.toHaveBeenCalled();
    ctx.role = "ADMIN";
    expect(await dropDecision(ORG, "dc_1")).toEqual({ ok: true, id: "dc_1" });
  });

  it("a member who neither owns nor raised it can't settle it; an admin can", async () => {
    db.decision.findFirst.mockResolvedValue(open({ ownerId: "u_other" }));
    const refused = {
      ok: false,
      error: "Only its owner, whoever raised it, or an admin can do that.",
    };
    expect(await decide(ORG, "dc_1", "x")).toEqual(refused);
    expect(await dropDecision(ORG, "dc_1")).toEqual(refused);
    expect(db.decision.update).not.toHaveBeenCalled();
    ctx.role = "ADMIN";
    expect(await dropDecision(ORG, "dc_1")).toEqual({ ok: true, id: "dc_1" });
    expect(db.decision.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "DROPPED" }) }),
    );
  });

  it("whoever raised it drops it; an empty outcome is refused", async () => {
    ctx.userId = "u_raiser";
    db.decision.findFirst.mockResolvedValue(open({ ownerId: "u_other" }));
    expect(await decide(ORG, "dc_1", "  ")).toEqual({ ok: false, error: "Say what was decided." });
    expect(await dropDecision(ORG, "dc_1")).toEqual({ ok: true, id: "dc_1" });
  });
});

describe("linkDecision", () => {
  it("links one more thing, once", async () => {
    db.decision.findFirst.mockResolvedValue(open({ ownerId: "u_me" }));
    db.itemLink.findMany.mockResolvedValue([
      { fromKind: "decision", fromId: "dc_1", toKind: "note", toId: "n_1" },
    ]);
    expect(await linkDecision(ORG, "dc_1", { kind: "note", id: "n_1" })).toEqual({
      ok: true,
      id: "dc_1",
    });
    expect(db.itemLink.createMany).not.toHaveBeenCalled();
    expect(await linkDecision(ORG, "dc_1", { kind: "event", id: "ev_1" })).toEqual({
      ok: true,
      id: "dc_1",
    });
    expect(db.itemLink.createMany).toHaveBeenCalledTimes(1);
  });

  it("is for the owner, the raiser or an admin, on an open decision", async () => {
    db.decision.findFirst.mockResolvedValue(open());
    expect(await linkDecision(ORG, "dc_1", { kind: "note", id: "n_1" })).toEqual({
      ok: false,
      error: "Only its owner, whoever raised it, or an admin can do that.",
    });
    db.decision.findFirst.mockResolvedValue(open({ ownerId: "u_me", status: "DROPPED" }));
    expect(await linkDecision(ORG, "dc_1", { kind: "note", id: "n_1" })).toEqual({
      ok: false,
      error: "That's already been settled.",
    });
    expect(db.itemLink.createMany).not.toHaveBeenCalled();
  });

  it("refuses a kind decisions don't link to", async () => {
    db.decision.findFirst.mockResolvedValue(open({ createdById: "u_me" }));
    expect(await linkDecision(ORG, "dc_1", { kind: "person", id: "u_1" })).toEqual({
      ok: false,
      error: "Couldn't find that to link.",
    });
  });
});
