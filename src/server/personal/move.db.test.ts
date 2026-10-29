// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * "Bring anything in?" against the real roles, policies and
 * app.move_personal_items on the local database: what a Personal space
 * lists, the move, and that every public link still resolves from the club
 * (the RSVP page, a ticket, an availability poll with its responses), and
 * Files: a folder, a note with sub-pages and an image, uploads whose bytes
 * are copied into the club's storage, history and comments.
 * Throwaway users, their Personal spaces and a club are made here and
 * removed in afterAll. Skipped when the database is not reachable, like the
 * other *.db.test.ts files.
 */

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock, getSession: vi.fn() }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));

import { pollOrgId } from "@/app/poll/[pollId]/poll-org";
import { noteStateToContent, seedNoteState } from "@/lib/collab/note-doc";
import { authDb, disconnectAll } from "@/server/db/clients";
import { openNoteFile, storeNoteFile } from "@/server/notes/files";
import { loadRsvpPage, rsvpPageTarget } from "@/server/rsvp/page";
import { loadTicket } from "@/server/rsvp/ticket";
import { deleteBlobs, getBlob } from "@/server/storage";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { bringableIds, clubsUserRuns, loadBringable, movePersonalItems } from "./move";
import { ensurePersonalSpace } from "./space";

const tag = randomBytes(4).toString("hex");
const clubId = `c_bring_${tag}`;
const otherClubId = `c_bring_other_${tag}`;
const chars = "abcdefghjkmnpqrstuvwxyz23456789";
const code = (n: number) => Array.from(randomBytes(n), (b) => chars[b % chars.length]).join("");
const DAY = 24 * 60 * 60 * 1000;

interface U {
  id: string;
  email: string;
  name: string | null;
}
let maya: U;
let other: U;
let spaceId = "";
let reachable = true;

const ids = {
  rsvpEvent: `e_bring_rsvp_${tag}`,
  plainEvent: `e_bring_plain_${tag}`,
  poll: `ap_bring_${tag}`,
  slot: `ps_bring_${tag}`,
  task: `t_bring_${tag}`,
  subtask: `t_bring_sub_${tag}`,
  doneTask: `t_bring_done_${tag}`,
  label: `l_bring_${tag}`,
  trips: `fo_bring_trips_${tag}`,
  docs: `fo_bring_docs_${tag}`,
  clubDocs: `fo_bring_cdocs_${tag}`,
  note: `n_bring_${tag}`,
  subpage: `n_bring_sub_${tag}`,
  trashedSubpage: `n_bring_trash_${tag}`,
  tripNote: `n_bring_trip_${tag}`,
  version: `nv_bring_${tag}`,
  comment: `nc_bring_${tag}`,
};
/** Uploads, made through the upload path in beforeAll. */
const up = { image: "", tripFile: "", loose: "" };
/** Every storage key the test wrote, for afterAll. */
const keys: string[] = [];
// A 1x1 PNG: the image a note shows.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const imageDoc = (orgId: string, fileId: string) => ({
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Pack light" }] },
    { type: "image", attrs: { src: `/api/orgs/${orgId}/files/${fileId}`, alt: "map", fileId } },
  ],
});
const storageUsed = async (orgId: string) =>
  Number(
    (
      await ownerDb.organization.findUniqueOrThrow({
        where: { id: orgId },
        select: { storageUsedBytes: true },
      })
    ).storageUsedBytes,
  );
const rsvpSlug = code(8);
const ticketCode = code(12);

async function makeUser(local: string, name: string): Promise<U> {
  return authDb.user.create({
    data: {
      email: `${local}-${tag}@example.edu`,
      name,
      emailVerified: new Date(),
      onboardedAt: new Date(),
      timezone: "America/Chicago",
    },
    select: { id: true, email: true, name: true },
  });
}

beforeAll(async () => {
  try {
    maya = await makeUser("maya", "Maya Patel");
    other = await makeUser("other", "Other Person");
    spaceId = (await ensurePersonalSpace(maya.id)).id;
    // Maya's new club (on its trial), and one where she is only a member.
    await ownerDb.organization.create({
      data: { id: clubId, name: "Chess Club", slug: `chess-${tag}`, timezone: "America/Chicago" },
    });
    await ownerDb.membership.create({
      data: { organizationId: clubId, userId: maya.id, role: "OWNER" },
    });
    await ownerDb.organization.create({
      data: { id: otherClubId, name: "Other Club", slug: `other-${tag}`, timezone: "UTC" },
    });
    await ownerDb.membership.createMany({
      data: [
        { organizationId: otherClubId, userId: other.id, role: "OWNER" },
        { organizationId: otherClubId, userId: maya.id, role: "MEMBER" },
      ],
    });

    const start = new Date(Date.now() + 3 * DAY);
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    await ownerDb.event.createMany({
      data: [
        {
          id: ids.rsvpEvent,
          organizationId: spaceId,
          title: "Rooftop picnic",
          startsAt: start,
          endsAt: end,
          createdById: maya.id,
          hostUserId: maya.id,
          rsvpEnabled: true,
          rsvpSlug,
        },
        {
          id: ids.plainEvent,
          organizationId: spaceId,
          title: "Dentist",
          startsAt: start,
          endsAt: end,
          createdById: maya.id,
        },
      ],
    });
    await ownerDb.eventRegistration.create({
      data: {
        organizationId: spaceId,
        eventId: ids.rsvpEvent,
        name: "Guest One",
        email: `guest-${tag}@example.com`,
        phone: "+15550000001",
        inviteCode: code(8),
        ticketCode,
      },
    });
    await ownerDb.availabilityPoll.create({
      data: {
        id: ids.poll,
        organizationId: spaceId,
        title: "Study group time",
        timezone: "America/Chicago",
        durationMinutes: 60,
        createdById: maya.id,
      },
    });
    await ownerDb.pollSlot.create({
      data: {
        id: ids.slot,
        organizationId: spaceId,
        pollId: ids.poll,
        startsAt: start,
        endsAt: end,
      },
    });
    await ownerDb.pollResponse.createMany({
      data: [
        {
          organizationId: spaceId,
          pollId: ids.poll,
          slotId: ids.slot,
          guestName: "Sam",
          guestKeyHash: "a".repeat(64),
          availability: "YES",
        },
        {
          organizationId: spaceId,
          pollId: ids.poll,
          slotId: ids.slot,
          userId: maya.id,
          availability: "IF_NEEDED",
        },
      ],
    });
    await ownerDb.task.create({
      data: {
        id: ids.task,
        organizationId: spaceId,
        // It has a subtask, so it is a story (app.task_hierarchy_guard).
        type: "STORY",
        title: "Book the room",
        rank: "a0",
        createdById: maya.id,
        ownerId: maya.id,
      },
    });
    await ownerDb.task.createMany({
      data: [
        {
          id: ids.subtask,
          organizationId: spaceId,
          parentTaskId: ids.task,
          title: "Call facilities",
          rank: "a1",
          createdById: maya.id,
        },
        {
          id: ids.doneTask,
          organizationId: spaceId,
          title: "Already done",
          rank: "a2",
          createdById: maya.id,
          status: "COMPLETED",
          completedAt: new Date(),
        },
      ],
    });
    await ownerDb.label.create({
      data: { id: ids.label, organizationId: spaceId, name: "Errands", color: "#22c55e" },
    });
    await ownerDb.taskLabel.create({
      data: { organizationId: spaceId, taskId: ids.task, labelId: ids.label },
    });
    requireUserMock.mockResolvedValue(maya);

    // Files: "Trips" (picked: the club has none), "Docs" (the club has "docs").
    await ownerDb.noteFolder.createMany({
      data: [
        {
          id: ids.trips,
          organizationId: spaceId,
          name: "Trips",
          color: "chart-2",
          createdById: maya.id,
        },
        { id: ids.docs, organizationId: spaceId, name: "Docs", createdById: maya.id },
        { id: ids.clubDocs, organizationId: clubId, name: "docs", createdById: maya.id },
      ],
    });
    const stored = async (name: string, bytes: Buffer, folderId: string | null) => {
      const row = await storeNoteFile({
        orgId: spaceId,
        bytes,
        filename: name,
        visibility: "PRIVATE",
        folderId,
      });
      keys.push((await ownerDb.orgFile.findUniqueOrThrow({ where: { id: row.id } })).storageKey);
      return row.id;
    };
    up.image = await stored("map.png", PNG, null);
    up.tripFile = await stored("tickets.txt", Buffer.from("seat 12A\n"), ids.trips);
    up.loose = await stored("lease.txt", Buffer.from("rent is due\n"), null);
    const body = imageDoc(spaceId, up.image);
    await ownerDb.note.create({
      data: {
        id: ids.note,
        organizationId: spaceId,
        title: "Packing list",
        contentJson: body,
        contentText: "Pack light",
        // A live document, as after live editing: the move rewrites its link too.
        yjsState: new Uint8Array(seedNoteState(body)),
        authorId: maya.id,
        updatedById: maya.id,
        folderId: ids.docs,
      },
    });
    await ownerDb.note.createMany({
      data: [
        {
          id: ids.subpage,
          organizationId: spaceId,
          parentId: ids.note,
          title: "Day one",
          contentJson: { type: "doc", content: [{ type: "paragraph" }] },
          contentText: "",
          authorId: maya.id,
          updatedById: maya.id,
        },
        {
          id: ids.trashedSubpage,
          organizationId: spaceId,
          parentId: ids.note,
          title: "Old plan",
          contentJson: { type: "doc", content: [{ type: "paragraph" }] },
          contentText: "",
          authorId: maya.id,
          updatedById: maya.id,
          deletedAt: new Date(),
        },
        {
          id: ids.tripNote,
          organizationId: spaceId,
          title: "Itinerary",
          contentJson: { type: "doc", content: [{ type: "paragraph" }] },
          contentText: "",
          authorId: maya.id,
          updatedById: maya.id,
          folderId: ids.trips,
        },
      ],
    });
    await ownerDb.noteVersion.create({
      data: {
        id: ids.version,
        organizationId: spaceId,
        noteId: ids.note,
        contentJson: body,
        createdById: maya.id,
      },
    });
    await ownerDb.noteComment.create({
      data: {
        id: ids.comment,
        organizationId: spaceId,
        noteId: ids.note,
        authorId: maya.id,
        body: "Bring a map",
      },
    });
  } catch (error) {
    console.warn("move.db.test: database not reachable, skipping", error);
    reachable = false;
  }
});

afterAll(async () => {
  if (reachable) {
    const moved = await ownerDb.orgFile.findMany({
      where: { id: { in: Object.values(up).filter(Boolean) } },
      select: { storageKey: true },
    });
    await deleteBlobs([...keys, ...moved.map((f) => f.storageKey)]).catch(() => undefined);
    await ownerDb.organization.deleteMany({ where: { id: { in: [clubId, otherClubId] } } });
    if (spaceId) await ownerDb.organization.deleteMany({ where: { id: spaceId } });
    await ownerDb.user.deleteMany({
      where: { id: { in: [maya, other].filter(Boolean).map((u) => u.id) } },
    });
  }
  await disconnectAll();
  await disconnectOwnerDb();
});

describe("Bring anything in? against the local database", () => {
  it("lists the Personal space's event pages, events, polls and open top-level tasks", async () => {
    if (!reachable) return;
    const b = await loadBringable(maya.id);
    expect(b).not.toBeNull();
    expect(b!.rsvpEvents.map((e) => [e.id, e.going])).toEqual([[ids.rsvpEvent, 1]]);
    expect(b!.events.map((e) => e.id)).toEqual([ids.plainEvent]);
    expect(b!.polls).toEqual([
      {
        id: ids.poll,
        title: "Study group time",
        kind: "availability",
        responses: 2,
        finalizedEventId: null,
      },
    ]);
    expect(b!.taskGroups).toEqual([
      {
        project: null,
        tasks: [{ id: ids.task, title: "Book the room", dueDate: null, subtasks: 1 }],
      },
    ]);
    expect(bringableIds(b!).has(ids.doneTask)).toBe(false);
  });

  it("lists folders, top-level notes and the uploads no note shows", async () => {
    if (!reachable) return;
    const b = await loadBringable(maya.id);
    expect(b!.folders.map((f) => [f.name, f.notes, f.files])).toEqual([
      ["Docs", 1, 0],
      ["Trips", 1, 1],
    ]);
    const packing = b!.notes.find((n) => n.id === ids.note);
    // The trashed sub-page doesn't count; the image the note shows comes along.
    expect(packing).toMatchObject({ folder: "Docs", subpages: 1, files: 1 });
    expect(b!.notes.map((n) => n.id).sort()).toEqual([ids.note, ids.tripNote].sort());
    expect(b!.files.map((f) => f.id).sort()).toEqual([up.tripFile, up.loose].sort());
  });

  it("lists only the organizations the user owns or runs", async () => {
    if (!reachable) return;
    expect((await clubsUserRuns(maya.id)).map((c) => c.id)).toEqual([clubId]);
  });

  it("refuses an organization the user only belongs to, and someone else's Personal items", async () => {
    if (!reachable) return;
    const asMember = await movePersonalItems(maya.id, otherClubId, { eventIds: [ids.rsvpEvent] });
    expect(asMember).toMatchObject({ ok: false });
    const stranger = await movePersonalItems(other.id, otherClubId, { eventIds: [ids.rsvpEvent] });
    expect(stranger).toMatchObject({ ok: false });
    const still = await ownerDb.event.findUnique({
      where: { id: ids.rsvpEvent },
      select: { organizationId: true },
    });
    expect(still?.organizationId).toBe(spaceId);
  });

  it("moves the picked items into the organization, and every link still resolves there", async () => {
    if (!reachable) return;
    const result = await movePersonalItems(maya.id, clubId, {
      eventIds: [ids.rsvpEvent],
      pollIds: [ids.poll],
      taskIds: [ids.task],
    });
    expect(result).toEqual({
      ok: true,
      moved: { events: 1, polls: 1, questionPolls: 0, tasks: 2, notes: 0, folders: 0, files: 0 },
    });

    // The public RSVP page and the guest's ticket, from the club.
    const target = await rsvpPageTarget(rsvpSlug);
    expect(target).toEqual({ organizationId: clubId, eventId: ids.rsvpEvent });
    const page = await loadRsvpPage(rsvpSlug, target!, null);
    expect(page?.title).toBe("Rooftop picnic");
    const ticket = await loadTicket(rsvpSlug, ticketCode);
    expect(ticket).not.toBeNull();

    // /poll/{id}: the club owns it, responses intact.
    expect(await pollOrgId(ids.poll)).toBe(clubId);
    const responses = await ownerDb.pollResponse.findMany({
      where: { pollId: ids.poll },
      select: { organizationId: true, availability: true },
    });
    expect(responses).toHaveLength(2);
    expect(responses.every((r) => r.organizationId === clubId)).toBe(true);

    // The task, its subtask (still under it) and its label, by name, in the club.
    const tasks = await ownerDb.task.findMany({
      where: { id: { in: [ids.task, ids.subtask] } },
      select: {
        id: true,
        organizationId: true,
        parentTaskId: true,
        labels: { select: { label: { select: { name: true, organizationId: true } } } },
      },
      orderBy: { id: "asc" },
    });
    expect(tasks).toEqual([
      {
        id: ids.task,
        organizationId: clubId,
        parentTaskId: null,
        labels: [{ label: { name: "Errands", organizationId: clubId } }],
      },
      { id: ids.subtask, organizationId: clubId, parentTaskId: ids.task, labels: [] },
    ]);

    // What wasn't picked stays in Personal; the move left an audit row in the club.
    const plain = await ownerDb.event.findUnique({
      where: { id: ids.plainEvent },
      select: { organizationId: true },
    });
    expect(plain?.organizationId).toBe(spaceId);
    const audit = await ownerDb.orgAuditLog.count({
      where: { organizationId: clubId, action: "personal.items_moved" },
    });
    expect(audit).toBe(1);

    const after = await loadBringable(maya.id);
    expect(after?.rsvpEvents).toEqual([]);
    expect(after?.polls).toEqual([]);
  });

  it("refuses an item that already moved", async () => {
    if (!reachable) return;
    const again = await movePersonalItems(maya.id, clubId, { eventIds: [ids.rsvpEvent] });
    expect(again).toMatchObject({ ok: false });
  });

  it("moves a folder and a note with what comes along, copying the uploads into the organization", async () => {
    if (!reachable) return;
    const files = await ownerDb.orgFile.findMany({
      where: { id: { in: [up.image, up.tripFile] } },
      select: { id: true, storageKey: true, sizeBytes: true },
    });
    const history = (await ownerDb.noteVersion.findUniqueOrThrow({ where: { id: ids.version } }))
      .sizeBytes;
    const fileBytes = files.reduce((n, f) => n + f.sizeBytes, 0);
    const [clubBefore, spaceBefore] = [await storageUsed(clubId), await storageUsed(spaceId)];

    const result = await movePersonalItems(maya.id, clubId, {
      noteIds: [ids.note],
      folderIds: [ids.trips],
    });
    expect(result).toEqual({
      ok: true,
      moved: { events: 0, polls: 0, questionPolls: 0, tasks: 0, notes: 3, folders: 1, files: 2 },
    });

    // "Trips" moved itself (id kept); "Docs" matched the club's "docs" and stays in Personal.
    const trips = await ownerDb.noteFolder.findUniqueOrThrow({ where: { id: ids.trips } });
    expect([trips.organizationId, trips.name, trips.color]).toEqual([clubId, "Trips", "chart-2"]);
    expect(
      (await ownerDb.noteFolder.findUniqueOrThrow({ where: { id: ids.docs } })).organizationId,
    ).toBe(spaceId);

    const notes = await ownerDb.note.findMany({
      where: { id: { in: [ids.note, ids.subpage, ids.trashedSubpage, ids.tripNote] } },
      select: {
        id: true,
        organizationId: true,
        parentId: true,
        folderId: true,
        visibility: true,
        contentJson: true,
        yjsState: true,
        version: true,
      },
    });
    const note = (id: string) => notes.find((n) => n.id === id)!;
    expect(note(ids.note)).toMatchObject({
      organizationId: clubId,
      folderId: ids.clubDocs,
      visibility: "PRIVATE",
      version: 2,
    });
    expect(note(ids.subpage)).toMatchObject({ organizationId: clubId, parentId: ids.note });
    expect(note(ids.tripNote)).toMatchObject({ organizationId: clubId, folderId: ids.trips });
    // The trashed sub-page stays in Personal's trash, at the top level.
    expect(note(ids.trashedSubpage)).toMatchObject({ organizationId: spaceId, parentId: null });

    // The image links to the club, in the body, the live document and the history.
    const clubLink = `/api/orgs/${clubId}/files/${up.image}`;
    expect(JSON.stringify(note(ids.note).contentJson)).toContain(clubLink);
    expect(JSON.stringify(note(ids.note).contentJson)).not.toContain(`/api/orgs/${spaceId}/`);
    const live = noteStateToContent(new Uint8Array(note(ids.note).yjsState!));
    expect(JSON.stringify(live.json)).toContain(clubLink);
    expect(live.text).toContain("Pack light");
    const version = await ownerDb.noteVersion.findUniqueOrThrow({ where: { id: ids.version } });
    expect(version.organizationId).toBe(clubId);
    expect(JSON.stringify(version.contentJson)).toContain(clubLink);
    expect(
      (await ownerDb.noteComment.findUniqueOrThrow({ where: { id: ids.comment } })).organizationId,
    ).toBe(clubId);

    // The uploads: in the club, private to Maya, their bytes under the club's id.
    const after = await ownerDb.orgFile.findMany({
      where: { id: { in: [up.image, up.tripFile, up.loose] } },
      select: {
        id: true,
        organizationId: true,
        storageKey: true,
        visibility: true,
        folderId: true,
      },
    });
    const file = (id: string) => after.find((f) => f.id === id)!;
    for (const id of [up.image, up.tripFile]) {
      expect(file(id)).toMatchObject({ organizationId: clubId, visibility: "PRIVATE" });
      expect(file(id).storageKey.startsWith(`files/${clubId}/`)).toBe(true);
      expect(await getBlob(file(id).storageKey)).not.toBeNull();
      expect(await getBlob(files.find((f) => f.id === id)!.storageKey)).toBeNull();
    }
    expect(file(up.tripFile).folderId).toBe(ids.trips);
    expect(file(up.loose).organizationId).toBe(spaceId);
    const opened = await openNoteFile(clubId, up.image);
    expect(opened?.row.contentType).toBe("image/png");

    // Their bytes and the history count in the club now, not in Personal
    // (the version's size changed with its link: the ids differ in length).
    expect(version.sizeBytes).toBe(history + clubId.length - spaceId.length);
    expect(await storageUsed(clubId)).toBe(clubBefore + fileBytes + version.sizeBytes);
    expect(await storageUsed(spaceId)).toBe(spaceBefore - fileBytes - history);

    const b = await loadBringable(maya.id);
    expect(b!.notes).toEqual([]);
    expect(b!.folders.map((f) => f.name)).toEqual(["Docs"]);
    expect(b!.files.map((f) => f.id)).toEqual([up.loose]);
  });

  it("refuses uploads the organization has no room for, and moves nothing", async () => {
    if (!reachable) return;
    const size = (await ownerDb.orgFile.findUniqueOrThrow({ where: { id: up.loose } })).sizeBytes;
    // Fill the club to its last few bytes (the counter is the database's; the owner may set it).
    const { limitBytes } = (await import("@/lib/billing/storage")).storageState(
      await ownerDb.organization.findUniqueOrThrow({ where: { id: clubId } }),
    );
    const real = await storageUsed(clubId);
    await ownerDb.$executeRaw`UPDATE "Organization" SET "storageUsedBytes" = ${BigInt(limitBytes - size + 1)} WHERE "id" = ${clubId}`;
    try {
      const result = await movePersonalItems(maya.id, clubId, { fileIds: [up.loose] });
      expect(result).toMatchObject({ ok: false });
      expect((result as { error: string }).error).toContain("doesn't have room");
      expect(
        (await ownerDb.orgFile.findUniqueOrThrow({ where: { id: up.loose } })).organizationId,
      ).toBe(spaceId);
    } finally {
      await ownerDb.$executeRaw`UPDATE "Organization" SET "storageUsedBytes" = ${BigInt(real)} WHERE "id" = ${clubId}`;
    }
  });
});
