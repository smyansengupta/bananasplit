// @vitest-environment node
// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

/**
 * The collaboration bridge's load and store on the RLS path, against the
 * real roles and policies of the local seeded database (skipped without the
 * database or the seed; everything created here is deleted in afterAll).
 *
 * Pins: the bridge acts in the named user's own context, so the database
 * refuses a live save by anyone but the author or an OWNER/ADMIN and hides
 * a PRIVATE note from everyone but its author; a live save feeds search; an
 * autosave lands in the Yjs state so a live session merges it.
 */

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock }));

import { NotFoundError } from "@/lib/auth/errors";
import { noteStateToContent } from "@/lib/collab/note-doc";
import { NOTE_FIELD } from "@/lib/collab/protocol";
import { authDb, disconnectAll, serviceDb } from "@/server/db/clients";
import { withOrgTxAs, withSystemOrgTx } from "@/server/db/context";

import { createNote, updateNote, updateNoteDetails } from "@/app/app/[orgSlug]/notes/actions";
import { searchWorkspace } from "@/app/app/[orgSlug]/search/actions";

import { loadNoteState, storeNoteState } from "./persistence";

interface Person {
  id: string;
  email: string;
  name: string | null;
}

interface Seeded {
  cbcId: string;
  jackson: Person; // OWNER
  oliver: Person; // ADMIN
  kristine: Person; // MEMBER
  alex: Person; // MEMBER
  alice: Person; // robotics OWNER, not in CBC
}

let seeded: Seeded | null = null;
try {
  const rows = await serviceDb.$queryRaw<{ organizationId: string }[]>`
    SELECT "organizationId" FROM app.resolve_org_slug(${"claude-builders-club"})`;
  const cbcId = rows[0]?.organizationId;
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
  if (cbcId && jackson && oliver && kristine && alex && alice) {
    seeded = { cbcId, jackson, oliver, kristine, alex, alice };
  }
} catch {
  seeded = null;
}

const WORD = `quokkaflux${Date.now()}`;
const body = (text: string) =>
  JSON.stringify({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });

/** A live editor appending to the first paragraph of `state`. */
function type(state: Uint8Array, text: string) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  const t = (doc.getXmlFragment(NOTE_FIELD).get(0) as Y.XmlElement).get(0) as Y.XmlText;
  t.insert(t.length, text);
  return Y.encodeStateAsUpdate(doc);
}

describe.skipIf(!seeded)("collaboration bridge on the RLS path (seeded CBC)", () => {
  const s = seeded as Seeded;
  const created: string[] = [];
  const as = (p: Person) => requireUserMock.mockResolvedValue(p);
  const load = (p: Person, id: string) =>
    withOrgTxAs(p.id, s.cbcId, (ctx) => loadNoteState(ctx, id));
  const store = (p: Person, id: string, state: Uint8Array) =>
    withOrgTxAs(p.id, s.cbcId, (ctx) => storeNoteState(ctx, id, state));

  beforeEach(() => as(s.kristine));

  afterAll(async () => {
    for (const id of created) {
      await withSystemOrgTx(s.cbcId, ({ db }) => db.note.deleteMany({ where: { id } }));
    }
    await disconnectAll();
  });

  async function kristinesNote() {
    as(s.kristine);
    const { noteId } = await createNote(s.cbcId, { title: `Live ${WORD}` });
    created.push(noteId!);
    const res = await updateNote(
      s.cbcId,
      noteId!,
      {
        title: `Live ${WORD}`,
        contentJson: body("Agenda"),
        contentText: "Agenda",
        visibility: "ORGANIZATION",
        eventId: null,
      },
      1,
    );
    expect(res.error).toBeUndefined();
    return noteId!;
  }

  it("lets members load an ORGANIZATION note but only the author or an ADMIN save it", async () => {
    const id = await kristinesNote();
    const seededState = await load(s.alex, id);
    expect(noteStateToContent(seededState!).text).toBe("Agenda");

    expect(await store(s.alex, id, type(seededState!, " sneaky"))).toEqual({
      ok: false,
      reason: "forbidden",
    });
    // The database agrees, without the app check.
    const direct = await withOrgTxAs(s.alex.id, s.cbcId, ({ db }) =>
      db.note.updateMany({ where: { id }, data: { yjsState: new Uint8Array([1]) } }),
    );
    expect(direct.count).toBe(0);

    const live = type(seededState!, ` ${WORD}zz`);
    const saved = await store(s.oliver, id, live);
    expect(saved).toMatchObject({ ok: true, version: 3 });

    // The live save feeds search (searchVector over contentText).
    as(s.kristine);
    expect((await searchWorkspace(s.cbcId, `${WORD}zz`)).notes.map((n) => n.id)).toContain(id);
    const row = await withSystemOrgTx(s.cbcId, ({ db }) =>
      db.note.findUnique({ where: { id }, select: { contentText: true, updatedById: true } }),
    );
    expect(row).toEqual({ contentText: `Agenda ${WORD}zz`, updatedById: s.oliver.id });
  });

  it("merges an autosave into a live session instead of losing either", async () => {
    const id = await kristinesNote();
    const opened = (await load(s.kristine, id))!;
    const liveEdit = type(opened, " + live");
    expect((await store(s.kristine, id, liveEdit)).ok).toBe(true);

    // Someone on the autosave editor (collaboration unreachable for them)
    // saves on top of the live save.
    as(s.oliver);
    const autosave = await updateNote(
      s.cbcId,
      id,
      {
        title: `Live ${WORD}`,
        contentJson: body("Agenda + live + autosave"),
        contentText: "",
        visibility: "ORGANIZATION",
        eventId: null,
      },
      3,
    );
    expect(autosave.error).toBeUndefined();

    // The live session, which never saw the autosave, keeps typing and saves.
    const result = await store(s.kristine, id, type(liveEdit, "!"));
    expect(result.ok && result.missing).toBeTruthy();
    const text = noteStateToContent((await load(s.kristine, id))!).text;
    expect(text).toContain("autosave");
    expect(text.split("Agenda").length - 1).toBe(1);
  });

  it("keeps a PRIVATE note's live document from everyone but its author", async () => {
    const id = await kristinesNote();
    expect(await updateNoteDetails(s.cbcId, id, { visibility: "PRIVATE" })).toEqual({ noteId: id });

    expect(await load(s.jackson, id)).toBeNull();
    expect(await store(s.jackson, id, (await load(s.kristine, id))!)).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(await load(s.kristine, id)).not.toBeNull();
  });

  it("refuses a user outside the org before touching the note", async () => {
    const id = await kristinesNote();
    await expect(load(s.alice, id)).rejects.toBeInstanceOf(NotFoundError);
  });
});
