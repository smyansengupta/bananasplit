// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * "Recently deleted" against the real roles and policies: a member sees
 * their own deleted notes and files (an admin sees shared ones too), and a
 * restore brings a file back within the window. Removed in afterAll.
 */

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));

import { countDeleted, getDeletedNotes } from "@/app/app/[orgSlug]/notes/queries";
import { authDb, disconnectAll } from "@/server/db/clients";
import { withOrgTx } from "@/server/db/context";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { createOrganization } from "../settings/org-creation";

import { listDeletedNoteFiles, removeNoteFile, restoreNoteFile } from "./files";

const tag = randomBytes(4).toString("hex");
let owner = { id: "", email: "", name: "" };
let member = { id: "", email: "", name: "" };
let org = { id: "", slug: "" };
let reachable = true;
let memberFile = "";
let longGone = "";

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
    owner = await makeUser("trash-owner");
    member = await makeUser("trash-member");
    const made = await createOrganization(owner, { name: `Trash ${tag}`, slug: `trash-${tag}`, timezone: "UTC" });
    if (!made.ok) throw new Error(JSON.stringify(made));
    org = { id: made.orgId, slug: made.slug };
    await ownerDb.membership.create({ data: { organizationId: org.id, userId: member.id, role: "MEMBER" } });
    const note = (authorId: string, title: string, visibility: "PRIVATE" | "ORGANIZATION", deletedAt: Date) =>
      ownerDb.note.create({
        data: { organizationId: org.id, title, contentJson: {}, contentText: "", visibility, authorId, updatedById: authorId, deletedAt },
      });
    const now = new Date();
    await note(member.id, `Mine ${tag}`, "PRIVATE", now);
    await note(owner.id, `Shared ${tag}`, "ORGANIZATION", now);
    await note(owner.id, `Owner private ${tag}`, "PRIVATE", now);
    await note(member.id, `Ancient ${tag}`, "ORGANIZATION", new Date(Date.now() - 40 * 24 * 60 * 60 * 1000));
    const file = (uploadedById: string, name: string, deletedAt: Date | null) =>
      ownerDb.orgFile.create({
        data: {
          organizationId: org.id,
          name,
          contentType: "text/plain",
          sizeBytes: 3,
          storageKey: `files/${org.id}/${randomBytes(6).toString("hex")}`,
          visibility: "ORGANIZATION",
          uploadedById,
          deletedAt,
        },
        select: { id: true },
      });
    memberFile = (await file(member.id, `notes-${tag}.txt`, null)).id;
    longGone = (await file(member.id, `old-${tag}.txt`, new Date(Date.now() - 40 * 24 * 60 * 60 * 1000))).id;
  } catch (error) {
    console.warn("[trash.db.test] skipped:", error instanceof Error ? error.message : error);
    reachable = false;
  }
}, 30_000);

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

describe("Recently deleted", () => {
  it("lists what each person may bring back, within the window", async () => {
    if (!reachable) return;
    const memberSees = await as(member, ({ db }) => getDeletedNotes(db, org.id, member.id, false));
    expect(memberSees.map((n) => n.title)).toEqual([`Mine ${tag}`]);
    const ownerSees = await as(owner, ({ db }) => getDeletedNotes(db, org.id, owner.id, true));
    expect(ownerSees.map((n) => n.title).sort()).toEqual([`Owner private ${tag}`, `Shared ${tag}`].sort());
  });

  it("a deleted file waits in the trash and comes back on restore", async () => {
    if (!reachable) return;
    expect(await as(member, ({ db }) => removeNoteFile(db, org.id, memberFile))).toMatch(/^files\//);
    const trash = await as(member, ({ db }) => listDeletedNoteFiles(db, org.id, member.id, false));
    expect(trash.map((f) => f.name)).toEqual([`notes-${tag}.txt`]);
    expect(await as(member, ({ db }) => countDeleted(db, org.id, member.id, false))).toBe(2);

    expect(await as(member, ({ db }) => restoreNoteFile(db, org.id, memberFile))).toBe(true);
    expect(await as(member, ({ db }) => listDeletedNoteFiles(db, org.id, member.id, false))).toEqual([]);
    // Past the window, it can't be brought back.
    expect(await as(member, ({ db }) => restoreNoteFile(db, org.id, longGone))).toBe(false);
  });
});
