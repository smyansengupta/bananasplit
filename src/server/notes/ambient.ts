import type { TxClient } from "@/server/db/context";
import { readLinks } from "@/server/links/links";

/**
 * What the note and file ambient buttons read (src/lib/ambient/files.ts
 * decides). Every read is as the viewer, so RLS applies: the check-ins
 * their tier sees, their own visits, the links and tasks they can open.
 */

/** Members who went to a meeting: said yes, or checked in under their account. */
export async function meetingGoers(
  db: TxClient,
  organizationId: string,
  eventId: string,
): Promise<string[]> {
  const said = await db.eventAttendee.findMany({
    where: { organizationId, eventId, rsvp: "YES" },
    select: { userId: true },
  });
  const checkedIn = await db.attendance.findMany({
    where: { organizationId, eventId, suppressedAt: null, contact: { userId: { not: null } } },
    select: { contact: { select: { userId: true } } },
    take: 500,
  });
  const ids = [
    ...new Set([
      ...said.map((a) => a.userId),
      ...checkedIn.map((a) => a.contact.userId).filter((id): id is string => Boolean(id)),
    ]),
  ];
  if (ids.length === 0) return [];
  // Only people still in the organization.
  const members = await db.membership.findMany({
    where: { organizationId, userId: { in: ids } },
    select: { userId: true },
  });
  return members.map((m) => m.userId);
}

/** The titles of the tasks linked to a note (its to-dos turned into tasks show here). */
export async function linkedTaskTitles(
  db: TxClient,
  organizationId: string,
  noteId: string,
): Promise<string[]> {
  const ends = await readLinks(db, organizationId, [{ kind: "note", id: noteId }], {
    otherKinds: ["task"],
  });
  if (ends.length === 0) return [];
  const tasks = await db.task.findMany({
    where: { organizationId, id: { in: ends.map((e) => e.other.id) }, deletedAt: null },
    select: { title: true },
  });
  return tasks.map((t) => t.title);
}

/** When the viewer last opened a page before this visit (Recently visited). */
export async function lastVisitAt(
  db: TxClient,
  organizationId: string,
  userId: string,
  href: string,
): Promise<Date | null> {
  const row = await db.recentVisit.findUnique({
    where: { userId_organizationId_href: { userId, organizationId, href } },
    select: { visitedAt: true },
  });
  return row?.visitedAt ?? null;
}

/** How many things a file is linked from (meetings, tasks, notes...). */
export async function fileLinkCount(
  db: TxClient,
  organizationId: string,
  fileId: string,
): Promise<number> {
  return (await readLinks(db, organizationId, [{ kind: "file", id: fileId }])).length;
}

/** How many things each of these files is linked from, by file id. */
export async function fileLinkCounts(
  db: TxClient,
  organizationId: string,
  fileIds: readonly string[],
): Promise<Map<string, number>> {
  const ends = await readLinks(
    db,
    organizationId,
    fileIds.map((id) => ({ kind: "file" as const, id })),
  );
  const counts = new Map<string, number>();
  for (const e of ends) {
    const id = e.at.slice("file:".length);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}
