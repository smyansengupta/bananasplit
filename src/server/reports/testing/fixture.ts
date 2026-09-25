import { randomBytes } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";

import {
  AttendanceMethod,
  EventKind,
  PrismaClient,
  RecordSource,
  Role,
  SignupSource,
} from "@/generated/prisma/client";

/**
 * A small, hand-built org for the report SQL tests, with every expected
 * number known by construction (docs/features/reports.md, "Testing").
 * Created as the migration owner (MIGRATE_DATABASE_URL), like the seed, then
 * app.explode_ballot and app.refresh_contact_rollups compute the 4b rollups.
 * Timezone America/New_York; the check-ins and signups straddle the
 * 2026-11-01 DST change and local midnights.
 *
 * Test-only: never imported by app code.
 */

export const FIXTURE_TZ = "America/New_York";
/** A clock after every fixture row, for the "up to now" clamps. */
export const FIXTURE_AS_OF = "2027-01-15T12:00:00.000Z";

export interface ReportFixture {
  orgId: string;
  slug: string;
  userId: string;
  events: Record<"e1" | "e2" | "e3" | "e4" | "e5" | "e6" | "e7" | "e8", string>;
  ballots: { topics: string; nextTerm: string; test: string };
  owner: PrismaClient;
  cleanup: () => Promise<void>;
}

export function ownerClient(): PrismaClient | null {
  // The table owner (the seed's URL); without it the DB tests skip.
  const url = process.env.MIGRATE_DATABASE_URL;
  if (!url) return null;
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}

const at = (iso: string) => new Date(iso);
const plus = (d: Date, minutes: number) => new Date(d.getTime() + minutes * 60_000);

export async function createReportFixture(owner: PrismaClient): Promise<ReportFixture> {
  const suffix = randomBytes(4).toString("hex");
  const slug = `reports-fixture-${suffix}`;
  const user = await owner.user.create({
    data: { email: `${slug}@example.test`, name: "Report Fixture Owner", emailVerified: new Date() },
    select: { id: true },
  });
  const org = await owner.organization.create({
    data: { name: `Reports fixture ${suffix}`, slug, timezone: FIXTURE_TZ },
    select: { id: true },
  });
  const orgId = org.id;
  await owner.membership.create({ data: { userId: user.id, organizationId: orgId, role: Role.OWNER } });
  await owner.orgSettings.update({
    where: { organizationId: orgId },
    data: { stampMilestones: [2, 3, 5], lapsedAfterSessions: 2, ballotMinCellSize: 3 },
  });

  const event = async (
    title: string,
    kind: EventKind,
    startsAt: string,
    extra: { deletedAt?: Date } = {},
  ) => {
    const start = at(startsAt);
    const e = await owner.event.create({
      data: {
        organizationId: orgId,
        title,
        kind,
        startsAt: start,
        endsAt: plus(start, 90),
        createdById: user.id,
        ...extra,
      },
      select: { id: true },
    });
    return e.id;
  };
  const events = {
    e1: await event("Spring Workshop", EventKind.WORKSHOP, "2026-04-10T22:00:00Z"),
    e2: await event("Kickoff Info Session", EventKind.INFO_SESSION, "2026-09-02T22:00:00Z"),
    e3: await event("Workshop A", EventKind.WORKSHOP, "2026-09-09T22:00:00Z"),
    e4: await event("Welcome Social", EventKind.SOCIAL, "2026-09-12T18:00:00Z"),
    // Oct 31 18:00 EDT.
    e5: await event("Workshop B", EventKind.WORKSHOP, "2026-10-31T22:00:00Z"),
    // Nov 1 00:00 EDT, the night the clocks go back.
    e6: await event("Midnight Hack", EventKind.HACKATHON, "2026-11-01T04:00:00Z"),
    // No check-ins: never a session.
    e7: await event("Board meeting", EventKind.BOARD_MEETING, "2026-09-14T23:00:00Z"),
    // Deleted, with a check-in: excluded from every report.
    e8: await event("Deleted workshop", EventKind.WORKSHOP, "2026-09-20T22:00:00Z", {
      deletedAt: at("2026-09-21T12:00:00Z"),
    }),
  };

  const contacts: Record<string, string> = {};
  for (let i = 1; i <= 12; i++) {
    const c = await owner.contact.create({
      data: { organizationId: orgId, displayName: `Contact ${i}`, emailMasked: `c***@example.test` },
      select: { id: true },
    });
    contacts[`c${i}`] = c.id;
  }

  const starts: Record<string, Date> = {
    e1: at("2026-04-10T22:00:00Z"),
    e2: at("2026-09-02T22:00:00Z"),
    e3: at("2026-09-09T22:00:00Z"),
    e4: at("2026-09-12T18:00:00Z"),
    e5: at("2026-10-31T22:00:00Z"),
    e6: at("2026-11-01T04:00:00Z"),
    e8: at("2026-09-20T22:00:00Z"),
  };
  const checkIns: [string, string, Date, boolean?][] = [
    ["e1", "c1", plus(starts.e1, 5)],
    ["e1", "c2", plus(starts.e1, 5)],
    ["e2", "c1", plus(starts.e2, 5)],
    ["e2", "c2", plus(starts.e2, 5)],
    ["e2", "c3", plus(starts.e2, 5)],
    ["e2", "c4", plus(starts.e2, 5)],
    ["e3", "c1", plus(starts.e3, 5)],
    ["e3", "c3", plus(starts.e3, 5)],
    ["e3", "c5", plus(starts.e3, 5)],
    ["e4", "c1", plus(starts.e4, 5)],
    ["e4", "c2", plus(starts.e4, 5)],
    ["e4", "c4", plus(starts.e4, 5), true],
    ["e5", "c1", plus(starts.e5, 5)],
    ["e5", "c3", plus(starts.e5, 5)],
    ["e6", "c3", at("2026-11-01T04:10:00Z")],
    // 01:30 EDT and 01:30 EST: the same wall clock, an hour apart.
    ["e6", "c1", at("2026-11-01T05:30:00Z")],
    ["e6", "c6", at("2026-11-01T06:30:00Z")],
    ["e8", "c12", plus(starts.e8, 5)],
  ];
  await owner.attendance.createMany({
    data: checkIns.map(([e, c, when, suppressed]) => ({
      organizationId: orgId,
      eventId: events[e as keyof typeof events],
      contactId: contacts[c],
      term: "pending",
      checkedInAt: when,
      method: AttendanceMethod.QR,
      source: RecordSource.SUITE,
      suppressedAt: suppressed ? at("2026-09-13T00:00:00Z") : null,
    })),
  });

  const signups: [string, string, SignupSource, string, boolean?][] = [
    ["c3", "2026-08-30T16:00:00Z", SignupSource.TYPEFORM, "fall-2026"],
    ["c5", "2026-09-01T12:00:00Z", SignupSource.WEB, "fall-2026"],
    // Oct 25 23:30 EDT (Sunday) and Oct 26 00:30 EDT (Monday).
    ["c7", "2026-10-26T03:30:00Z", SignupSource.WEB, "fall-2026"],
    ["c8", "2026-10-26T04:30:00Z", SignupSource.WEB, "fall-2026"],
    // Nov 1 01:30 EDT, Nov 1 01:30 EST.
    ["c6", "2026-11-01T05:30:00Z", SignupSource.WEB, "fall-2026"],
    ["c1", "2026-11-01T06:30:00Z", SignupSource.WEB, "fall-2026"],
    // Nov 1 23:30 EST (Sunday) and Nov 2 00:30 EST (Monday).
    ["c9", "2026-11-02T04:30:00Z", SignupSource.WEB, "fall-2026"],
    ["c10", "2026-11-02T05:30:00Z", SignupSource.WEB, "fall-2026"],
    ["c2", "2026-04-01T16:00:00Z", SignupSource.WEB, "spring-2026"],
    ["c11", "2026-09-20T15:00:00Z", SignupSource.WEB, "fall-2026", true],
  ];
  await owner.signup.createMany({
    data: signups.map(([c, when, channel, term, suppressed]) => ({
      organizationId: orgId,
      contactId: contacts[c],
      term,
      channel,
      signedUpAt: at(when),
      suppressedAt: suppressed ? at("2026-09-21T00:00:00Z") : null,
    })),
  });

  const topics = await owner.ballotDefinition.create({
    data: {
      organizationId: orgId,
      slug: "workshop-topics",
      title: "Workshop topics",
      opensAt: at("2026-09-01T12:00:00Z"),
      closesAt: at("2026-09-10T12:00:00Z"),
      linkedEventId: events.e2,
      definition: {
        questions: [
          {
            key: "topics",
            label: "Rank the topics",
            type: "slots",
            options: [
              { key: "a", label: "Agents" },
              { key: "b", label: "RAG" },
              { key: "c", label: "Evals" },
              { key: "d", label: "Vision" },
            ],
          },
          {
            key: "format",
            label: "Format",
            type: "single",
            options: [
              { key: "in-person", label: "In person" },
              { key: "hybrid", label: "Hybrid" },
            ],
          },
          { key: "first", label: "First workshop?", type: "yesno" },
          { key: "notes", label: "Notes", type: "text" },
        ],
      },
    },
    select: { id: true },
  });
  const nextTerm = await owner.ballotDefinition.create({
    data: {
      organizationId: orgId,
      slug: "next-term",
      title: "Next term vote",
      opensAt: at("2027-01-10T12:00:00Z"),
      closesAt: at("2027-01-20T12:00:00Z"),
      definition: { questions: [{ key: "q", label: "Pick", type: "single", options: [{ key: "x", label: "X" }] }] },
    },
    select: { id: true },
  });
  const testPoll = await owner.ballotDefinition.create({
    data: {
      organizationId: orgId,
      slug: "test-poll",
      title: "Test poll",
      isTest: true,
      opensAt: at("2026-09-01T12:00:00Z"),
      definition: { questions: [{ key: "q", label: "Test", type: "single", options: [{ key: "x", label: "X" }] }] },
    },
    select: { id: true },
  });
  const ballotRows: [string, Record<string, unknown>, string, string?][] = [
    [topics.id, { topics: ["a", "b", "c"], format: "in-person", first: true }, "2026-09-03T15:00:00Z"],
    [topics.id, { topics: ["a", "c"], format: "in-person", first: false }, "2026-09-03T16:00:00Z"],
    [topics.id, { topics: ["b", "a"], format: "hybrid", first: true }, "2026-09-04T15:00:00Z"],
    [topics.id, { topics: ["a"], format: "in-person", notes: "hi" }, "2026-09-05T15:00:00Z"],
    [topics.id, { topics: ["c", "a", "b"], format: "in-person", first: true }, "2026-09-06T15:00:00Z"],
    [topics.id, { topics: ["d"], format: "hybrid" }, "2026-09-06T16:00:00Z", "test ballot"],
    [testPoll.id, { q: "x" }, "2026-09-06T16:00:00Z"],
  ];
  let seq = 0;
  for (const [definitionId, answers, castAt, excludedReason] of ballotRows) {
    const b = await owner.ballot.create({
      data: {
        organizationId: orgId,
        ballotDefinitionId: definitionId,
        pollSlug: definitionId === topics.id ? "workshop-topics" : "test-poll",
        answers: answers as object,
        castAt: at(castAt),
        source: RecordSource.SUITE,
        externalId: `fx_${seq++}`,
        excludedReason: excludedReason ?? null,
      },
      select: { id: true },
    });
    await owner.$queryRaw`SELECT app.explode_ballot(${orgId}, ${b.id}) AS n`;
  }

  await owner.$queryRaw`SELECT app.refresh_contact_rollups(${orgId}, NULL)::text AS ok`;
  // Contact.lapsedSince as app.refresh_lapsed computes it once the clock is
  // past every session (lapsedAfterSessions = 2): set explicitly so the
  // fixture does not depend on today's date.
  const lapsed: [string, Date][] = [
    ["c2", starts.e5],
    ["c4", starts.e3],
    ["c5", starts.e4],
  ];
  for (const [c, since] of lapsed) {
    await owner.contact.update({ where: { id: contacts[c] }, data: { lapsedSince: since } });
  }

  return {
    orgId,
    slug,
    userId: user.id,
    events,
    ballots: { topics: topics.id, nextTerm: nextTerm.id, test: testPoll.id },
    owner,
    cleanup: async () => {
      await owner.organization.deleteMany({ where: { id: orgId } });
      await owner.user.deleteMany({ where: { id: user.id } });
    },
  };
}
