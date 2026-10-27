import type { TxClient } from "@/server/db/context";
import {
  cleanTagName,
  MAX_TAGS_PER_ORG,
  STARTER_TAGS,
  type EventTagOption,
} from "@/lib/calendar/tags";

/**
 * An organization's own event types (EventTag). RLS scopes every read and
 * write to the caller's org; writing is owners and admins, which the
 * policies enforce as well as the actions.
 */

export const eventTagSelect = {
  id: true,
  name: true,
  color: true,
} as const;

/** The org's types, in the order it put them in. */
export function listEventTags(db: TxClient, orgId: string): Promise<EventTagOption[]> {
  return db.eventTag.findMany({
    where: { organizationId: orgId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: eventTagSelect,
  });
}

/**
 * The types a brand new organization starts with — four words that mean
 * something to any of them, and that are meant to be rewritten. Existing
 * orgs got the same set in the migration, beside whatever their own events
 * were already using.
 */
export async function seedEventTags(db: TxClient, orgId: string): Promise<void> {
  const already = await db.eventTag.count({ where: { organizationId: orgId } });
  if (already > 0) return;
  await db.eventTag.createMany({
    data: STARTER_TAGS.map((t, i) => ({
      organizationId: orgId,
      name: t.name,
      color: t.color,
      sortOrder: i,
    })),
  });
}

/** Whether the org has room for another type. */
export async function canAddEventTag(db: TxClient, orgId: string): Promise<boolean> {
  return (await db.eventTag.count({ where: { organizationId: orgId } })) < MAX_TAGS_PER_ORG;
}

/**
 * The org's tag with this name, made if it has none. For the places that
 * declare a type by name rather than by id — the bootstrap template, the
 * reports fixture, an import that guessed one from a title.
 */
export async function ensureEventTag(
  db: TxClient,
  orgId: string,
  name: string,
  color?: string | null,
): Promise<string> {
  const clean = cleanTagName(name);
  if (!clean) throw new Error("An event type needs a name");
  const existing = await db.eventTag.findFirst({
    where: { organizationId: orgId, name: { equals: clean, mode: "insensitive" } },
    select: { id: true },
  });
  if (existing) return existing.id;
  const count = await db.eventTag.count({ where: { organizationId: orgId } });
  const made = await db.eventTag.create({
    data: {
      organizationId: orgId,
      name: clean,
      color: color ?? null,
      sortOrder: count,
    },
    select: { id: true },
  });
  return made.id;
}

/**
 * The org's tag whose name matches, or null. For an import that can only
 * guess from a title: it never invents a type the org has not asked for.
 */
export async function matchEventTag(
  db: TxClient,
  orgId: string,
  name: string | null | undefined,
): Promise<string | null> {
  const clean = cleanTagName(name ?? "");
  if (!clean) return null;
  const hit = await db.eventTag.findFirst({
    where: { organizationId: orgId, name: { equals: clean, mode: "insensitive" } },
    select: { id: true },
  });
  return hit?.id ?? null;
}
