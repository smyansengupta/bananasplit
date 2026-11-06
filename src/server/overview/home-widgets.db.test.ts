// @vitest-environment node
// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { afterAll, describe, expect, it, vi } from "vitest";

/**
 * Home's recap and waiting widgets against the local database, as members
 * (app_user, RLS): markHomeVisit moves the last visit to the previous one
 * only after half an hour, and every loader runs its queries (JSON paths,
 * relation filters, the ballot tally) for an owner and for a plain member
 * without a refusal. Only the members' own MemberPrefs rows are touched,
 * and they're put back. Skipped without the database or the seeded club.
 */

vi.mock("@/lib/auth/session", () => ({ requireUser: vi.fn() }));

import type { Role } from "@/generated/prisma/enums";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { disconnectAll } from "../db/clients";
import { withOrgTxAs } from "../db/context";
import { loadDeadlines } from "./deadlines";
import { readHomeShared } from "./home-widgets";
import { loadRecapWeek } from "./recap-week";
import { loadSinceYouWereHere, markHomeVisit } from "./since-you-were-here";
import { loadVotes } from "./votes";
import { loadWaitingOnOthers } from "./waiting-on-others";
import { loadWaitingOnYou } from "./waiting-on-you";

type Member = { userId: string; role: Role };
let seeded: { orgId: string; slug: string; timezone: string; members: Member[] } | null = null;
try {
  const org = await ownerDb.organization.findUnique({
    where: { slug: "claude-builders-club" },
    select: {
      id: true,
      slug: true,
      timezone: true,
      memberships: { select: { userId: true, role: true }, take: 50 },
    },
  });
  // The visit columns arrive with 20261102100000_home_widgets; an older database skips.
  await ownerDb.memberPrefs.findFirst({ select: { homeVisitAt: true } });
  const owner = org?.memberships.find((m) => m.role === "OWNER");
  const member = org?.memberships.find((m) => m.role === "MEMBER");
  if (org && owner && member) {
    seeded = { orgId: org.id, slug: org.slug, timezone: org.timezone, members: [owner, member] };
  }
} catch {
  seeded = null;
}

describe.skipIf(!seeded)("Home's recap and waiting widgets (local database)", () => {
  const s = seeded!;
  const saved = new Map<
    string,
    { homeVisitAt: Date | null; homePrevVisitAt: Date | null } | null
  >();

  afterAll(async () => {
    for (const [userId, before] of saved) {
      const where = { organizationId_userId: { organizationId: s.orgId, userId } };
      if (before) await ownerDb.memberPrefs.update({ where, data: before });
      else await ownerDb.memberPrefs.deleteMany({ where: { organizationId: s.orgId, userId } });
    }
    await disconnectAll();
    await disconnectOwnerDb();
  });

  it("moves the last visit to the previous one only after half an hour", async () => {
    const { userId } = s.members[1]!;
    saved.set(
      userId,
      await ownerDb.memberPrefs.findUnique({
        where: { organizationId_userId: { organizationId: s.orgId, userId } },
        select: { homeVisitAt: true, homePrevVisitAt: true },
      }),
    );
    const t0 = new Date("2026-11-01T12:00:00Z");
    const later = (min: number) => new Date(t0.getTime() + min * 60_000);
    const visit = (at: Date) =>
      withOrgTxAs(userId, s.orgId, ({ db }) => markHomeVisit(db, s.orgId, userId, at));

    await ownerDb.memberPrefs.upsert({
      where: { organizationId_userId: { organizationId: s.orgId, userId } },
      create: { organizationId: s.orgId, userId, homeVisitAt: null, homePrevVisitAt: null },
      update: { homeVisitAt: null, homePrevVisitAt: null },
    });
    expect(await visit(t0)).toBeNull();
    expect(await visit(later(10))).toBeNull();
    expect((await visit(later(50)))?.toISOString()).toBe(later(10).toISOString());
    const row = await ownerDb.memberPrefs.findUnique({
      where: { organizationId_userId: { organizationId: s.orgId, userId } },
      select: { homeVisitAt: true, homePrevVisitAt: true },
    });
    expect(row?.homeVisitAt?.toISOString()).toBe(later(50).toISOString());
  });

  it("loads every widget for an owner and for a member", async () => {
    const now = new Date();
    for (const m of s.members) {
      const input = {
        orgId: s.orgId,
        orgSlug: s.slug,
        userId: m.userId,
        role: m.role,
        timeZone: s.timezone,
        orgTimeZone: s.timezone,
        now,
      };
      const out = await withOrgTxAs(m.userId, s.orgId, async ({ db }) => {
        // The page's shared reads (open forms, elections, member polls, turnout).
        const shared = await readHomeShared(db, {
          orgId: s.orgId,
          userId: m.userId,
          now,
          memberCount: 10,
          myDue: [],
        });
        return {
          recap: await loadRecapWeek(db, input),
          since: await loadSinceYouWereHere(db, {
            ...input,
            since: new Date(now.getTime() - 30 * 86_400_000),
          }),
          you: await loadWaitingOnYou(db, input),
          others: await loadWaitingOnOthers(db, input),
          deadlines: loadDeadlines({
            ...input,
            shared,
            voters: new Map([...shared.pollStats].map(([id, p]) => [id, p.voters])),
            budgetPeriod: null,
          }),
          votes: await loadVotes(db, {
            ...input,
            shared,
            stats: shared.pollStats,
            ballotVisibility: null,
          }),
        };
      });
      expect(out.votes.total).toBeGreaterThanOrEqual(out.votes.cards.length);
      expect(out.recap.range).toMatch(/ to /);
      expect(out.since.sinceLabel).not.toBeNull();
      expect(Array.isArray(out.you.rows)).toBe(true);
      expect(Array.isArray(out.others.rows)).toBe(true);
      expect(out.deadlines.total).toBeGreaterThanOrEqual(out.deadlines.rows.length);
      expect(Array.isArray(out.votes.cards)).toBe(true);
      // Plain data only: the page hands these to client components.
      expect(() => JSON.stringify(out)).not.toThrow();
      if (m.role === "MEMBER") {
        expect(out.recap.stats.some((x) => x.key === "spent")).toBe(false);
        expect(out.you.rows.some((r) => r.kind === "request")).toBe(false);
      }
    }
  });
});
