// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * create_note against the real roles and policies
 * (src/test/connector-fixture.ts): a private note from Markdown, read back
 * by get_note as the same Markdown, in a folder or not, with live
 * collaboration's Yjs state when it's on, and audited; a folder that isn't
 * the club's. The wrapper's own refusals are in write.db.test.ts.
 */

vi.mock("@/lib/auth/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));

import { noteStateToContent } from "@/lib/collab/note-doc";
import { disconnectAll } from "@/server/db/clients";
import { asJson, setUpConnectorFixture, type ConnectorFixture } from "@/test/connector-fixture";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { createNoteTool } from "./note-writes";
import { getNote } from "./notes";
import { WriteRefusedError } from "./write";

let fx: ConnectorFixture | null = null;
const ids = { folder: "", chessFolder: "" };

const MINUTES = [
  "# Board minutes",
  "",
  "## Decisions",
  "",
  "- Book the **ballroom**",
  "- [Budget](https://example.com/budget) approved",
  "",
  "- [ ] Send the invites",
  "- [x] Pick a date",
  "",
].join("\n");

/** The raw id inside a tool's note id. */
const rawId = (id: string) => id.split(":")[2]!;

beforeAll(async () => {
  fx = await setUpConnectorFixture("tool-note-writes");
  if (!fx) return;
  // Without live collaboration unless a test turns it on.
  vi.stubEnv("COLLAB_ENABLED", "false");
  const { bob, club, other, tag } = fx;
  ids.folder = (
    await ownerDb.noteFolder.create({
      data: { organizationId: club.id, name: `Meetings ${tag}`, createdById: bob.id },
      select: { id: true },
    })
  ).id;
  ids.chessFolder = (
    await ownerDb.noteFolder.create({
      data: { organizationId: other.id, name: `Openings ${tag}`, createdById: bob.id },
      select: { id: true },
    })
  ).id;
});

afterAll(async () => {
  await fx?.cleanup();
  await disconnectAll();
  await disconnectOwnerDb();
});

describe("create_note", () => {
  it("makes a private note from Markdown that get_note reads back the same, and audits it", async () => {
    if (!fx) return;
    const { alice, bob, club, tag } = fx;
    const session = await fx.session(alice, { access: "WRITE" });
    const res = await createNoteTool(session, { space: club.id, markdown: MINUTES });
    const id = rawId(res.note.id);
    expect(res).toEqual({
      space: { id: club.id, name: `Robotics ${tag}` },
      note: {
        id: res.note.id,
        title: "Board minutes",
        folder: null,
        private: true,
        url: `http://localhost:3000/app/${club.slug}/notes/${id}`,
      },
    });
    const read = await getNote(session, { id: res.note.id });
    expect(read.markdown).toBe(MINUTES);
    // One after another: the owner client has a small pool.
    const row = await ownerDb.note.findUniqueOrThrow({
      where: { id },
      select: { authorId: true, visibility: true, contentText: true, yjsState: true },
    });
    expect(row).toMatchObject({ authorId: alice.id, visibility: "PRIVATE", yjsState: null });
    expect(row.contentText).toContain("Book the ballroom");
    // Private: the club's owner doesn't see it.
    await expect(getNote(await fx.session(bob), { id: res.note.id })).rejects.toMatchObject({
      name: "NotFoundError",
    });
    expect(
      await ownerDb.orgAuditLog.findFirst({
        where: { organizationId: club.id, action: "connector.create_note" },
        select: { actorId: true, targetType: true, targetId: true },
      }),
    ).toEqual({ actorId: alice.id, targetType: "Note", targetId: id });
  });

  it("takes a title and a folder, and drops a first line that repeats the title", async () => {
    if (!fx) return;
    const { alice, club, tag } = fx;
    const session = await fx.session(alice, { access: "WRITE" });
    const res = await createNoteTool(session, {
      space: club.id,
      title: "Board minutes",
      markdown: MINUTES,
      folder: ids.folder,
    });
    expect(res.note).toMatchObject({
      title: "Board minutes",
      folder: { id: ids.folder, name: `Meetings ${tag}` },
    });
    expect((await getNote(session, { id: res.note.id })).markdown).toBe(MINUTES);
    const titled = await createNoteTool(session, {
      space: club.id,
      title: "Agenda",
      markdown: MINUTES,
    });
    expect((await getNote(session, { id: titled.note.id })).markdown).toBe(
      `# Agenda\n\n${MINUTES}`,
    );
  });

  it("makes an empty Untitled note, and one in Personal", async () => {
    if (!fx) return;
    const { alice, personalId } = fx;
    const session = await fx.session(alice, { access: "WRITE" });
    const res = await createNoteTool(session, { space: personalId });
    expect(res.note).toMatchObject({ title: "Untitled note", private: true });
    expect((await getNote(session, { id: res.note.id })).markdown).toBe("# Untitled note\n");
  });

  it("refuses a folder that isn't this club's, and makes nothing", async () => {
    if (!fx) return;
    const { alice, club, tag } = fx;
    const session = await fx.session(alice, { access: "WRITE" });
    const before = await ownerDb.note.count({ where: { organizationId: club.id } });
    for (const folder of [ids.chessFolder, `nope${tag}`]) {
      await expect(
        createNoteTool(session, { space: club.id, title: "Lost", folder }),
      ).rejects.toEqual(new WriteRefusedError("That folder no longer exists."));
    }
    expect(await ownerDb.note.count({ where: { organizationId: club.id } })).toBe(before);
  });

  it("stores the body as Yjs state too while live collaboration is on", async () => {
    if (!fx) return;
    const { alice, club } = fx;
    vi.stubEnv("COLLAB_ENABLED", "true");
    vi.stubEnv("COLLAB_SERVER_URL", "ws://localhost:1234");
    vi.stubEnv("COLLAB_SECRET", "s".repeat(40));
    try {
      const session = await fx.session(alice, { access: "WRITE" });
      const res = await createNoteTool(session, { space: club.id, markdown: MINUTES });
      const row = await ownerDb.note.findUniqueOrThrow({
        where: { id: rawId(res.note.id) },
        select: { contentJson: true, yjsState: true },
      });
      expect(row.yjsState).not.toBeNull();
      expect(noteStateToContent(new Uint8Array(row.yjsState!)).json).toEqual(row.contentJson);
    } finally {
      vi.stubEnv("COLLAB_ENABLED", "false");
    }
  });

  it("returns its result within its output schema through the MCP server", async () => {
    if (!fx) return;
    const session = await fx.session(fx.alice, { access: "WRITE" });
    const wire = await fx.call(session, "create_note", {
      space: fx.club.id,
      markdown: "# Over the wire\n\nHello.",
    });
    expect(wire).toMatchObject({ note: { title: "Over the wire", private: true } });
    expect(asJson(await getNote(session, { id: (wire.note as { id: string }).id }))).toMatchObject({
      markdown: "# Over the wire\n\nHello.\n",
    });
  });
});
