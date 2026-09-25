// @vitest-environment node
// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Databases section against the real roles, policies and rollup
 * functions on the local database (DATABASE_URL_* in .env) with the seeded
 * Claude Builders Club: the privacy tiers, the synced-row rules, the
 * maintained stamp columns, ballot tallies, event and contact merges, and
 * the website sync's write side. Skipped when the database or the seed is
 * not there (CI's unit job has no database).
 */

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock, getSession: vi.fn() }));

import { AttendanceMethod, RecordSource, type Role } from "@/generated/prisma/client";
import { ForbiddenError } from "@/lib/auth/errors";
import { authDb, disconnectAll } from "@/server/db/clients";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";
import { withOrgAction, withOrgTx, withSystemOrgTx, type OrgContext } from "@/server/db/context";
import { mergeEvents } from "@/server/events/service";
import {
  applyBallots,
  applyCheckins,
  applySessions,
  applySignups,
  applyUnsubscribes,
  removeMissing,
  type SyncScope,
} from "@/server/sync/apply";
import { advanceWatermark, ensureStates, StaleWatermarkError } from "@/server/sync/state";

import { setAttendanceSuppressed, deleteAttendance } from "./admin";
import { loadPollResults, listPolls } from "./ballot-results";
import { mergeContacts } from "./contacts";
import { refreshRollups } from "./rollups";
import { canViewBallotRows, canViewKind } from "./views";

interface Person {
  id: string;
  email: string;
}
interface Seeded {
  orgId: string;
  owner: Person;
  admin: Person;
  member: Person;
  treasurer: Person;
  pastEventIds: string[];
}

let seeded: Seeded | null = null;
try {
  const org = await ownerDb.organization.findUnique({
    where: { slug: "claude-builders-club" },
    select: { id: true },
  });
  const users = await authDb.user.findMany({
    where: {
      email: {
        in: [
          "jackson@example.edu",
          "oliver@example.edu",
          "kristine@example.edu",
          "anthony@example.edu",
        ],
      },
    },
    select: { id: true, email: true },
  });
  const by = (email: string) => users.find((u) => u.email === email);
  const events = org
    ? await ownerDb.event.findMany({
        where: {
          organizationId: org.id,
          deletedAt: null,
          mergedIntoId: null,
          startsAt: { lt: new Date() },
        },
        orderBy: { startsAt: "desc" },
        select: { id: true },
        take: 3,
      })
    : [];
  if (
    org &&
    by("jackson@example.edu") &&
    by("oliver@example.edu") &&
    by("kristine@example.edu") &&
    by("anthony@example.edu") &&
    events.length >= 2
  ) {
    seeded = {
      orgId: org.id,
      owner: by("jackson@example.edu")!,
      admin: by("oliver@example.edu")!,
      member: by("kristine@example.edu")!,
      treasurer: by("anthony@example.edu")!,
      pastEventIds: events.map((e) => e.id),
    };
  }
} catch {
  seeded = null;
}

const TAG = `dbtest_${Date.now().toString(36)}`;
/** The website ids this run pretends to read: unique, so a failed run leaves nothing behind. */
const RUN = randomUUID().slice(0, 8);
const uuid = (n: number) => `${RUN}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const created = {
  contacts: new Set<string>(),
  events: new Set<string>(),
  integrations: new Set<string>(),
};
/** Integrations whose sync-state rows this run created (the integration itself may predate it). */
const syncStates = new Set<string>();

function id(suffix: string): string {
  return `${TAG}_${suffix}`;
}

describe.skipIf(!seeded)("Databases against the local database (seeded CBC)", () => {
  const s = seeded as Seeded;
  const as = (p: Person) =>
    requireUserMock.mockResolvedValue({ id: p.id, email: p.email, name: null });

  beforeEach(() => {
    as(s.owner);
  });

  afterAll(async () => {
    await withSystemOrgTx(s.orgId, async ({ db }) => {
      await db.attendance.deleteMany({
        where: { organizationId: s.orgId, externalId: { startsWith: RUN } },
      });
      await db.signup.deleteMany({
        where: { organizationId: s.orgId, externalId: { startsWith: RUN } },
      });
      await db.ballot.deleteMany({
        where: { organizationId: s.orgId, externalId: { startsWith: RUN } },
      });
      const synced = await db.event.findMany({
        where: { organizationId: s.orgId, sourceSessionId: { startsWith: RUN } },
        select: { id: true },
      });
      for (const e of synced) created.events.add(e.id);
      await db.attendance.deleteMany({
        where: { organizationId: s.orgId, eventId: { in: [...created.events] } },
      });
      await db.attendance.deleteMany({
        where: { organizationId: s.orgId, contactId: { in: [...created.contacts] } },
      });
      await db.attendance.deleteMany({
        where: { organizationId: s.orgId, eventId: { in: [...created.events] } },
      });
      await db.ballotChoice.deleteMany({
        where: { organizationId: s.orgId, ballot: { externalId: { startsWith: TAG } } },
      });
      await db.ballot.deleteMany({
        where: { organizationId: s.orgId, externalId: { startsWith: TAG } },
      });
      await db.ballotDefinition.deleteMany({
        where: { organizationId: s.orgId, slug: { startsWith: TAG } },
      });
      await db.signup.deleteMany({
        where: { organizationId: s.orgId, contactId: { in: [...created.contacts] } },
      });
      await db.contactTermStats.deleteMany({
        where: { organizationId: s.orgId, contactId: { in: [...created.contacts] } },
      });
      await db.contactEmail.deleteMany({
        where: { organizationId: s.orgId, contactId: { in: [...created.contacts] } },
      });
      await db.contact.deleteMany({
        where: { organizationId: s.orgId, id: { in: [...created.contacts] } },
      });
      // EventLinkLog is append-only for every runtime role; it cascades with its Event.
      await db.event.deleteMany({
        where: { organizationId: s.orgId, id: { in: [...created.events] } },
      });
      await db.dataSourceSyncState.deleteMany({
        where: {
          organizationId: s.orgId,
          integrationId: { in: [...created.integrations, ...syncStates] },
        },
      });
      await db.orgIntegration.deleteMany({
        where: { organizationId: s.orgId, id: { in: [...created.integrations] } },
      });
      await db.$queryRaw`SELECT app.refresh_contact_rollups(${s.orgId}, NULL)::text AS ok`;
    });
    await disconnectAll();
    await disconnectOwnerDb();
  });

  // ---- Privacy tiers -----------------------------------------------------------

  describe("PII visibility per tier (RLS with the tier as an explicit argument)", () => {
    const counts = () =>
      withOrgTx(s.orgId, async ({ db, role }) => ({
        role,
        attendance: await db.attendance.count(),
        contacts: await db.contact.count(),
        emails: await db.contactEmail.count(),
        signups: await db.signup.count(),
        ballots: await db.ballot.count(),
        choices: await db.ballotChoice.count(),
        termStats: await db.contactTermStats.count(),
      }));

    it("an owner sees every table", async () => {
      as(s.owner);
      const c = await counts();
      expect(c.role).toBe("OWNER");
      for (const key of [
        "attendance",
        "contacts",
        "emails",
        "signups",
        "ballots",
        "choices",
      ] as const) {
        expect(c[key], key).toBeGreaterThan(0);
      }
    });

    it("an admin sees signups and emails but not individual ballots (OWNER_ONLY by default)", async () => {
      as(s.admin);
      const c = await counts();
      expect(c.role).toBe("ADMIN");
      expect(c.signups).toBeGreaterThan(0);
      expect(c.emails).toBeGreaterThan(0);
      expect(c.ballots).toBe(0);
      expect(c.choices).toBe(0);
    });

    it("a member sees attendance and people but no signups, emails or ballots", async () => {
      as(s.member);
      const c = await counts();
      expect(c.role).toBe("MEMBER");
      expect(c.attendance).toBeGreaterThan(0);
      expect(c.termStats).toBeGreaterThan(0);
      expect(c.signups).toBe(0);
      expect(c.emails).toBe(0);
      expect(c.ballots).toBe(0);
    });

    it("a treasurer reads as a member", async () => {
      as(s.treasurer);
      const c = await counts();
      expect(c.role).toBe("TREASURER");
      expect(c.signups).toBe(0);
      expect(c.emails).toBe(0);
      expect(c.ballots).toBe(0);
      expect(c.attendance).toBeGreaterThan(0);
    });

    it("app.can_view_rows and can_view_ballot_rows agree with the policies", async () => {
      as(s.owner);
      const answers = await withOrgTx(s.orgId, async ({ db }) => ({
        memberSignups: await canViewKind(db, s.orgId, "SIGNUPS", "MEMBER"),
        adminSignups: await canViewKind(db, s.orgId, "SIGNUPS", "ADMIN"),
        memberAttendance: await canViewKind(db, s.orgId, "ATTENDANCE", "MEMBER"),
        memberEmails: await canViewKind(db, s.orgId, "CONTACT_EMAIL", "MEMBER"),
        memberBallots: await canViewBallotRows(db, s.orgId, "MEMBER"),
        adminBallots: await canViewBallotRows(db, s.orgId, "ADMIN"),
        ownerBallots: await canViewBallotRows(db, s.orgId, "OWNER"),
      }));
      expect(answers).toEqual({
        memberSignups: false,
        adminSignups: true,
        memberAttendance: true,
        memberEmails: false,
        memberBallots: false,
        adminBallots: false,
        ownerBallots: true,
      });
    });

    it("the ballot setting decides: OWNER_AND_ADMINS lets an admin see rows, NOBODY nobody", async () => {
      // app.org_settings_guard (Settings): only an OWNER may change this
      // setting, so the service transaction carries the owner's user id.
      const set = (value: "OWNER_ONLY" | "OWNER_AND_ADMINS" | "NOBODY") =>
        withSystemOrgTx(s.orgId, { userId: s.owner.id }, ({ db }) =>
          db.orgSettings.update({
            where: { organizationId: s.orgId },
            data: { ballotIndividualVisibility: value },
          }),
        );
      try {
        await set("OWNER_AND_ADMINS");
        as(s.admin);
        expect(await withOrgTx(s.orgId, ({ db }) => db.ballot.count())).toBeGreaterThan(0);
        await set("NOBODY");
        as(s.owner);
        expect(await withOrgTx(s.orgId, ({ db }) => db.ballot.count())).toBe(0);
      } finally {
        await set("OWNER_ONLY");
      }
    });
  });

  // ---- Ballot tallies ------------------------------------------------------------

  describe("app.ballot_tally", () => {
    it("gives an owner exact counts, with Borda and first choices for a ranked question", async () => {
      as(s.owner);
      const results = await withOrgTx(s.orgId, async ({ db }) => {
        const polls = await listPolls(db, s.orgId);
        const poll =
          polls.find((p) => !p.isTest && p.slug === "fall-workshop-topics") ??
          polls.find((p) => !p.isTest)!;
        return loadPollResults(db, s.orgId, poll, "OWNER");
      });
      expect(results.turnout).toBeGreaterThan(0);
      const ranked = results.questions.find((q) => q.type === "slots");
      expect(ranked).toBeDefined();
      expect(ranked!.options.every((o) => !o.suppressed)).toBe(true);
      expect(ranked!.options.some((o) => (o.borda ?? 0) > 0 && (o.firstChoice ?? 0) >= 0)).toBe(
        true,
      );
      // Borda is highest for the most-ranked option, and the list is sorted by it.
      const bordas = ranked!.options.map((o) => o.borda ?? 0);
      expect([...bordas].sort((a, b) => b - a)).toEqual(bordas);
    });

    it("suppresses small cells for a member and never tallies free text", async () => {
      as(s.member);
      const results = await withOrgTx(s.orgId, async ({ db }) => {
        const polls = await listPolls(db, s.orgId);
        return loadPollResults(
          db,
          s.orgId,
          polls.find((p) => !p.isTest)!,
          "MEMBER",
        );
      });
      const k = results.minCellSize;
      for (const q of results.questions) {
        for (const o of q.options) {
          if (o.suppressed) expect(o.votes).toBeNull();
          else expect(o.votes === null || o.votes === 0 || o.votes >= k).toBe(true);
        }
      }
      // The free-text question of the seeded poll is not a pivot row.
      expect(results.questions.some((q) => q.key === "notes")).toBe(false);
    });

    it("refuses to tally for another org, whatever tier is passed", async () => {
      as(s.owner);
      await expect(
        withOrgTx(
          s.orgId,
          ({ db }) => db.$queryRaw`SELECT * FROM app.ballot_tally('org_other', 'bd_1', 'OWNER')`,
        ),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  // ---- Synced rows ------------------------------------------------------------------

  describe("synced rows can be suppressed but never deleted", () => {
    it("an admin's DELETE of a synced check-in is refused, and suppress works", async () => {
      const synced = await withSystemOrgTx(s.orgId, ({ db }) =>
        db.attendance.findFirst({
          where: {
            organizationId: s.orgId,
            source: RecordSource.SUPABASE_SYNC,
            suppressedAt: null,
          },
          select: { id: true, contactId: true },
        }),
      );
      expect(synced).not.toBeNull();
      as(s.admin);
      await expect(
        withOrgAction((ctx: OrgContext) => deleteAttendance(ctx, synced!.id))(s.orgId),
      ).rejects.toThrow(/suppressed but not deleted/i);
      const stillThere = await withSystemOrgTx(s.orgId, ({ db }) =>
        db.attendance.count({ where: { id: synced!.id } }),
      );
      expect(stillThere).toBe(1);

      await withOrgAction((ctx: OrgContext) => setAttendanceSuppressed(ctx, synced!.id, true))(
        s.orgId,
      );
      const after = await withSystemOrgTx(s.orgId, ({ db }) =>
        db.attendance.findUniqueOrThrow({
          where: { id: synced!.id },
          select: { suppressedAt: true, stampNumber: true },
        }),
      );
      expect(after.suppressedAt).not.toBeNull();
      expect(after.stampNumber).toBeNull();
      await withOrgAction((ctx: OrgContext) => setAttendanceSuppressed(ctx, synced!.id, false))(
        s.orgId,
      );
    });

    it("the DELETE policy itself refuses a synced row and allows a suite-native one", async () => {
      as(s.admin);
      const rows = await withSystemOrgTx(s.orgId, async ({ db }) => {
        const contactId = id("del_contact");
        await db.contact.create({
          data: { id: contactId, organizationId: s.orgId, displayName: "Delete Me" },
        });
        created.contacts.add(contactId);
        const base = {
          organizationId: s.orgId,
          contactId,
          eventId: s.pastEventIds[0],
          term: "fall-2026",
          checkedInAt: new Date(),
          method: AttendanceMethod.MANUAL,
        };
        await db.attendance.create({
          data: { ...base, id: id("suite_att"), source: RecordSource.SUITE },
        });
        await db.attendance.create({
          data: {
            ...base,
            id: id("sync_att"),
            eventId: s.pastEventIds[1],
            source: RecordSource.SUPABASE_SYNC,
            externalId: id("ext"),
          },
        });
        return { suite: id("suite_att"), synced: id("sync_att") };
      });
      const deleted = await withOrgTx(s.orgId, async ({ db }) => ({
        synced: (await db.attendance.deleteMany({ where: { id: rows.synced } })).count,
        suite: (await db.attendance.deleteMany({ where: { id: rows.suite } })).count,
      }));
      expect(deleted).toEqual({ synced: 0, suite: 1 });
    });
  });

  // ---- Rollups ---------------------------------------------------------------------------

  describe("maintained stamp columns", () => {
    it("match a from-scratch computation after inserts, a suppression and a merge", async () => {
      const contactId = id("rollup_contact");
      const eventA = s.pastEventIds[0];
      const eventB = s.pastEventIds[1];
      await withSystemOrgTx(s.orgId, async ({ db }) => {
        await db.contact.create({
          data: { id: contactId, organizationId: s.orgId, displayName: "Rollup Test" },
        });
        created.contacts.add(contactId);
        const events = await db.event.findMany({
          where: { id: { in: [eventA, eventB] } },
          select: { id: true, term: true, startsAt: true },
        });
        for (const [i, e] of events.entries()) {
          await db.attendance.create({
            data: {
              id: id(`rollup_${i}`),
              organizationId: s.orgId,
              contactId,
              eventId: e.id,
              term: e.term ?? "fall-2026",
              checkedInAt: e.startsAt,
              method: AttendanceMethod.MANUAL,
              source: RecordSource.SUITE,
            },
          });
        }
        await db.$queryRaw`SELECT app.refresh_contact_rollups(${s.orgId}, ${[contactId]}::text[])::text AS ok`;
      });

      const expected = async () =>
        withSystemOrgTx(
          s.orgId,
          ({ db }) =>
            db.$queryRaw<{ id: string; stamp: number | null; total: number; first: boolean }[]>`
            SELECT a."id",
                   CASE WHEN a."suppressedAt" IS NULL THEN
                     row_number() OVER (PARTITION BY a."contactId", a."term", (a."suppressedAt" IS NULL)
                                        ORDER BY a."checkedInAt", a."id")::int END AS stamp,
                   count(*) FILTER (WHERE a."suppressedAt" IS NULL)
                     OVER (PARTITION BY a."contactId", a."term")::int AS total,
                   (a."suppressedAt" IS NULL AND row_number() OVER (PARTITION BY a."contactId", (a."suppressedAt" IS NULL)
                                        ORDER BY a."checkedInAt", a."id") = 1) AS first
              FROM "Attendance" a
             WHERE a."organizationId" = ${s.orgId} AND a."contactId" = ${contactId}
             ORDER BY a."id"`,
        );
      const stored = async () =>
        withSystemOrgTx(s.orgId, ({ db }) =>
          db.attendance.findMany({
            where: { organizationId: s.orgId, contactId },
            orderBy: { id: "asc" },
            select: { id: true, stampNumber: true, termStampTotal: true, isFirstVisit: true },
          }),
        );

      const compare = async () => {
        const [want, got] = [await expected(), await stored()];
        expect(
          got.map((g) => ({
            id: g.id,
            stamp: g.stampNumber,
            total: g.termStampTotal,
            first: g.isFirstVisit,
          })),
        ).toEqual(
          want.map((w) => ({ id: w.id, stamp: w.stamp, total: Number(w.total), first: w.first })),
        );
      };
      await compare();
      const termStats = await withSystemOrgTx(s.orgId, ({ db }) =>
        db.contactTermStats.findFirst({
          where: { organizationId: s.orgId, contactId },
          select: { sessionsAttended: true, stampCount: true },
        }),
      );
      expect(termStats).toMatchObject({ sessionsAttended: 2, stampCount: 2 });

      as(s.admin);
      await withOrgAction((ctx: OrgContext) => setAttendanceSuppressed(ctx, id("rollup_0"), true))(
        s.orgId,
      );
      await compare();
      const afterSuppress = await withSystemOrgTx(s.orgId, ({ db }) =>
        db.attendance.findUniqueOrThrow({
          where: { id: id("rollup_1") },
          select: { stampNumber: true, termStampTotal: true, isFirstVisit: true },
        }),
      );
      expect(afterSuppress).toEqual({ stampNumber: 1, termStampTotal: 1, isFirstVisit: true });
    });
  });

  // ---- Merges --------------------------------------------------------------------------------

  describe("merges", () => {
    it("mergeEvents moves check-ins, soft-deletes the loser and recomputes the counts", async () => {
      const survivorId = id("merge_keep");
      const loserId = id("merge_drop");
      const contactId = id("merge_contact");
      const startsAt = new Date("2026-10-06T22:00:00Z");
      await withSystemOrgTx(s.orgId, async ({ db }) => {
        await db.contact.create({
          data: { id: contactId, organizationId: s.orgId, displayName: "Merge Test" },
        });
        created.contacts.add(contactId);
        for (const [eid, title] of [
          [survivorId, "Merge Test Session"],
          [loserId, "Merge Test Session (duplicate)"],
        ] as const) {
          await db.event.create({
            data: {
              id: eid,
              organizationId: s.orgId,
              title,
              startsAt,
              endsAt: new Date(startsAt.getTime() + 3600_000),
              createdById: s.owner.id,
              term: "fall-2026",
            },
          });
          created.events.add(eid);
        }
        await db.attendance.create({
          data: {
            id: id("merge_att"),
            organizationId: s.orgId,
            contactId,
            eventId: loserId,
            term: "fall-2026",
            checkedInAt: startsAt,
            method: AttendanceMethod.MANUAL,
            source: RecordSource.SUITE,
          },
        });
        await db.$queryRaw`SELECT app.refresh_contact_rollups(${s.orgId}, ${[contactId]}::text[])::text AS ok`;
      });

      const result = await withSystemOrgTx(s.orgId, { userId: s.owner.id }, (ctx) =>
        mergeEvents(
          {
            ...ctx,
            organizationId: s.orgId,
            userId: s.owner.id,
            role: "OWNER" as Role,
            kind: "system",
          },
          survivorId,
          loserId,
        ),
      );
      expect(result.moved.attendance).toBe(1);

      const after = await withSystemOrgTx(s.orgId, async ({ db }) => ({
        loser: await db.event.findUniqueOrThrow({
          where: { id: loserId },
          select: { deletedAt: true, mergedIntoId: true },
        }),
        survivor: await db.event.findUniqueOrThrow({
          where: { id: survivorId },
          select: { attendanceCount: true },
        }),
        attendance: await db.attendance.findUniqueOrThrow({
          where: { id: id("merge_att") },
          select: { eventId: true, stampNumber: true },
        }),
        audit: await db.orgAuditLog.count({
          where: { organizationId: s.orgId, action: "event.merged", targetId: survivorId },
        }),
      }));
      expect(after.loser.deletedAt).not.toBeNull();
      expect(after.loser.mergedIntoId).toBe(survivorId);
      expect(after.survivor.attendanceCount).toBe(1);
      expect(after.attendance.eventId).toBe(survivorId);
      expect(after.attendance.stampNumber).toBe(1);
      expect(after.audit).toBe(1);
    });

    it("mergeContacts moves rows, keeps one row per session and recomputes the totals", async () => {
      const keep = id("c_keep");
      const drop = id("c_drop");
      await withSystemOrgTx(s.orgId, async ({ db }) => {
        for (const [cid, email] of [
          [keep, `${TAG}.keep@husky.example.edu`],
          [drop, `${TAG}.drop@husky.example.edu`],
        ] as const) {
          await db.contact.create({
            data: {
              id: cid,
              organizationId: s.orgId,
              displayName: cid === keep ? "Keep Me" : null,
              emails: { create: [{ emailNormalized: email, isPrimary: true }] },
            },
          });
          created.contacts.add(cid);
        }
        const base = {
          organizationId: s.orgId,
          term: "fall-2026",
          checkedInAt: new Date(),
          method: AttendanceMethod.MANUAL,
          source: RecordSource.SUITE,
        };
        // Both attended session 0 (a duplicate); only the loser attended session 1.
        await db.attendance.create({
          data: { ...base, id: id("mc_keep_0"), contactId: keep, eventId: s.pastEventIds[0] },
        });
        await db.attendance.create({
          data: { ...base, id: id("mc_drop_0"), contactId: drop, eventId: s.pastEventIds[0] },
        });
        await db.attendance.create({
          data: { ...base, id: id("mc_drop_1"), contactId: drop, eventId: s.pastEventIds[1] },
        });
        await db.$queryRaw`SELECT app.refresh_contact_rollups(${s.orgId}, ${[keep, drop]}::text[])::text AS ok`;
      });

      const result = await withSystemOrgTx(s.orgId, { userId: s.owner.id }, (ctx) =>
        mergeContacts({ ...ctx, organizationId: s.orgId }, keep, drop),
      );
      expect(result.moved).toMatchObject({ emails: 1, attendance: 1, duplicates: 1 });

      const after = await withSystemOrgTx(s.orgId, async ({ db }) => ({
        gone: await db.contact.count({ where: { id: drop } }),
        emails: await db.contactEmail.count({
          where: { organizationId: s.orgId, contactId: keep },
        }),
        sessions: (
          await db.contact.findUniqueOrThrow({
            where: { id: keep },
            select: { sessionsAttended: true },
          })
        ).sessionsAttended,
        rows: await db.attendance.count({ where: { organizationId: s.orgId, contactId: keep } }),
      }));
      expect(after).toEqual({ gone: 0, emails: 2, sessions: 2, rows: 2 });
    });
  });

  // ---- The website sync's write side ------------------------------------------------------------

  describe("sync writes", () => {
    const scope = (): SyncScope => ({
      organizationId: s.orgId,
      timezone: "America/New_York",
      creatorId: s.owner.id,
      memberEmails: new Map([["kristine@example.edu", s.member.id]]),
    });
    const sessionRow = {
      id: uuid(1),
      term: "fall-2026",
      slot: 9,
      title: "Sync Test Session",
      starts_at: new Date("2026-10-07T22:00:00Z"),
      room: "Snell 108",
      created_at: new Date(),
    };
    const checkin = (n: number, email: string, source: string) => ({
      id: uuid(100 + n),
      session_id: sessionRow.id,
      email,
      name: `Sync Person ${n}`,
      source,
      is_guest: false,
      created_at: new Date(`2026-10-07T22:0${n}:00Z`),
      ts_key: `2026-10-07 18:0${n}:00-04`,
    });

    it("creates the session, maps every check-in source and links a member's verified email", async () => {
      const stats = await withSystemOrgTx(s.orgId, async (ctx) => {
        const sessions = await applySessions({ ...ctx, organizationId: s.orgId }, scope(), [
          sessionRow,
        ]);
        const checkins = await applyCheckins(ctx.db, scope(), [
          checkin(1, `${TAG}.code@husky.example.edu`, "code"),
          checkin(2, `${TAG}.link@husky.example.edu`, "link"),
          checkin(3, `${TAG}.officer@husky.example.edu`, "officer"),
          checkin(4, `${TAG}.kiosk@husky.example.edu`, "kiosk"),
          checkin(5, "kristine@example.edu", "code"),
        ]);
        return { sessions, checkins };
      });
      expect(stats.sessions.created).toBe(1);
      expect(stats.checkins.upserted).toBe(5);
      expect(stats.checkins.unmapped).toBe(1);

      const rows = await withSystemOrgTx(s.orgId, async ({ db }) => {
        const event = await db.event.findFirstOrThrow({
          where: { organizationId: s.orgId, sourceSessionId: sessionRow.id },
          select: {
            id: true,
            title: true,
            visibility: true,
            term: true,
            stampSlot: true,
            kind: true,
          },
        });
        created.events.add(event.id);
        const attendance = await db.attendance.findMany({
          where: { organizationId: s.orgId, eventId: event.id },
          select: {
            method: true,
            contact: {
              select: {
                id: true,
                userId: true,
                emailMasked: true,
                emails: { select: { emailNormalized: true } },
              },
            },
          },
        });
        attendance.forEach((a) => created.contacts.add(a.contact.id));
        return { event, attendance };
      });
      expect(rows.event).toMatchObject({
        visibility: "INTERNAL",
        term: "fall-2026",
        stampSlot: 9,
        kind: "WORKSHOP",
      });
      const methods = rows.attendance.map((a) => a.method).sort();
      expect(methods).toEqual(["FORM", "FORM", "FORM", "MANUAL", "QR"]);
      const linked = rows.attendance.find((a) =>
        a.contact.emails.some((e) => e.emailNormalized === "kristine@example.edu"),
      );
      expect(linked?.contact.userId).toBe(s.member.id);
      const masked = rows.attendance.find((a) =>
        a.contact.emails.some((e) => e.emailNormalized.startsWith(`${TAG}.code`)),
      );
      expect(masked?.contact.emailMasked).toMatch(/^.\*\*\*@husky\.example\.edu$/);
    });

    it("is idempotent: the same batch again writes nothing new", async () => {
      const again = await withSystemOrgTx(s.orgId, async (ctx) => {
        const sessions = await applySessions({ ...ctx, organizationId: s.orgId }, scope(), [
          sessionRow,
        ]);
        const checkins = await applyCheckins(ctx.db, scope(), [
          checkin(1, `${TAG}.code@husky.example.edu`, "code"),
        ]);
        return { sessions, checkins };
      });
      expect(again.sessions).toMatchObject({ created: 0, linked: 0 });
      expect(again.checkins.upserted).toBe(0);
    });

    it("an exact-linked session keeps suite edits but still takes the term and slot", async () => {
      const edited = await withSystemOrgTx(s.orgId, async (ctx) => {
        const event = await ctx.db.event.findFirstOrThrow({
          where: { organizationId: s.orgId, sourceSessionId: sessionRow.id },
        });
        await ctx.db.event.update({
          where: { id: event.id },
          data: { title: "Renamed in the suite", suiteEditedAt: new Date() },
        });
        await applySessions({ ...ctx, organizationId: s.orgId }, scope(), [
          { ...sessionRow, title: "Changed on the website", slot: 11 },
        ]);
        return ctx.db.event.findFirstOrThrow({
          where: { id: event.id },
          select: { title: true, stampSlot: true },
        });
      });
      expect(edited).toEqual({ title: "Renamed in the suite", stampSlot: 11 });
    });

    it("imports signups, keeps 'added to list', and never imports load or smoke test ballots", async () => {
      const email = `${TAG}.signup@husky.example.edu`;
      const signup = {
        id: uuid(200),
        name: "Sync Signup",
        email,
        class_year: "second",
        colleges: ["khoury"],
        meet_days: ["tuesday"],
        interests: ["workshops"],
        term: "fall-2026",
        source: "web",
        submissions: 1,
        created_at: new Date("2026-09-05T16:00:00Z"),
        updated_at: new Date("2026-09-05T16:00:00Z"),
        added_to_list_at: null,
        ts_key: "2026-09-05 12:00:00-04",
      };
      const first = await withSystemOrgTx(s.orgId, ({ db }) => applySignups(db, scope(), [signup]));
      expect(first.upserted).toBe(1);
      const contactId = first.contacts[0];
      created.contacts.add(contactId);

      // The suite marks it added; a later sync of the same row must not clear that.
      await withSystemOrgTx(s.orgId, async ({ db }) => {
        await db.signup.updateMany({
          where: { organizationId: s.orgId, contactId },
          data: { addedToListAt: new Date() },
        });
        // Status is a rollup: every write path refreshes it in the same transaction.
        await refreshRollups(db, s.orgId, [contactId]);
      });
      await withSystemOrgTx(s.orgId, ({ db }) =>
        applySignups(db, scope(), [
          { ...signup, submissions: 2, updated_at: new Date("2026-09-06T16:00:00Z") },
        ]),
      );
      const stored = await withSystemOrgTx(s.orgId, ({ db }) =>
        db.signup.findFirstOrThrow({
          where: { organizationId: s.orgId, contactId },
          select: { addedToListAt: true, submissions: true, status: true },
        }),
      );
      expect(stored.addedToListAt).not.toBeNull();
      expect(stored.submissions).toBe(2);
      expect(stored.status).toBe("ADDED");

      const ballots = await withSystemOrgTx(s.orgId, ({ db }) =>
        applyBallots(db, scope(), [
          {
            id: uuid(300),
            poll_slug: `${TAG}-poll`,
            answers: { q: "a" },
            created_at: new Date("2026-09-10T18:00:00Z"),
          },
          {
            id: uuid(301),
            poll_slug: "loadtest-7",
            answers: { q: "a" },
            created_at: new Date("2026-09-10T18:00:00Z"),
          },
          {
            id: uuid(302),
            poll_slug: "smoke-test-2",
            answers: { q: "a" },
            created_at: new Date("2026-09-10T18:00:00Z"),
          },
        ]),
      );
      expect(ballots.details?.testSlug).toBe(2);
      expect(ballots.upserted).toBe(1);
      const kept = await withSystemOrgTx(s.orgId, ({ db }) =>
        db.ballot.findFirstOrThrow({
          where: { organizationId: s.orgId, externalId: uuid(300) },
          select: { id: true, excludedReason: true },
        }),
      );
      // No definition for this slug yet, so it is stored but not counted.
      expect(kept.excludedReason).toBe("no-definition");
      await withSystemOrgTx(s.orgId, ({ db }) =>
        db.ballot.deleteMany({ where: { organizationId: s.orgId, externalId: uuid(300) } }),
      );
    });

    it("marks unsubscribed contacts and removes rows the source no longer has", async () => {
      const email = `${TAG}.signup@husky.example.edu`;
      const unsub = await withSystemOrgTx(s.orgId, ({ db }) =>
        applyUnsubscribes(db, scope(), [{ email, created_at: new Date(), handled_at: null }]),
      );
      expect(unsub.upserted).toBe(1);
      const contact = await withSystemOrgTx(s.orgId, ({ db }) =>
        db.contact.findFirstOrThrow({
          where: { organizationId: s.orgId, emails: { some: { emailNormalized: email } } },
          select: { unsubscribedAt: true },
        }),
      );
      expect(contact.unsubscribedAt).not.toBeNull();

      // A reconcile that no longer sees one check-in removes exactly that row.
      const before = await withSystemOrgTx(s.orgId, ({ db }) =>
        db.attendance.count({
          where: { organizationId: s.orgId, source: RecordSource.SUPABASE_SYNC },
        }),
      );
      const seen = await withSystemOrgTx(s.orgId, async ({ db }) => {
        const all = await db.attendance.findMany({
          where: {
            organizationId: s.orgId,
            source: RecordSource.SUPABASE_SYNC,
            externalId: { not: null },
          },
          select: { externalId: true },
        });
        return new Set(all.map((a) => a.externalId as string).filter((e) => e !== uuid(104)));
      });
      const removed = await withSystemOrgTx(s.orgId, ({ db }) =>
        removeMissing(db, s.orgId, "checkins", seen),
      );
      expect(removed.removed).toBe(1);
      const after = await withSystemOrgTx(s.orgId, ({ db }) =>
        db.attendance.count({
          where: { organizationId: s.orgId, source: RecordSource.SUPABASE_SYNC },
        }),
      );
      expect(after).toBe(before - 1);
    });

    it("the watermark is a compare-and-set: a stale batch cannot move it", async () => {
      const integrationId = id("integration").slice(0, 30);
      let usedIntegrationId = integrationId;
      const states = await withSystemOrgTx(s.orgId, async ({ db }) => {
        const existing = await db.orgIntegration.findFirst({
          where: { organizationId: s.orgId, provider: "NETLIFY_BUILD_HOOK" },
          select: { id: true },
        });
        const useId = existing?.id ?? integrationId;
        if (!existing) {
          await db.orgIntegration.create({
            data: {
              id: useId,
              organizationId: s.orgId,
              provider: "NETLIFY_BUILD_HOOK",
              config: {},
            },
          });
          created.integrations.add(useId);
        }
        usedIntegrationId = useId;
        syncStates.add(useId);
        return ensureStates(db, s.orgId, useId);
      });
      const state = states.get("checkins")!;
      const before = await withSystemOrgTx(s.orgId, ({ db }) =>
        db.dataSourceSyncState.findUniqueOrThrow({
          where: { id: state.id },
          select: { rowsUpserted: true },
        }),
      );
      await withSystemOrgTx(s.orgId, ({ db }) =>
        advanceWatermark(
          db,
          state,
          state.watermark,
          { ts: "2026-10-07 18:05:00-04", id: uuid(105) },
          5,
        ),
      );
      await expect(
        withSystemOrgTx(s.orgId, ({ db }) =>
          advanceWatermark(
            db,
            state,
            state.watermark,
            { ts: "2026-10-07 18:01:00-04", id: uuid(101) },
            1,
          ),
        ),
      ).rejects.toBeInstanceOf(StaleWatermarkError);
      const now = await withSystemOrgTx(s.orgId, ({ db }) =>
        db.dataSourceSyncState.findUniqueOrThrow({
          where: { id: state.id },
          select: { watermark: true, rowsUpserted: true },
        }),
      );
      expect(now.watermark).toMatchObject({ id: uuid(105) });
      expect(now.rowsUpserted).toBe(before.rowsUpserted + 5);
      expect(usedIntegrationId).toBeTruthy();
    });
  });
});
