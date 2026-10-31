// @vitest-environment node
// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { afterAll, describe, expect, it, vi } from "vitest";

/**
 * Comments, versions and nested pages on the RLS path, against the real
 * roles and policies of the local seeded database (skipped without it).
 * Everything created here is deleted in afterAll.
 *
 * Pins: a member who can only view a club note comments on it but can't
 * resolve a thread or save a version; the database refuses the same when
 * the app is bypassed; another club's member sees none of it; a page can't
 * go inside its own subpage.
 */

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock }));
vi.mock("@/server/notifications", () => ({ notifyUsers: vi.fn() }));

import { authDb, disconnectAll, serviceDb } from "@/server/db/clients";
import { withOrgTx, withSystemOrgTx } from "@/server/db/context";

import { createNote, updateNoteAccess, updateNoteSettings } from "./actions";
import { addNoteComment, resolveNoteThread } from "./comment-actions";
import { saveNamedVersion } from "./version-actions";

interface Person {
  id: string;
  email: string;
  name: string | null;
}

async function orgIdBySlug(slug: string): Promise<string | null> {
  const rows = await serviceDb.$queryRaw<{ organizationId: string }[]>`
    SELECT "organizationId" FROM app.resolve_org_slug(${slug})`;
  return rows[0]?.organizationId ?? null;
}

let seeded: {
  cbcId: string;
  roboticsId: string;
  kristine: Person;
  alex: Person;
  alice: Person;
} | null = null;
try {
  const cbcId = await orgIdBySlug("claude-builders-club");
  const roboticsId = await orgIdBySlug("robotics-club");
  const users = await authDb.user.findMany({
    where: { email: { in: ["kristine", "alex", "alice"].map((n) => `${n}@example.edu`) } },
    select: { id: true, email: true, name: true },
  });
  const by = (n: string) => users.find((u) => u.email === `${n}@example.edu`);
  const [kristine, alex, alice] = ["kristine", "alex", "alice"].map(by);
  if (cbcId && roboticsId && kristine && alex && alice) {
    seeded = { cbcId, roboticsId, kristine, alex, alice };
  }
} catch {
  seeded = null;
}

describe.skipIf(!seeded)("comments and versions on the RLS path (seeded CBC)", () => {
  const s = seeded!;
  const created: string[] = [];
  const as = (p: Person) => requireUserMock.mockResolvedValue(p);

  afterAll(async () => {
    for (const id of created.reverse()) {
      await withSystemOrgTx(s.cbcId, ({ db }) => db.note.deleteMany({ where: { id } }));
    }
    await disconnectAll();
  });

  async function clubNote() {
    as(s.kristine);
    const { noteId } = await createNote(s.cbcId, { title: "RLS comments" });
    created.push(noteId!);
    expect((await updateNoteAccess(s.cbcId, noteId!, "CLUB_VIEW")).error).toBeUndefined();
    return noteId!;
  }

  it("a viewer comments, but resolving and saving versions are refused (app and database)", async () => {
    const id = await clubNote();

    as(s.alex);
    const added = await addNoteComment(s.cbcId, id, { body: "Can we start at 6:15?" });
    expect(added.error).toBeUndefined();
    const threadId = added.commentId!;

    expect((await resolveNoteThread(s.cbcId, id, threadId, true)).error).toMatch(/edit/i);
    expect((await saveNamedVersion(s.cbcId, id, "Mine")).error).toMatch(/permission/i);

    // Straight to the database as alex: the guard and the policy refuse.
    await expect(
      withOrgTx(s.cbcId, ({ db, userId }) =>
        db.noteComment.updateMany({
          where: { id: threadId },
          data: { resolvedAt: new Date(), resolvedById: userId },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withOrgTx(s.cbcId, ({ db, userId }) =>
        db.noteVersion.create({
          data: {
            organizationId: s.cbcId,
            noteId: id,
            name: "Sneaky",
            createdById: userId,
            contentJson: { type: "doc", content: [{ type: "paragraph" }] },
          },
        }),
      ),
    ).rejects.toThrow();

    // The author resolves it and names a version.
    as(s.kristine);
    expect((await resolveNoteThread(s.cbcId, id, threadId, true)).error).toBeUndefined();
    const saved = await saveNamedVersion(s.cbcId, id, "Kickoff");
    expect(saved.versions?.map((v) => v.name)).toContain("Kickoff");
  });

  it("another organization's member sees none of the note's comments or versions", async () => {
    const id = await clubNote();
    as(s.kristine);
    await addNoteComment(s.cbcId, id, { body: "Inside the organization" });
    await saveNamedVersion(s.cbcId, id, "Organization only");

    as(s.alice);
    const rows = await withOrgTx(s.roboticsId, async ({ db }) => ({
      comments: await db.noteComment.findMany({ where: { noteId: id } }),
      versions: await db.noteVersion.findMany({ where: { noteId: id } }),
    }));
    expect(rows.comments).toEqual([]);
    expect(rows.versions).toEqual([]);
  });

  it("nests pages, and never a page inside its own subpage", async () => {
    as(s.kristine);
    const parent = (await createNote(s.cbcId, { title: "Parent" })).noteId!;
    created.push(parent);
    const child = (await createNote(s.cbcId, { title: "Child", parentId: parent })).noteId!;
    created.push(child);
    const row = await withOrgTx(s.cbcId, ({ db }) =>
      db.note.findUnique({ where: { id: child }, select: { parentId: true } }),
    );
    expect(row?.parentId).toBe(parent);
    const loop = await updateNoteSettings(s.cbcId, parent, { parentId: child });
    expect(loop.error).toMatch(/inside itself|subpages/);
  });
});
