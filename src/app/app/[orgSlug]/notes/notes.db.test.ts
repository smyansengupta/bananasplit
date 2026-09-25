// @vitest-environment node
// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Notes and workspace search on the RLS path (0C), against the real roles
 * and policies of the local seeded database. Skipped without the database or
 * the seed. Everything created here is deleted in afterAll.
 *
 * Pins: PRIVATE notes stay invisible to everyone but the author (OWNER
 * included, in the app and in the database), only the author or an
 * OWNER/ADMIN edits, and nothing crosses into another org.
 */

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock }));

import { NotFoundError } from "@/lib/auth/errors";
import { authDb, disconnectAll, serviceDb } from "@/server/db/clients";
import { withOrgTx, withSystemOrgTx } from "@/server/db/context";

import { searchWorkspace } from "../search/actions";
import { createNote, deleteNote, restoreNote, updateNote } from "./actions";

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

interface Seeded {
  cbcId: string;
  roboticsId: string;
  jackson: Person; // OWNER
  oliver: Person; // ADMIN
  kristine: Person; // MEMBER
  alex: Person; // MEMBER
  alice: Person; // robotics OWNER
}

let seeded: Seeded | null = null;
try {
  const [cbcId, roboticsId] = [
    await orgIdBySlug("claude-builders-club"),
    await orgIdBySlug("robotics-club"),
  ];
  const users = await authDb.user.findMany({
    where: {
      email: {
        in: ["jackson", "oliver", "kristine", "alex", "alice"].map((n) => `${n}@example.edu`),
      },
    },
    select: { id: true, email: true, name: true },
  });
  const by = (n: string) => users.find((u) => u.email === `${n}@example.edu`);
  const [jackson, oliver, kristine, alex, alice] = [
    "jackson",
    "oliver",
    "kristine",
    "alex",
    "alice",
  ].map(by);
  if (cbcId && roboticsId && jackson && oliver && kristine && alex && alice) {
    seeded = { cbcId, roboticsId, jackson, oliver, kristine, alex, alice };
  }
} catch {
  seeded = null;
}

const WORD = `zebracorn${Date.now()}`;
const doc = JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] });

describe.skipIf(!seeded)("notes and search on the RLS path (seeded CBC)", () => {
  const s = seeded as Seeded;
  const created: { orgId: string; id: string }[] = [];
  const as = (p: Person) => requireUserMock.mockResolvedValue(p);

  beforeEach(() => as(s.kristine));

  afterAll(async () => {
    for (const { orgId, id } of created) {
      await withSystemOrgTx(orgId, ({ db }) => db.note.deleteMany({ where: { id } }));
    }
    await disconnectAll();
  });

  async function kristinesNote(visibility: "PRIVATE" | "ORGANIZATION") {
    as(s.kristine);
    const { noteId } = await createNote(s.cbcId, { title: `Minutes ${WORD}` });
    created.push({ orgId: s.cbcId, id: noteId! });
    const res = await updateNote(
      s.cbcId,
      noteId!,
      {
        title: `Minutes ${WORD}`,
        contentJson: doc,
        contentText: "budget",
        visibility,
        eventId: null,
      },
      1,
    );
    expect(res.error).toBeUndefined();
    return noteId!;
  }

  it("a PRIVATE note is invisible to an OWNER, in the action and in the database", async () => {
    const id = await kristinesNote("PRIVATE");

    as(s.jackson);
    const res = await updateNote(
      s.cbcId,
      id,
      {
        title: "hijack",
        contentJson: doc,
        contentText: "",
        visibility: "ORGANIZATION",
        eventId: null,
      },
      2,
    );
    expect(res.error).toMatch(/not found/i);
    // RLS: even a query without the visibility filter sees nothing.
    const direct = await withOrgTx(s.cbcId, ({ db }) => db.note.findUnique({ where: { id } }));
    expect(direct).toBeNull();
    expect((await searchWorkspace(s.cbcId, WORD)).notes.map((n) => n.id)).not.toContain(id);

    as(s.kristine);
    expect((await searchWorkspace(s.cbcId, WORD)).notes.map((n) => n.id)).toContain(id);
  });

  it("an ORGANIZATION note: an ADMIN edits it, another MEMBER cannot (app and database)", async () => {
    const id = await kristinesNote("ORGANIZATION");

    as(s.alex);
    const denied = await deleteNote(s.cbcId, id);
    expect(denied.error).toMatch(/don't have permission/i);
    const direct = await withOrgTx(s.cbcId, ({ db }) =>
      db.note.updateMany({ where: { id }, data: { title: "sneaky" } }),
    );
    expect(direct.count).toBe(0);

    as(s.oliver);
    expect(await deleteNote(s.cbcId, id)).toEqual({});
    expect(await restoreNote(s.cbcId, id)).toEqual({});
  });

  it("nothing crosses into another org", async () => {
    const foreign = await withSystemOrgTx(s.roboticsId, ({ db }) =>
      db.note.create({
        data: {
          organizationId: s.roboticsId,
          title: `Robotics ${WORD}`,
          contentJson: {},
          contentText: "",
          visibility: "ORGANIZATION",
          authorId: s.alice.id,
          updatedById: s.alice.id,
        },
        select: { id: true },
      }),
    );
    created.push({ orgId: s.roboticsId, id: foreign.id });

    as(s.kristine);
    // Called with a foreign note id in the member's own org: not found.
    expect((await deleteNote(s.cbcId, foreign.id)).error).toMatch(/not found/i);
    expect((await searchWorkspace(s.cbcId, WORD)).notes.map((n) => n.id)).not.toContain(foreign.id);
    // Called with the other org's id: the wrapper refuses a non-member.
    await expect(deleteNote(s.roboticsId, foreign.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(searchWorkspace(s.roboticsId, WORD)).rejects.toBeInstanceOf(NotFoundError);

    const untouched = await withSystemOrgTx(s.roboticsId, ({ db }) =>
      db.note.findUnique({ where: { id: foreign.id }, select: { deletedAt: true } }),
    );
    expect(untouched?.deletedAt).toBeNull();
  });
});
