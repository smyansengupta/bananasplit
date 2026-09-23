// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Member management against the real roles, policies and triggers on the
 * local seeded database (0A Fix 3 plus the removal cleanup). Skipped when
 * the database or the seed is missing, like src/server/db/context.db.test.ts.
 *
 * It creates one throwaway member of the Claude Builders Club, links them to
 * an event, a notification and the open Graphic Designer position, removes
 * them, and checks that every tie is gone. Everything it creates is deleted
 * again in afterAll (deleting the user cascades).
 */

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock }));

import { ForbiddenError } from "@/lib/auth/errors";
import { feedEventsWhere } from "@/lib/calendar-feed";
import { authDb, disconnectAll, legacyDb } from "@/server/db/clients";
import { withOrgAction, withSystemOrgTx } from "@/server/db/context";

import { changeMemberRole, removeMember } from "./actions";

interface SeedUser {
  id: string;
  email: string;
  name: string | null;
}
interface Seeded {
  cbcId: string;
  jackson: SeedUser;
  oliver: SeedUser;
  kristine: SeedUser;
  eventId: string;
  position: { id: string; userId: string | null; matchState: string; matchScore: number | null };
}

let seeded: Seeded | null = null;
try {
  const cbc = await legacyDb.organization.findUnique({
    where: { slug: "claude-builders-club" },
    select: { id: true },
  });
  const users = await authDb.user.findMany({
    where: { email: { in: ["jackson@example.edu", "oliver@example.edu", "kristine@example.edu"] } },
    select: { id: true, email: true, name: true },
  });
  const byEmail = new Map(users.map((u) => [u.email, u]));
  const event = cbc
    ? await legacyDb.event.findFirst({
        where: { organizationId: cbc.id, deletedAt: null },
        select: { id: true },
      })
    : null;
  const position = cbc
    ? await withSystemOrgTx(cbc.id, ({ db }) =>
        db.orgChartPosition.findFirst({
          where: { organizationId: cbc.id, isOpen: true, version: { status: "PUBLISHED" } },
          select: { id: true, userId: true, matchState: true, matchScore: true },
        }),
      )
    : null;
  const jackson = byEmail.get("jackson@example.edu");
  const oliver = byEmail.get("oliver@example.edu");
  const kristine = byEmail.get("kristine@example.edu");
  if (cbc && event && position && jackson && oliver && kristine) {
    seeded = { cbcId: cbc.id, jackson, oliver, kristine, eventId: event.id, position };
  }
} catch {
  seeded = null;
}

describe.skipIf(!seeded)("member management against the local database", () => {
  const s = seeded as Seeded;
  let temp: SeedUser;

  beforeAll(async () => {
    const email = `a2-remove-${Date.now()}@example.edu`;
    temp = await authDb.user.create({
      data: { email, name: "Temp Member", emailVerified: new Date() },
      select: { id: true, email: true, name: true },
    });
    // Membership rows are only ever created on the service path, by the
    // joining user (D6).
    await withSystemOrgTx(s.cbcId, { userId: temp.id }, async ({ db }) => {
      await db.membership.create({
        data: { organizationId: s.cbcId, userId: temp.id, role: "MEMBER" },
      });
    });
    await withSystemOrgTx(s.cbcId, async ({ db }) => {
      await db.eventAttendee.create({
        data: { organizationId: s.cbcId, eventId: s.eventId, userId: temp.id },
      });
      await db.notification.createMany({
        data: [
          {
            organizationId: s.cbcId,
            userId: temp.id,
            type: "EVENT_INVITE",
            title: "You were invited",
          },
        ],
      });
      await db.orgChartPosition.update({
        where: { id: s.position.id },
        data: { userId: temp.id, matchState: "CONFIRMED", matchScore: 1 },
      });
    });
  });

  beforeEach(() => {
    requireUserMock.mockResolvedValue(s.oliver);
  });

  afterAll(async () => {
    await withSystemOrgTx(s.cbcId, async ({ db }) => {
      await db.orgChartPosition.update({
        where: { id: s.position.id },
        data: {
          userId: s.position.userId,
          matchState: s.position.matchState as "UNMATCHED",
          matchScore: s.position.matchScore,
        },
      });
    });
    await authDb.user.deleteMany({ where: { id: temp.id } });
    await disconnectAll();
  });

  async function roleOf(userId: string) {
    const m = await legacyDb.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId: s.cbcId } },
      select: { role: true },
    });
    return m?.role ?? null;
  }

  it("an ADMIN cannot grant OWNER", async () => {
    const result = await changeMemberRole(s.cbcId, temp.id, "OWNER");
    expect(result.error).toMatch(/only an owner/i);
    expect(await roleOf(temp.id)).toBe("MEMBER");
  });

  it("an ADMIN cannot demote an OWNER", async () => {
    const result = await changeMemberRole(s.cbcId, s.jackson.id, "MEMBER");
    expect(result.error).toMatch(/only an owner/i);
    expect(await roleOf(s.jackson.id)).toBe("OWNER");
  });

  it("the database refuses the same grant even without the app check", async () => {
    const grant = withOrgAction(async ({ db, organizationId }) =>
      db.membership.update({
        where: { userId_organizationId: { userId: temp.id, organizationId } },
        data: { role: "OWNER" },
      }),
    );
    await expect(grant(s.cbcId)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await roleOf(temp.id)).toBe("MEMBER");
  });

  it("an OWNER cannot change their own role", async () => {
    requireUserMock.mockResolvedValue(s.jackson);
    const result = await changeMemberRole(s.cbcId, s.jackson.id, "ADMIN");
    expect(result.error).toMatch(/your own role/i);
    expect(await roleOf(s.jackson.id)).toBe("OWNER");
  });

  it("an ADMIN can change a member's role between non-owner roles", async () => {
    expect(await changeMemberRole(s.cbcId, temp.id, "TREASURER")).toEqual({});
    expect(await roleOf(temp.id)).toBe("TREASURER");
    expect(await changeMemberRole(s.cbcId, temp.id, "MEMBER")).toEqual({});
  });

  it("removal deletes the membership, event invitations and notifications, and frees the position", async () => {
    expect(await legacyDb.event.count({ where: feedEventsWhere(temp.id) })).toBe(1);

    const result = await removeMember(s.cbcId, temp.id);
    expect(result).toEqual({});

    expect(await roleOf(temp.id)).toBeNull();
    const attendee = await legacyDb.eventAttendee.count({
      where: { organizationId: s.cbcId, userId: temp.id },
    });
    const notifications = await legacyDb.notification.count({
      where: { organizationId: s.cbcId, userId: temp.id },
    });
    const position = await withSystemOrgTx(s.cbcId, ({ db }) =>
      db.orgChartPosition.findUniqueOrThrow({
        where: { id: s.position.id },
        select: { userId: true, matchState: true },
      }),
    );
    expect(attendee).toBe(0);
    expect(notifications).toBe(0);
    expect(position).toEqual({ userId: null, matchState: "UNMATCHED" });
    // A removed member is absent from their ICS feed (0A Fix 7).
    expect(await legacyDb.event.count({ where: feedEventsWhere(temp.id) })).toBe(0);
  });

  it("the feed drops an org's events once membership is gone, even if an invitation row survived", async () => {
    const other = await authDb.user.create({
      data: {
        email: `a2-feed-${Date.now()}@example.edu`,
        name: "Feed Member",
        emailVerified: new Date(),
      },
      select: { id: true },
    });
    try {
      await withSystemOrgTx(s.cbcId, { userId: other.id }, async ({ db }) => {
        await db.membership.create({
          data: { organizationId: s.cbcId, userId: other.id, role: "MEMBER" },
        });
      });
      await withSystemOrgTx(s.cbcId, async ({ db }) => {
        await db.eventAttendee.create({
          data: { organizationId: s.cbcId, eventId: s.eventId, userId: other.id },
        });
      });
      expect(await legacyDb.event.count({ where: feedEventsWhere(other.id) })).toBe(1);

      // Remove the membership WITHOUT the removeMember cleanup.
      await withSystemOrgTx(s.cbcId, async ({ db }) => {
        await db.membership.delete({
          where: { userId_organizationId: { userId: other.id, organizationId: s.cbcId } },
        });
      });
      expect(
        await legacyDb.eventAttendee.count({ where: { userId: other.id, eventId: s.eventId } }),
      ).toBe(1);
      expect(await legacyDb.event.count({ where: feedEventsWhere(other.id) })).toBe(0);
    } finally {
      await authDb.user.deleteMany({ where: { id: other.id } });
    }
  });
});
