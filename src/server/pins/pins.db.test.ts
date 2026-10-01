// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Pinning against the real roles and policies: a member pins a note, a
 * folder, a task view and a person; "Pin something" finds what they may
 * open and nothing they may not (another member's private note). Everything
 * made here is removed in afterAll.
 */

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));

import { authDb, disconnectAll } from "@/server/db/clients";
import { withOrgTx } from "@/server/db/context";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { createOrganization } from "../settings/org-creation";

import { listPins, pinPage, togglePin } from "./index";
import { searchPinnables } from "./search";

const tag = randomBytes(4).toString("hex");
let owner = { id: "", email: "", name: "" };
let member = { id: "", email: "", name: "" };
let org = { id: "", slug: "" };
let reachable = true;
let secretNote = "";
let sharedNote = "";
let folder = "";

async function makeUser(local: string) {
  const row = await authDb.user.create({
    data: { email: `${local}-${tag}@example.edu`, name: `${local} ${tag}`, emailVerified: new Date(), onboardedAt: new Date() },
    select: { id: true, email: true, name: true },
  });
  return { id: row.id, email: row.email, name: row.name ?? local };
}

function as<T>(user: typeof owner, fn: Parameters<typeof withOrgTx<T>>[1]): Promise<T> {
  requireUserMock.mockResolvedValue(user);
  return withOrgTx(org.id, fn);
}

beforeAll(async () => {
  vi.stubEnv("PLATFORM_ORG_CREATION_ENABLED", "true");
  vi.stubEnv("ORG_CREATION_MODE", "open");
  try {
    owner = await makeUser("pin-owner");
    member = await makeUser("pin-member");
    const made = await createOrganization(owner, { name: `Pins ${tag}`, slug: `pins-${tag}`, timezone: "UTC" });
    if (!made.ok) throw new Error(JSON.stringify(made));
    org = { id: made.orgId, slug: made.slug };
    await ownerDb.membership.create({ data: { organizationId: org.id, userId: member.id, role: "MEMBER" } });
    const note = (authorId: string, title: string, visibility: "PRIVATE" | "ORGANIZATION") =>
      ownerDb.note.create({
        data: {
          organizationId: org.id,
          title,
          contentJson: {},
          contentText: "",
          visibility,
          authorId,
          updatedById: authorId,
        },
        select: { id: true },
      });
    secretNote = (await note(owner.id, `Owner's secret ${tag}`, "PRIVATE")).id;
    sharedNote = (await note(owner.id, `Minutes ${tag}`, "ORGANIZATION")).id;
    folder = (
      await ownerDb.noteFolder.create({
        data: { organizationId: org.id, name: `Board ${tag}`, createdById: owner.id },
        select: { id: true },
      })
    ).id;
  } catch (error) {
    console.warn("[pins.db.test] skipped:", error instanceof Error ? error.message : error);
    reachable = false;
  }
});

afterAll(async () => {
  vi.unstubAllEnvs();
  if (reachable && org.id) {
    await ownerDb.organization.delete({ where: { id: org.id } });
    await ownerDb.orgSlugHistory.deleteMany({ where: { slug: org.slug } });
  }
  const ids = [owner.id, member.id].filter(Boolean);
  if (ids.length) await ownerDb.user.deleteMany({ where: { id: { in: ids } } });
  await disconnectAll();
  await disconnectOwnerDb();
});

describe("pinning anything", () => {
  it("pins a note, a folder, a Tasks view and a person, with live names", async () => {
    if (!reachable) return;
    const base = `/app/${org.slug}`;
    await as(member, async ({ db }) => {
      for (const address of [
        `${base}/notes/${sharedNote}`,
        `${base}/notes?folder=${folder}`,
        `${base}/tasks?scope=mine&view=board`,
        `${base}/people/${owner.id}`,
      ]) {
        expect(await pinPage(db, org.id, org.slug, member.id, address)).toEqual({ ok: true, pinned: true });
      }
      // A note the member can't open can't be pinned.
      expect(await pinPage(db, org.id, org.slug, member.id, `${base}/notes/${secretNote}`)).toMatchObject({ ok: false });
    });
    const pins = await as(member, ({ db }) => listPins(db, org.id, org.slug, member.id));
    expect(pins.map((p) => [p.kind, p.label])).toEqual([
      ["note", `Minutes ${tag}`],
      ["folder", `Board ${tag}`],
      ["page", "Tasks · Board · Mine"],
      ["person", `pin-owner ${tag}`],
    ]);
    expect(pins[2].href).toBe(`${base}/tasks?view=board&scope=mine`);

    // Renaming the folder renames the pin; unpinning removes it.
    await ownerDb.noteFolder.update({ where: { id: folder }, data: { name: `Exec ${tag}` } });
    const renamed = await as(member, ({ db }) => listPins(db, org.id, org.slug, member.id));
    expect(renamed[1].label).toBe(`Exec ${tag}`);
    await as(member, ({ db }) => togglePin(db, org.id, org.slug, member.id, `${base}/notes?folder=${folder}`));
    expect((await as(member, ({ db }) => listPins(db, org.id, org.slug, member.id))).length).toBe(3);
  });

  it("finds everything the member may pin, and nothing they may not", async () => {
    if (!reachable) return;
    const groups = await as(member, ({ db }) => searchPinnables(db, org.id, org.slug, member.id, tag));
    const labels = groups.flatMap((g) => g.items.map((i) => i.label));
    expect(labels).toContain(`Minutes ${tag}`);
    expect(labels).toContain(`Exec ${tag}`);
    expect(labels).not.toContain(`Owner's secret ${tag}`);
    // With no query: pages and views, every folder, recent notes.
    const all = await as(member, ({ db }) => searchPinnables(db, org.id, org.slug, member.id, ""));
    expect(all.map((g) => g.id)).toEqual(expect.arrayContaining(["pages", "folders", "notes"]));
    expect(all.find((g) => g.id === "pages")!.items.map((i) => i.label)).toContain("Tasks · Board");
  });
});
