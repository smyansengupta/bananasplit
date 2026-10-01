import { describePath, type PinKind } from "@/lib/pins/pages";
import type { TxClient } from "@/server/db/context";

/**
 * "Pin something": everything a member can pin, searchable. Each read runs
 * as the member (RLS), so the list only holds what they can open: private
 * notes and tasks of others never show. With no query, the most useful few
 * of each kind (recent notes, upcoming events, every folder...).
 */

export interface Pinnable {
  href: string;
  label: string;
  kind: PinKind;
  /** A second line: where it lives, or when. */
  detail?: string;
}

export interface PinnableGroup {
  id: string;
  label: string;
  items: Pinnable[];
}

/** Pages and views anyone can pin, by path under /app/{slug}. */
const PAGES = [
  "/tasks",
  "/tasks?view=week&scope=mine",
  "/tasks?view=board",
  "/tasks?view=table",
  "/tasks?view=calendar",
  "/tasks?view=team",
  "/tasks?view=updates",
  "/tasks?view=intake",
  "/calendar",
  "/calendar/polls",
  "/notes",
  "/notes?tab=files",
  "/people",
  "/org-chart",
  "/databases",
  "/databases/reports",
  "/finance",
  "/finance/transactions",
  "/finance/budget",
  "/finance/my-reimbursements",
  "/finance/sponsorships",
  "/profile",
  "/settings",
  "/settings/members",
  "/settings/notifications",
];

const PER_KIND = 6;

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

export async function searchPinnables(
  db: TxClient,
  orgId: string,
  orgSlug: string,
  userId: string,
  rawQuery: string,
): Promise<PinnableGroup[]> {
  const q = rawQuery.replace(/\s+/g, " ").trim().slice(0, 80);
  const has = (text: string) => !q || text.toLowerCase().includes(q.toLowerCase());
  const contains = q ? { contains: q, mode: "insensitive" as const } : undefined;
  const base = `/app/${orgSlug}`;
  const groups: PinnableGroup[] = [];

  const pages = PAGES.map((p) => describePath(orgSlug, `${base}${p}`))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .filter((p) => has(p.label))
    .map((p) => ({ href: p.href, label: p.label, kind: p.kind }));
  groups.push({ id: "pages", label: "Pages and views", items: q ? pages.slice(0, 10) : pages });

  const folders = await db.noteFolder.findMany({
    where: { organizationId: orgId, ...(contains ? { name: contains } : {}) },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true },
    take: 20,
  });
  groups.push({
    id: "folders",
    label: "Folders",
    items: folders.map((f) => ({ href: `${base}/notes?folder=${f.id}`, label: f.name, kind: "folder" as const, detail: "Notes folder" })),
  });

  const notes = await db.note.findMany({
    where: {
      organizationId: orgId,
      deletedAt: null,
      OR: [{ visibility: "ORGANIZATION" }, { authorId: userId }],
      ...(contains ? { AND: [{ OR: [{ title: contains }, { contentText: contains }] }] } : {}),
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, folder: { select: { name: true } } },
    take: PER_KIND,
  });
  groups.push({
    id: "notes",
    label: "Notes",
    items: notes.map((n) => ({
      href: `${base}/notes/${n.id}`,
      label: n.title || "Untitled note",
      kind: "note" as const,
      detail: n.folder?.name,
    })),
  });

  const files = await db.orgFile.findMany({
    where: { organizationId: orgId, deletedAt: null, ...(contains ? { name: contains } : {}) },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, folder: { select: { name: true } } },
    take: PER_KIND,
  });
  groups.push({
    id: "files",
    label: "Files",
    items: files.map((f) => ({ href: `${base}/notes/files/${f.id}`, label: f.name, kind: "file" as const, detail: f.folder?.name })),
  });

  const tasks = await db.task.findMany({
    where: {
      organizationId: orgId,
      deletedAt: null,
      ...(contains ? { title: contains } : { status: { not: "COMPLETED" } }),
    },
    orderBy: q ? { updatedAt: "desc" } : [{ dueDate: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }],
    select: { id: true, title: true, dueDate: true },
    take: PER_KIND,
  });
  groups.push({
    id: "tasks",
    label: "Tasks",
    items: tasks.map((t) => ({
      href: `${base}/tasks/${t.id}`,
      label: t.title,
      kind: "task" as const,
      detail: t.dueDate ? `Due ${dateFmt.format(t.dueDate)}` : undefined,
    })),
  });

  const now = new Date();
  const events = await db.event.findMany({
    where: {
      organizationId: orgId,
      deletedAt: null,
      mergedIntoId: null,
      ...(contains ? { title: contains } : { endsAt: { gt: now } }),
    },
    orderBy: { startsAt: q ? "desc" : "asc" },
    select: { id: true, title: true, startsAt: true },
    take: PER_KIND,
  });
  groups.push({
    id: "events",
    label: "Events",
    items: events.map((e) => ({ href: `${base}/calendar/${e.id}`, label: e.title, kind: "event" as const, detail: dateFmt.format(e.startsAt) })),
  });

  const polls = await db.availabilityPoll.findMany({
    where: { organizationId: orgId, ...(contains ? { title: contains } : { finalizedEventId: null }) },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true },
    take: 4,
  });
  groups.push({
    id: "polls",
    label: "Polls",
    items: polls.map((p) => ({ href: `${base}/calendar/polls/${p.id}`, label: p.title, kind: "event" as const, detail: "Poll" })),
  });

  const databases = await db.databaseDefinition.findMany({
    where: { organizationId: orgId, archivedAt: null, ...(contains ? { name: contains } : {}) },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { key: true, name: true },
    take: 10,
  });
  groups.push({
    id: "databases",
    label: "Databases",
    items: databases.map((d) => ({ href: `${base}/databases/${d.key}`, label: d.name, kind: "database" as const })),
  });

  const people = await db.membership.findMany({
    where: { organizationId: orgId, ...(contains ? { user: { name: contains } } : {}) },
    orderBy: { joinedAt: "desc" },
    select: { userId: true, title: true, user: { select: { name: true } } },
    take: PER_KIND,
  });
  groups.push({
    id: "people",
    label: "People",
    items: people.map((m) => ({
      href: `${base}/people/${m.userId}`,
      label: m.user.name ?? "Member",
      kind: "person" as const,
      detail: m.title ?? undefined,
    })),
  });

  return groups.filter((g) => g.items.length > 0);
}
