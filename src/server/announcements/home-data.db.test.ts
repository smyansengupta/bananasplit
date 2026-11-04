// @vitest-environment node
// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { afterAll, describe, expect, it, vi } from "vitest";

/**
 * Announcements and decisions against the local database, as members
 * (app_user, RLS): "Seen by N of M" counts members' own sightings, a post's
 * event chip says who's going, and an open decision brings its owner, its
 * links and its poll's standings. Only this file's rows are touched (they
 * are removed afterwards). Skipped without the database or the seeded club.
 */

vi.mock("@/lib/auth/session", () => ({ requireUser: vi.fn() }));

import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { disconnectAll } from "../db/clients";
import { withOrgTxAs } from "../db/context";
import { listOpenDecisions } from "../decisions/decisions";
import { listAnnouncements, markSeen } from "./announcements";

let seeded: { orgId: string; slug: string; a: string; b: string } | null = null;
try {
  const org = await ownerDb.organization.findUnique({
    where: { slug: "claude-builders-club" },
    select: { id: true, slug: true, memberships: { select: { userId: true }, take: 2 } },
  });
  // The tables arrive with 20261102100000_home_widgets; an older database skips.
  await ownerDb.announcement.count();
  if (org && org.memberships.length === 2) {
    seeded = {
      orgId: org.id,
      slug: org.slug,
      a: org.memberships[0]!.userId,
      b: org.memberships[1]!.userId,
    };
  }
} catch {
  seeded = null;
}

describe.skipIf(!seeded)("announcements and decisions (local database)", () => {
  const s = seeded!;
  const made = {
    posts: [] as string[],
    decisions: [] as string[],
    events: [] as string[],
    polls: [] as string[],
  };

  afterAll(async () => {
    const ids = [...made.posts, ...made.decisions];
    await ownerDb.itemLink.deleteMany({
      where: { OR: [{ fromId: { in: ids } }, { toId: { in: ids } }] },
    });
    await ownerDb.announcement.deleteMany({ where: { id: { in: made.posts } } });
    await ownerDb.decision.deleteMany({ where: { id: { in: made.decisions } } });
    await ownerDb.poll.deleteMany({ where: { id: { in: made.polls } } });
    await ownerDb.event.deleteMany({ where: { id: { in: made.events } } });
    await disconnectAll();
    await disconnectOwnerDb();
  });

  it("counts who has seen a post, and links its event with who's going", async () => {
    const event = await ownerDb.event.create({
      data: {
        organizationId: s.orgId,
        title: "Home widgets test social",
        startsAt: new Date(Date.now() + 3 * 86_400_000),
        endsAt: new Date(Date.now() + 3 * 86_400_000 + 3_600_000),
        createdById: s.a,
      },
      select: { id: true },
    });
    made.events.push(event.id);
    await ownerDb.eventAttendee.create({
      data: { organizationId: s.orgId, eventId: event.id, userId: s.b, rsvp: "YES" },
    });

    const postId = await withOrgTxAs(s.a, s.orgId, async ({ db }) => {
      const post = await db.announcement.create({
        data: {
          organizationId: s.orgId,
          authorId: s.a,
          title: "Test social Friday",
          body: "Bring a friend",
        },
        select: { id: true },
      });
      await db.itemLink.create({
        data: {
          organizationId: s.orgId,
          fromKind: "announcement",
          fromId: post.id,
          toKind: "event",
          toId: event.id,
          createdById: s.a,
        },
      });
      expect(await markSeen(db, s.orgId, s.a, [post.id, "not_a_post"])).toBe(1);
      expect(await markSeen(db, s.orgId, s.a, [post.id])).toBe(0);
      return post.id;
    });
    made.posts.push(postId);

    const [mine] = await withOrgTxAs(s.b, s.orgId, ({ db }) =>
      listAnnouncements(db, s.orgId, s.b, { limit: 50, orgSlug: s.slug }).then((all) =>
        all.filter((p) => p.id === postId),
      ),
    );
    const members = await ownerDb.membership.count({ where: { organizationId: s.orgId } });
    expect(mine).toMatchObject({
      title: "Test social Friday",
      author: { id: s.a },
      seenCount: 1,
      memberCount: members,
      seenByMe: false,
      links: [
        {
          kind: "event",
          label: "Home widgets test social, 1 going",
          href: `/app/${s.slug}/calendar/${event.id}`,
        },
      ],
    });
  });

  it("lists an open decision with its owner, its meeting and its poll's standings", async () => {
    const poll = await ownerDb.poll.create({
      data: {
        organizationId: s.orgId,
        question: "Hackathon date?",
        createdById: s.a,
      },
      select: { id: true },
    });
    made.polls.push(poll.id);
    await ownerDb.pollOption.createMany({
      data: [
        { organizationId: s.orgId, pollId: poll.id, label: "Nov 21", sortOrder: 0 },
        { organizationId: s.orgId, pollId: poll.id, label: "Dec 5", sortOrder: 1 },
      ],
    });
    const dec5 = (
      await ownerDb.pollOption.findFirstOrThrow({
        where: { pollId: poll.id, label: "Dec 5" },
        select: { id: true },
      })
    ).id;
    await ownerDb.pollVote.createMany({
      data: [s.a, s.b].map((userId) => ({
        organizationId: s.orgId,
        pollId: poll.id,
        optionId: dec5,
        userId,
      })),
    });

    const decisionId = await withOrgTxAs(s.a, s.orgId, async ({ db }) => {
      const d = await db.decision.create({
        data: {
          organizationId: s.orgId,
          question: "Hackathon date",
          createdById: s.a,
          ownerId: s.a,
        },
        select: { id: true },
      });
      await db.itemLink.createMany({
        data: [
          { kind: "poll", id: poll.id },
          { kind: "event", id: made.events[0]! },
        ].map((r) => ({
          organizationId: s.orgId,
          fromKind: "decision",
          fromId: d.id,
          toKind: r.kind,
          toId: r.id,
          createdById: s.a,
        })),
      });
      return d.id;
    });
    made.decisions.push(decisionId);

    const found = await withOrgTxAs(s.b, s.orgId, ({ db }) =>
      listOpenDecisions(db, s.orgId, { limit: 50, viewer: { userId: s.b, role: "MEMBER" } }),
    );
    const d = found.find((x) => x.id === decisionId);
    const members = await ownerDb.membership.count({ where: { organizationId: s.orgId } });
    expect(d).toMatchObject({
      question: "Hackathon date",
      status: "OPEN",
      owner: { id: s.a },
      poll: {
        id: poll.id,
        title: "Hackathon date?",
        voted: 2,
        eligible: members,
        mine: true,
        open: true,
        options: [
          { label: "Dec 5", votes: 2, pct: 100 },
          { label: "Nov 21", votes: 0, pct: 0 },
        ],
      },
    });
    expect(d!.links.map((l) => l.kind)).toEqual(["poll", "event"]);
    expect(d!.links[1]!.label).toMatch(/^Home widgets test social, [A-Z][a-z]{2} \d{1,2}$/);
  });
});
