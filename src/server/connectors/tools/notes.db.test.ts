// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * list_notes and get_note against the real roles and policies
 * (src/test/connector-fixture.ts): another member's PRIVATE note, one
 * shared by name and then unshared, the 40,000-character parts of a long
 * note, and the denials every tool has.
 */

vi.mock("@/lib/auth/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));

import { NotFoundError } from "@/lib/auth/errors";
import { noteToMarkdown } from "@/lib/notes/export/markdown";
import { disconnectAll } from "@/server/db/clients";
import { ConnectorRefusedError } from "@/server/db/context";
import { asJson, setUpConnectorFixture, type ConnectorFixture } from "@/test/connector-fixture";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { itemId } from "./ids";
import { getNote, listNotes } from "./notes";
import { SectionHiddenError } from "./space";
import { TEXT_LIMIT } from "./text";

let fx: ConnectorFixture | null = null;
const ids = { folder: "", minutes: "", secret: "", shared: "", long: "", chess: "", paused: "" };

function doc(...paragraphs: string[]) {
  return {
    type: "doc",
    content: paragraphs.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
  };
}

const LONG_PARAGRAPHS = Array.from(
  { length: 700 },
  (_, i) => `Paragraph ${i}: the budget committee met again and wrote down what it decided.`,
);

beforeAll(async () => {
  fx = await setUpConnectorFixture("tool-notes");
  if (!fx) return;
  const { alice, bob, club, other, pausedId, tag } = fx;
  ids.folder = (
    await ownerDb.noteFolder.create({
      data: { organizationId: club.id, name: `Minutes ${tag}`, createdById: bob.id },
      select: { id: true },
    })
  ).id;
  const note = async (
    organizationId: string,
    authorId: string,
    title: string,
    paragraphs: string[],
    extra: { visibility?: "PRIVATE" | "ORGANIZATION"; folderId?: string } = {},
  ) =>
    (
      await ownerDb.note.create({
        data: {
          organizationId,
          title,
          contentJson: doc(...paragraphs),
          contentText: paragraphs.join("\n"),
          visibility: extra.visibility ?? "ORGANIZATION",
          folderId: extra.folderId,
          authorId,
          updatedById: authorId,
        },
        select: { id: true },
      })
    ).id;
  ids.minutes = await note(club.id, bob.id, `Meeting minutes ${tag}`, ["We picked a venue."], {
    folderId: ids.folder,
  });
  ids.secret = await note(club.id, bob.id, `Bob's diary ${tag}`, ["Private worries."], {
    visibility: "PRIVATE",
  });
  ids.shared = await note(club.id, bob.id, `Draft for Alice ${tag}`, ["Shared by name."], {
    visibility: "PRIVATE",
  });
  await ownerDb.noteShare.create({
    data: { organizationId: club.id, noteId: ids.shared, userId: alice.id, createdById: bob.id },
  });
  ids.long = await note(club.id, bob.id, `Budget history ${tag}`, LONG_PARAGRAPHS);
  ids.chess = await note(other.id, bob.id, `Chess openings ${tag}`, ["e4"]);
  ids.paused = await note(pausedId, alice.id, `Paused note ${tag}`, ["Still readable."]);
});

afterAll(async () => {
  await fx?.cleanup();
  await disconnectAll();
  await disconnectOwnerDb();
});

describe("list_notes", () => {
  it("lists the notes the member may read, by folder and words, and not another member's private note", async () => {
    if (!fx) return;
    const { alice, bob, club } = fx;
    const session = await fx.session(alice);
    const res = await listNotes(session, { space: club.id });
    const listed = res.notes.map((n) => n.id);
    expect(listed).toEqual(
      expect.arrayContaining([
        itemId("note", club.id, ids.minutes),
        itemId("note", club.id, ids.shared),
        itemId("note", club.id, ids.long),
      ]),
    );
    expect(listed).not.toContain(itemId("note", club.id, ids.secret));
    expect(res.notes.find((n) => n.id === itemId("note", club.id, ids.minutes))).toMatchObject({
      title: `Meeting minutes ${fx.tag}`,
      folder: { id: ids.folder, name: `Minutes ${fx.tag}` },
      private: false,
      author: { id: itemId("person", club.id, bob.id), name: bob.name },
      url: `http://localhost:3000/app/${club.slug}/notes/${ids.minutes}`,
    });
    expect(res.notes.find((n) => n.id === itemId("note", club.id, ids.shared))?.private).toBe(true);

    const inFolder = await listNotes(session, { space: club.id, folder: ids.folder });
    expect(inFolder.notes.map((n) => n.id)).toEqual([itemId("note", club.id, ids.minutes)]);
    const words = await listNotes(session, { space: club.id, query: `venue ${fx.tag}` });
    expect(words.notes.map((n) => n.id)).toEqual([itemId("note", club.id, ids.minutes)]);

    const page = await listNotes(session, { space: club.id, limit: 2 });
    expect(page.notes).toHaveLength(2);
    const rest = await listNotes(session, { space: club.id, limit: 2, cursor: page.nextCursor! });
    expect(rest.notes).toHaveLength(1);
    expect(rest.nextCursor).toBeNull();
  });

  it("reads a paused organization's notes, and refuses another org, the organization switch, another scope and hidden Files", async () => {
    if (!fx) return;
    const { alice, bob, club, other, pausedId, personalId } = fx;
    const session = await fx.session(alice);
    expect((await listNotes(session, { space: pausedId })).notes.map((n) => n.title)).toEqual([
      `Paused note ${fx.tag}`,
    ]);
    await expect(listNotes(session, { space: other.id })).rejects.toBeInstanceOf(NotFoundError);
    await fx.switchedOff(club.id, () =>
      expect(listNotes(session, { space: club.id })).rejects.toBeInstanceOf(ConnectorRefusedError),
    );
    await expect(
      listNotes(await fx.session(alice, { organizationId: personalId }), { space: club.id }),
    ).rejects.toMatchObject({ reason: "scope" });
    await fx.hiding(club.id, ["notes"], async () => {
      await expect(listNotes(session, { space: club.id })).rejects.toBeInstanceOf(
        SectionHiddenError,
      );
      expect((await listNotes(await fx!.session(bob), { space: club.id })).notes.length).toBe(4);
    });
  });
});

describe("get_note", () => {
  it("reads a note as Markdown with its folder, author and link", async () => {
    if (!fx) return;
    const { alice, bob, club } = fx;
    const note = await getNote(await fx.session(alice), {
      id: itemId("note", club.id, ids.minutes),
    });
    expect(note).toMatchObject({
      title: `Meeting minutes ${fx.tag}`,
      markdown: `# Meeting minutes ${fx.tag}\n\nWe picked a venue.\n`,
      folder: { id: ids.folder, name: `Minutes ${fx.tag}` },
      author: { name: bob.name },
      space: { id: club.id },
      offset: 0,
      truncated: false,
      nextOffset: null,
    });
  });

  it("hides another member's private note, and a shared note once the share is removed", async () => {
    if (!fx) return;
    const { alice, club } = fx;
    const session = await fx.session(alice);
    await expect(
      getNote(session, { id: itemId("note", club.id, ids.secret) }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(
      (await getNote(session, { id: itemId("note", club.id, ids.shared) })).markdown,
    ).toContain("Shared by name.");
    await ownerDb.noteShare.delete({
      where: { noteId_userId: { noteId: ids.shared, userId: alice.id } },
    });
    await expect(
      getNote(session, { id: itemId("note", club.id, ids.shared) }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect((await listNotes(session, { space: club.id })).notes.map((n) => n.id)).not.toContain(
      itemId("note", club.id, ids.shared),
    );
  });

  it("answers another org's note and a forged id as not found", async () => {
    if (!fx) return;
    const { alice, club, other } = fx;
    const session = await fx.session(alice);
    await expect(
      getNote(session, { id: itemId("note", other.id, ids.chess) }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      getNote(session, { id: itemId("note", club.id, ids.chess) }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("returns a long note in parts of at most 40,000 characters that join back into the whole", async () => {
    if (!fx) return;
    const { alice, club } = fx;
    const session = await fx.session(alice);
    const id = itemId("note", club.id, ids.long);
    const whole = noteToMarkdown(`Budget history ${fx.tag}`, doc(...LONG_PARAGRAPHS), {
      baseUrl: `http://localhost:3000/app/${club.slug}`,
      orgId: club.id,
    });
    expect(whole.length).toBeGreaterThan(TEXT_LIMIT);

    const first = await getNote(session, { id });
    expect(first.truncated).toBe(true);
    expect(first.markdown.length).toBeLessThanOrEqual(TEXT_LIMIT);
    expect(first.markdown.endsWith("\n")).toBe(true);
    expect(first.totalLength).toBe(whole.length);
    const second = await getNote(session, { id, offset: first.nextOffset! });
    expect(second).toMatchObject({ offset: first.nextOffset, truncated: false, nextOffset: null });
    expect(first.markdown + second.markdown).toBe(whole);

    const past = await getNote(session, { id, offset: whole.length + 10 });
    expect(past).toMatchObject({ markdown: "", truncated: false, nextOffset: null });
  });
});

describe("through the MCP server", () => {
  it("returns list_notes and get_note within their output schemas", async () => {
    if (!fx) return;
    const session = await fx.session(fx.alice);
    const list = { space: fx.club.id };
    expect(await fx.call(session, "list_notes", list)).toEqual(
      asJson(await listNotes(session, list)),
    );
    const id = itemId("note", fx.club.id, ids.long);
    expect(await fx.call(session, "get_note", { id, offset: 100 })).toEqual(
      asJson(await getNote(session, { id, offset: 100 })),
    );
  });
});
