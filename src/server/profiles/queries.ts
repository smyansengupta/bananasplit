import { cache } from "react";

import type { Prisma, Role } from "@/generated/prisma/client";
import { parseStoredLinks, type ProfileLink } from "@/lib/profile/links";
import { withOrgTx, withUserTx } from "@/server/db/context";
import { userPublicSelect, type UserPublic } from "@/server/members";

/**
 * Profile reads (Phase 2).
 *
 * Visibility: a user's profile (pronouns, major, year, bio, links) is seen
 * by the user and by current members of an org they belong to, on that
 * org's people pages. The database already limits User rows to self and
 * current or former co-members (0B RLS); the people queries go through
 * Membership, so a FORMER member (still readable for old task authors) is
 * not listed and has no person page. Email is never part of these shapes.
 */

/** What co-members see on the people pages: the public shape plus the profile. */
export const userProfileSelect = {
  ...userPublicSelect,
  pronouns: true,
  major: true,
  gradYear: true,
  bio: true,
  links: true,
} satisfies Prisma.UserSelect;

export const PEOPLE_PAGE_SIZE = 50;

// ---------------------------------------------------------------- the shell

export interface ShellUserRecord {
  name: string | null;
  email: string;
  image: string | null;
  avatar: Prisma.JsonValue | null;
}

/**
 * The signed-in user as the shell shows them, read from the database on
 * every request (not from the JWT), so a name or picture change shows at
 * once without signing in again. Deduped per request.
 */
export const getShellUser = cache(async (userId: string, fallbackEmail: string): Promise<ShellUserRecord> => {
  const row = await withUserTx(userId, ({ db }) =>
    db.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true, image: true, avatar: true },
    }),
  );
  return row ?? { name: null, email: fallbackEmail, image: null, avatar: null };
});

// ---------------------------------------------------------------- own profile

export interface OwnMembership {
  organizationId: string;
  orgName: string;
  orgSlug: string;
  role: Role;
  title: string | null;
}

export interface OwnProfile {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  avatar: Prisma.JsonValue | null;
  pronouns: string | null;
  major: string | null;
  gradYear: number | null;
  bio: string | null;
  links: ProfileLink[];
  timezone: string | null;
  emailPreferences: Prisma.JsonValue;
  memberships: OwnMembership[];
  /** When the current calendar feed link was created, or null. */
  icsActiveSince: Date | null;
}

/** The signed-in user's own profile, every org title, and the feed status. */
export async function getOwnProfile(userId: string): Promise<OwnProfile | null> {
  return withUserTx(userId, async ({ db }) => {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        avatar: true,
        pronouns: true,
        major: true,
        gradYear: true,
        bio: true,
        links: true,
        timezone: true,
        emailPreferences: true,
      },
    });
    if (!user) return null;
    const memberships = await db.membership.findMany({
      where: { userId },
      select: {
        role: true,
        title: true,
        organization: { select: { id: true, name: true, slug: true, deletedAt: true } },
      },
      orderBy: { organization: { name: "asc" } },
    });
    const rows = await db.$queryRaw<{ t: Date | null }[]>`SELECT app.ics_token_created_at() AS t`;
    return {
      ...user,
      links: parseStoredLinks(user.links),
      memberships: memberships
        .filter((m) => m.organization.deletedAt === null)
        .map((m) => ({
          organizationId: m.organization.id,
          orgName: m.organization.name,
          orgSlug: m.organization.slug,
          role: m.role,
          title: m.title,
        })),
      icsActiveSince: rows[0]?.t ?? null,
    };
  });
}

// ---------------------------------------------------------------- people

export interface PersonSummary extends UserPublic {
  pronouns: string | null;
  major: string | null;
  gradYear: number | null;
  role: Role;
  /** This org's title for the person. */
  title: string | null;
}

export interface PeoplePage {
  people: PersonSummary[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
}

/** Normalizes a ?page= value to 1..n. */
export function parsePageParam(value: unknown): number {
  const n = typeof value === "string" ? Number.parseInt(value, 10) : NaN;
  return Number.isFinite(n) && n >= 1 && n <= 100_000 ? n : 1;
}

/** Normalizes a ?q= value (trimmed, at most 80 characters). */
export function parseSearchParam(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 80) : "";
}

/**
 * The people directory of `organizationId`, 50 per page, by name, for the
 * session user (withOrgTx refuses a non-member). `q` matches name, this
 * org's title or major.
 */
export async function listOrgPeople(
  organizationId: string,
  options: { page?: number; q?: string } = {},
): Promise<PeoplePage> {
  const q = options.q?.trim() ?? "";
  const where: Prisma.MembershipWhereInput = {
    organizationId,
    ...(q
      ? {
          OR: [
            { user: { name: { contains: q, mode: "insensitive" } } },
            { title: { contains: q, mode: "insensitive" } },
            { user: { major: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  return withOrgTx(organizationId, async ({ db }) => {
    const total = await db.membership.count({ where });
    const pageCount = Math.max(1, Math.ceil(total / PEOPLE_PAGE_SIZE));
    const page = Math.min(Math.max(1, options.page ?? 1), pageCount);
    const rows = await db.membership.findMany({
      where,
      orderBy: [{ user: { name: { sort: "asc", nulls: "last" } } }, { userId: "asc" }],
      skip: (page - 1) * PEOPLE_PAGE_SIZE,
      take: PEOPLE_PAGE_SIZE,
      select: {
        role: true,
        title: true,
        user: {
          select: { ...userPublicSelect, pronouns: true, major: true, gradYear: true },
        },
      },
    });
    return {
      people: rows.map((m) => ({ ...m.user, role: m.role, title: m.title })),
      total,
      page,
      pageCount,
      pageSize: PEOPLE_PAGE_SIZE,
    };
  });
}

export interface PersonProfile extends PersonSummary {
  bio: string | null;
  links: ProfileLink[];
  joinedAt: Date;
}

/**
 * One CURRENT member of `organizationId`, or null when `userId` is not a
 * member of it (another org's user, a former member, or no such user). The
 * page turns null into notFound(), so a person page never confirms that a
 * user exists outside the org.
 */
export async function getOrgPerson(organizationId: string, userId: string): Promise<PersonProfile | null> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(userId)) return null;
  return withOrgTx(organizationId, async ({ db }) => {
    const membership = await db.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      select: { role: true, title: true, joinedAt: true, user: { select: userProfileSelect } },
    });
    if (!membership) return null;
    const { user } = membership;
    return {
      ...user,
      links: parseStoredLinks(user.links),
      role: membership.role,
      title: membership.title,
      joinedAt: membership.joinedAt,
    };
  });
}
