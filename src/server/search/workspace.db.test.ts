// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Workspace search (the ⌘K palette) against the real roles and policies, in
 * an org made here: an owner and a member, a note, task, event, poll,
 * expense and org-chart role of each kind worth finding, and the things a
 * member must NOT find (the owner's private note and private task, someone
 * else's expense, an email address, a section the org hid). Everything made
 * here is removed in afterAll.
 */

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));

import { searchWorkspaceAction } from "@/app/app/[orgSlug]/search/actions";
import { Prisma } from "@/generated/prisma/client";
import type { SearchResponse, SearchScope } from "@/lib/search/types";
import { authDb, disconnectAll } from "@/server/db/clients";
import { withOrgTx } from "@/server/db/context";
import { recordVisit } from "@/server/pins";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { createOrganization } from "../settings/org-creation";

const tag = randomBytes(4).toString("hex");
let owner = { id: "", email: "", name: "" };
let member = { id: "", email: "", name: "" };
let org = { id: "", slug: "" };
let reachable = true;
const ids = {
  sharedNote: "",
  privateNote: "",
  longNote: "",
  task: "",
  privateTask: "",
  doneTask: "",
  event: "",
  poll: "",
  ownersExpense: "",
  membersExpense: "",
  position: "",
};

async function makeUser(local: string, name: string) {
  const row = await authDb.user.create({
    data: {
      email: `${local}-${tag}@example.edu`,
      name,
      emailVerified: new Date(),
      onboardedAt: new Date(),
    },
    select: { id: true, email: true, name: true },
  });
  return { id: row.id, email: row.email, name: row.name ?? local };
}

async function search(
  user: typeof owner,
  query: string,
  scope: SearchScope = "all",
): Promise<SearchResponse> {
  requireUserMock.mockResolvedValue(user);
  return searchWorkspaceAction(org.id, { query, scope });
}

function keys(res: SearchResponse): string[] {
  return res.groups.flatMap((g) => g.hits.map((h) => h.key));
}

function hitFor(res: SearchResponse, key: string) {
  return res.groups.flatMap((g) => g.hits).find((h) => h.key === key);
}

beforeAll(async () => {
  vi.stubEnv("PLATFORM_ORG_CREATION_ENABLED", "true");
  vi.stubEnv("ORG_CREATION_MODE", "open");
  try {
    owner = await makeUser("search-owner", `Olive Owner ${tag}`);
    member = await makeUser("search-member", `Max Member ${tag}`);
    const made = await createOrganization(owner, {
      name: `Search ${tag}`,
      slug: `search-${tag}`,
      timezone: "UTC",
    });
    if (!made.ok) throw new Error(JSON.stringify(made));
    org = { id: made.orgId, slug: made.slug };
    await ownerDb.membership.create({
      data: { organizationId: org.id, userId: member.id, role: "MEMBER", title: "VP Outreach" },
    });
    await ownerDb.user.update({ where: { id: member.id }, data: { major: "Economics" } });

    const note = async (
      title: string,
      contentText: string,
      visibility: "PRIVATE" | "ORGANIZATION",
    ) =>
      (
        await ownerDb.note.create({
          data: {
            organizationId: org.id,
            title,
            contentJson: {},
            contentText,
            visibility,
            authorId: owner.id,
            updatedById: owner.id,
          },
          select: { id: true },
        })
      ).id;
    ids.sharedNote = await note(
      `Minutes ${tag}`,
      "We reviewed the quarterly budget, then picked a venue for the spring gala.",
      "ORGANIZATION",
    );
    ids.privateNote = await note(`Diary ${tag}`, "My quarterly worries about the gala.", "PRIVATE");
    ids.longNote = await note(
      `Retreat ${tag}`,
      `${"Plans and filler words. ".repeat(40)}The treasurer booked the lodge in Maine. ${"More filler afterwards. ".repeat(40)}`,
      "ORGANIZATION",
    );

    const task = async (data: {
      title: string;
      description?: string;
      visibility?: "ORG" | "PRIVATE";
      status?: "COMPLETED";
    }) =>
      (
        await ownerDb.task.create({
          data: {
            organizationId: org.id,
            rank: "a0",
            createdById: owner.id,
            ownerId: data.visibility === "PRIVATE" ? owner.id : member.id,
            ...data,
            ...(data.status === "COMPLETED" ? { completedAt: new Date() } : {}),
          },
          select: { id: true },
        })
      ).id;
    ids.task = await task({
      title: `Book the gala venue ${tag}`,
      description: "Call the hotel about catering.",
    });
    ids.privateTask = await task({
      title: `Confidential gala budget ${tag}`,
      visibility: "PRIVATE",
    });
    ids.doneTask = await task({ title: `Old gala checklist ${tag}`, status: "COMPLETED" });

    const startsAt = new Date(Date.now() + 7 * 86_400_000);
    ids.event = (
      await ownerDb.event.create({
        data: {
          organizationId: org.id,
          title: `Spring gala ${tag}`,
          location: "Curry Student Center",
          startsAt,
          endsAt: new Date(startsAt.getTime() + 3 * 3_600_000),
          createdById: owner.id,
        },
        select: { id: true },
      })
    ).id;

    ids.poll = (
      await ownerDb.poll.create({
        data: {
          organizationId: org.id,
          question: `Which night for the gala ${tag}?`,
          createdById: owner.id,
          options: {
            create: [
              { label: "Friday", sortOrder: 0 },
              { label: "Saturday", sortOrder: 1 },
            ],
          },
        },
        select: { id: true },
      })
    ).id;

    const period = await ownerDb.budgetPeriod.create({
      data: {
        organizationId: org.id,
        label: `FY ${tag}`,
        startsOn: new Date("2026-07-01"),
        endsOn: new Date("2027-06-30"),
      },
      select: { id: true },
    });
    const expense = async (submittedById: string, description: string, amountCents: number) =>
      (
        await ownerDb.transaction.create({
          data: {
            organizationId: org.id,
            budgetPeriodId: period.id,
            direction: "OUT",
            kind: "EXPENSE",
            status: "SUBMITTED",
            amountCents,
            description,
            occurredAt: new Date("2026-09-15T00:00:00Z"),
            submittedById,
          },
          select: { id: true },
        })
      ).id;
    ids.ownersExpense = await expense(owner.id, `Gala deposit ${tag}`, 45_017);
    ids.membersExpense = await expense(member.id, `Gala flyers ${tag}`, 2_500);
    await ownerDb.sponsor.create({
      data: { organizationId: org.id, name: `Acme gala sponsor ${tag}` },
    });

    const version = await ownerDb.orgChartVersion.create({
      data: {
        organizationId: org.id,
        number: 1,
        status: "PUBLISHED",
        source: "MANUAL",
        createdById: owner.id,
        publishedAt: new Date(),
      },
      select: { id: true },
    });
    ids.position = (
      await ownerDb.orgChartPosition.create({
        data: {
          organizationId: org.id,
          versionId: version.id,
          key: "vp-partnerships",
          title: `VP Partnerships ${tag}`,
          userId: member.id,
          responsibilities: ["Sponsor outreach", "Gala logistics"],
          rank: "a0",
        },
        select: { id: true },
      })
    ).id;
    await ownerDb.organization.update({
      where: { id: org.id },
      data: { activeOrgChartVersionId: version.id },
    });
  } catch (error) {
    console.warn("[workspace.db.test] skipped:", error instanceof Error ? error.message : error);
    reachable = false;
  }
});

afterAll(async () => {
  vi.unstubAllEnvs();
  // Whatever setup got to is removed, even when it stopped part-way.
  if (org.id) {
    await ownerDb.organization.update({
      where: { id: org.id },
      data: { activeOrgChartVersionId: null },
    });
    await ownerDb.transaction.deleteMany({ where: { organizationId: org.id } });
    await ownerDb.organization.delete({ where: { id: org.id } });
    await ownerDb.orgSlugHistory.deleteMany({ where: { slug: org.slug } });
  }
  const userIds = [owner.id, member.id].filter(Boolean);
  if (userIds.length) await ownerDb.user.deleteMany({ where: { id: { in: userIds } } });
  await disconnectAll();
  await disconnectOwnerDb();
});

describe("workspace search", () => {
  it("finds a note by a word still being typed, in any order, and never another author's private note", async () => {
    if (!reachable) return;
    const res = await search(member, `quarte ${tag}`);
    expect(keys(res)).toContain(`note:${ids.sharedNote}`);
    expect(keys(res)).not.toContain(`note:${ids.privateNote}`);
    // The second line is the passage that matched.
    expect(hitFor(res, `note:${ids.sharedNote}`)?.detail).toMatch(/quarterly budget/);

    // A passage from the middle of a long note is marked as cut on both sides.
    const lodge = hitFor(await search(member, `lodge ${tag}`), `note:${ids.longNote}`);
    expect(lodge?.detail).toMatch(/^….*booked the lodge.*…$/);

    // The author finds their own private note.
    expect(keys(await search(owner, `quarte ${tag}`))).toContain(`note:${ids.privateNote}`);
  });

  it("matches every word across fields, ranks open work first, and hides private tasks", async () => {
    if (!reachable) return;
    const res = await search(member, `venue gala ${tag}`, "tasks");
    expect(keys(res)[0]).toBe(`task:${ids.task}`);

    // "catering" lives in the description only.
    expect(keys(await search(member, `catering ${tag}`))).toContain(`task:${ids.task}`);

    const gala = await search(member, `gala ${tag}`, "tasks");
    const tasks = gala.groups.find((g) => g.id === "tasks")!.hits.map((h) => h.key);
    expect(tasks).not.toContain(`task:${ids.privateTask}`);
    expect(tasks.indexOf(`task:${ids.task}`)).toBeLessThan(tasks.indexOf(`task:${ids.doneTask}`));
    expect(gala.groups.find((g) => g.id === "tasks")!.more?.href).toContain(
      "/tasks?view=table&scope=all&q=",
    );

    // OWNER/ADMIN see private tasks (RLS), so search does too.
    expect(keys(await search(owner, `gala ${tag}`, "tasks"))).toContain(`task:${ids.privateTask}`);
  });

  it("covers events, polls, people and org-chart roles", async () => {
    if (!reachable) return;
    const res = await search(member, `gala ${tag}`);
    expect(keys(res)).toEqual(
      expect.arrayContaining([`event:${ids.event}`, `poll:${ids.poll}`, `note:${ids.sharedNote}`]),
    );
    // An event's location, a poll's options.
    expect(keys(await search(member, `curry ${tag}`))).toContain(`event:${ids.event}`);
    expect(keys(await search(member, `saturday ${tag}`))).toContain(`poll:${ids.poll}`);
    // A member by this org's title and by major.
    expect(keys(await search(owner, `outreach ${tag}`))).toContain(`person:${member.id}`);
    expect(keys(await search(owner, `econ max`))).toContain(`person:${member.id}`);
    // A role by what it is responsible for.
    const role = await search(member, `${tag} sponsor outreach`);
    expect(hitFor(role, `position:${ids.position}`)?.href).toBe(
      `/app/${org.slug}/org-chart?position=vp-partnerships`,
    );
  });

  it("searches emails only for admins", async () => {
    if (!reachable) return;
    // Every word is only in the member's address.
    expect(keys(await search(owner, `search member ${tag} example`))).toContain(
      `person:${member.id}`,
    );
    expect(keys(await search(member, `search owner ${tag} example`))).not.toContain(
      `person:${owner.id}`,
    );
  });

  it("shows a member only their own expenses; owners and treasurers the ledger", async () => {
    if (!reachable) return;
    const mine = await search(member, `gala ${tag}`, "finance");
    expect(keys(mine)).toContain(`transaction:${ids.membersExpense}`);
    expect(keys(mine)).not.toContain(`transaction:${ids.ownersExpense}`);
    expect(keys(mine).some((k) => k.startsWith("sponsor:"))).toBe(false);
    expect(hitFor(mine, `transaction:${ids.membersExpense}`)?.href).toBe(
      `/app/${org.slug}/finance/my-reimbursements`,
    );

    const ledger = await search(owner, `gala ${tag}`, "finance");
    expect(keys(ledger)).toEqual(
      expect.arrayContaining([
        `transaction:${ids.membersExpense}`,
        `transaction:${ids.ownersExpense}`,
      ]),
    );
    expect(keys(ledger).some((k) => k.startsWith("sponsor:"))).toBe(true);
    // That one day: the filter's end date is inclusive.
    expect(hitFor(ledger, `transaction:${ids.ownersExpense}`)?.href).toBe(
      `/app/${org.slug}/finance/transactions?dateFrom=2026-09-15&dateTo=2026-09-15`,
    );

    // The amount itself finds it.
    const byAmount = await search(owner, "$450.17", "finance");
    expect(keys(byAmount)[0]).toBe(`transaction:${ids.ownersExpense}`);
  });

  it("leaves a section the org hid out of members' search, not admins'", async () => {
    if (!reachable) return;
    // Visited before the section was hidden: in Recent until then.
    requireUserMock.mockResolvedValue(member);
    await withOrgTx(org.id, ({ db }) =>
      recordVisit(db, org.id, org.slug, member.id, `/app/${org.slug}/calendar/polls/${ids.poll}`),
    );
    expect(keys(await search(member, ""))).toContain(
      `recent:/app/${org.slug}/calendar/polls/${ids.poll}`,
    );
    await ownerDb.orgSettings.upsert({
      where: { organizationId: org.id },
      create: {
        organizationId: org.id,
        sidebar: { groups: [], items: [{ id: "polls", group: "club", hidden: true, label: null }] },
      },
      update: {
        sidebar: { groups: [], items: [{ id: "polls", group: "club", hidden: true, label: null }] },
      },
    });
    try {
      expect(keys(await search(member, `gala ${tag}`))).not.toContain(`poll:${ids.poll}`);
      expect(keys(await search(member, "")).some((k) => k.includes("/calendar/polls/"))).toBe(
        false,
      );
      expect(keys(await search(owner, `gala ${tag}`))).toContain(`poll:${ids.poll}`);
    } finally {
      await ownerDb.orgSettings.update({
        where: { organizationId: org.id },
        data: { sidebar: Prisma.DbNull },
      });
    }
  });

  it("lists the latest of a kind under a filter with no words", async () => {
    if (!reachable) return;
    const open = await search(member, "", "tasks");
    const tasks = open.groups.find((g) => g.id === "tasks")!.hits.map((h) => h.key);
    expect(tasks).toContain(`task:${ids.task}`);
    expect(tasks).not.toContain(`task:${ids.doneTask}`);
    // "All" with no words is the palette's home: nothing visited yet, nothing to show.
    expect((await search(member, "   ")).groups.every((g) => g.id === "recent")).toBe(true);
  });

  it("refuses someone outside the org", async () => {
    if (!reachable) return;
    const outsider = await makeUser("search-outsider", `Outsider ${tag}`);
    try {
      await expect(search(outsider, `gala ${tag}`)).rejects.toThrow();
    } finally {
      await ownerDb.user.delete({ where: { id: outsider.id } });
    }
  });
});
