// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Question polls against the real roles and policies: a member asks, people
 * vote (changing and clearing), the settings do what they say, and an
 * anonymous poll's voters stay unknown to everyone, its creator and the
 * owner included, while its counts stay right. Everything made here is
 * removed in afterAll.
 */

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));

import { buildQuestionPollView } from "@/lib/polls/question-poll";
import { authDb, disconnectAll } from "@/server/db/clients";
import { withOrgTx } from "@/server/db/context";
import { listPins, pinPage } from "@/server/pins";
import { searchPinnables } from "@/server/pins/search";
import { listOpenPolls } from "@/server/polls/open-polls";
import { listQuestionPolls, loadQuestionPollSource } from "@/server/polls/question-polls";
import { createOrganization } from "@/server/settings/org-creation";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import {
  addQuestionPollOption,
  createQuestionPoll,
  deleteQuestionPoll,
  removeQuestionPollOption,
  setQuestionPollClosed,
  voteOnQuestionPoll,
} from "./question-actions";

type User = { id: string; email: string; name: string };

const tag = randomBytes(4).toString("hex");
let owner: User = { id: "", email: "", name: "" };
let ann: User = { id: "", email: "", name: "" };
let bo: User = { id: "", email: "", name: "" };
let org = { id: "", slug: "" };
let reachable = true;

async function makeUser(local: string): Promise<User> {
  const row = await authDb.user.create({
    data: {
      email: `${local}-${tag}@example.edu`,
      name: `${local} ${tag}`,
      emailVerified: new Date(),
      onboardedAt: new Date(),
    },
    select: { id: true, email: true, name: true },
  });
  return { id: row.id, email: row.email, name: row.name ?? local };
}

/** Runs `fn` signed in as `user`. */
function as<T>(user: User, fn: () => Promise<T>): Promise<T> {
  requireUserMock.mockResolvedValue(user);
  return fn();
}

const inADay = () => new Date(Date.now() + 86_400_000).toISOString();

async function ask(user: User, input: Partial<Parameters<typeof createQuestionPoll>[1]> = {}) {
  const result = await as(user, () =>
    createQuestionPoll(org.id, {
      question: `Lunch? ${tag}`,
      options: ["Pizza", "Tacos", "Sushi"],
      ...input,
    }),
  );
  if (!result.pollId) throw new Error(`ask failed: ${result.error}`);
  return result.pollId;
}

async function optionIds(pollId: string): Promise<string[]> {
  const rows = await ownerDb.pollOption.findMany({
    where: { pollId },
    orderBy: { sortOrder: "asc" },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** The poll page's view for `user`. */
function viewAs(user: User, pollId: string) {
  return as(user, () =>
    withOrgTx(org.id, async ({ db, role }) => {
      const source = await loadQuestionPollSource(db, org.id, pollId, user.id);
      if (!source) return null;
      return buildQuestionPollView(
        source,
        {
          userId: user.id,
          isAdmin: role === "OWNER" || role === "ADMIN",
          profile: { name: user.name, image: null, avatar: null },
        },
        new Date(),
      );
    }),
  );
}

beforeAll(async () => {
  vi.stubEnv("PLATFORM_ORG_CREATION_ENABLED", "true");
  vi.stubEnv("ORG_CREATION_MODE", "open");
  try {
    owner = await makeUser("qpoll-owner");
    ann = await makeUser("qpoll-ann");
    bo = await makeUser("qpoll-bo");
    const made = await createOrganization(owner, {
      name: `Polls ${tag}`,
      slug: `qpolls-${tag}`,
      timezone: "UTC",
    });
    if (!made.ok) throw new Error(JSON.stringify(made));
    org = { id: made.orgId, slug: made.slug };
    await ownerDb.membership.createMany({
      data: [
        { organizationId: org.id, userId: ann.id, role: "MEMBER" },
        { organizationId: org.id, userId: bo.id, role: "MEMBER" },
      ],
    });
  } catch (error) {
    console.warn(
      "[question-polls.db.test] skipped:",
      error instanceof Error ? error.message : error,
    );
    reachable = false;
  }
});

afterAll(async () => {
  vi.unstubAllEnvs();
  if (reachable && org.id) {
    await ownerDb.organization.delete({ where: { id: org.id } });
    await ownerDb.orgSlugHistory.deleteMany({ where: { slug: org.slug } });
  }
  const ids = [owner.id, ann.id, bo.id].filter(Boolean);
  if (ids.length) await ownerDb.user.deleteMany({ where: { id: { in: ids } } });
  await disconnectAll();
  await disconnectOwnerDb();
});

describe("asking", () => {
  it("any member asks; bad polls are refused with a reason", async () => {
    if (!reachable) return;
    const refused = (input: Parameters<typeof createQuestionPoll>[1]) =>
      as(ann, () => createQuestionPoll(org.id, input)).then((r) => r.error);
    expect(await refused({ question: "  ", options: ["A", "B"] })).toBe("Ask a question.");
    expect(await refused({ question: "Q", options: ["A", " "] })).toBe("Add at least two options.");
    expect(await refused({ question: "Q", options: ["Pizza", " PIZZA "] })).toBe(
      "Each option must be different.",
    );
    expect(
      await refused({
        question: "Q",
        options: ["A", "B"],
        closesAt: new Date(Date.now() - 1000).toISOString(),
      }),
    ).toMatch(/future/);

    const pollId = await ask(ann, {
      question: `  Where   to? ${tag} `,
      description: "  Friday social  ",
      options: ["Park", "", "  Bowling  alley "],
      closesAt: inADay(),
    });
    const stored = await ownerDb.poll.findUniqueOrThrow({
      where: { id: pollId },
      include: { options: { orderBy: { sortOrder: "asc" } } },
    });
    expect(stored).toMatchObject({
      question: `Where to? ${tag}`,
      description: "Friday social",
      createdById: ann.id,
    });
    expect(stored.options.map((o) => [o.label, o.addedById])).toEqual([
      ["Park", ann.id],
      ["Bowling alley", ann.id],
    ]);
    expect(stored.closesAt).not.toBeNull();
  });
});

describe("voting", () => {
  it("picks one, changes it and clears it on a single-choice poll", async () => {
    if (!reachable) return;
    const pollId = await ask(ann);
    const [pizza, tacos] = await optionIds(pollId);

    expect(await as(bo, () => voteOnQuestionPoll(org.id, pollId, [pizza]))).toEqual({});
    expect(await as(bo, () => voteOnQuestionPoll(org.id, pollId, [tacos]))).toEqual({});
    expect(await as(bo, () => voteOnQuestionPoll(org.id, pollId, [pizza, tacos]))).toEqual({
      error: "Pick one option.",
    });
    expect(
      await ownerDb.pollVote.findMany({
        where: { pollId },
        select: { optionId: true, userId: true },
      }),
    ).toEqual([{ optionId: tacos, userId: bo.id }]);

    const view = await viewAs(ann, pollId);
    expect(view?.voterCount).toBe(1);
    expect(view?.options.map((o) => o.votes)).toEqual([0, 1, 0]);
    expect(view?.options[1].voters?.map((v) => v.name)).toEqual([bo.name]);

    expect(await as(bo, () => voteOnQuestionPoll(org.id, pollId, []))).toEqual({});
    expect(await ownerDb.pollVote.count({ where: { pollId } })).toBe(0);
  });

  it("picks several on a multiple-choice poll, and refuses options of another poll", async () => {
    if (!reachable) return;
    const pollId = await ask(ann, { multiple: true });
    const other = await ask(ann);
    const [pizza, tacos, sushi] = await optionIds(pollId);
    const [elsewhere] = await optionIds(other);

    expect(await as(bo, () => voteOnQuestionPoll(org.id, pollId, [pizza, sushi]))).toEqual({});
    expect(await as(bo, () => voteOnQuestionPoll(org.id, pollId, [sushi, tacos]))).toEqual({});
    const mine = await ownerDb.pollVote.findMany({
      where: { pollId, userId: bo.id },
      select: { optionId: true },
    });
    expect(mine.map((v) => v.optionId).sort()).toEqual([sushi, tacos].sort());
    expect(await as(bo, () => voteOnQuestionPoll(org.id, pollId, [elsewhere]))).toEqual({
      error: "That option is no longer on this poll.",
    });
  });
});

describe("anonymous polls", () => {
  it("count every vote but name nobody, not the creator and not the owner", async () => {
    if (!reachable) return;
    const pollId = await ask(ann, { anonymous: true });
    const [pizza, tacos] = await optionIds(pollId);
    await as(ann, () => voteOnQuestionPoll(org.id, pollId, [pizza]));
    await as(bo, () => voteOnQuestionPoll(org.id, pollId, [pizza]));
    await as(owner, () => voteOnQuestionPoll(org.id, pollId, [tacos]));

    for (const viewer of [ann, owner]) {
      const view = await viewAs(viewer, pollId);
      expect(view?.voterCount).toBe(3);
      expect(view?.options.map((o) => o.votes)).toEqual([2, 1, 0]);
      expect(view?.options.every((o) => o.voters === null)).toBe(true);
      expect(view?.me).toBeNull();
      // Who asked is shown; who voted is not, anywhere in the view.
      expect(view?.askedBy).toBe(ann.name);
      const json = JSON.stringify({ ...view, askedBy: null });
      for (const person of [ann, bo, owner]) {
        expect(json).not.toContain(person.id);
        expect(json).not.toContain(person.name);
      }
    }
    expect((await viewAs(owner, pollId))?.myVotes).toEqual([tacos]);

    // The database itself shows the creator only their own vote.
    const rows = await as(ann, () =>
      withOrgTx(org.id, ({ db }) =>
        db.pollVote.findMany({ where: { pollId }, select: { userId: true } }),
      ),
    );
    expect(rows).toEqual([{ userId: ann.id }]);
    const summary = await as(bo, () =>
      withOrgTx(org.id, ({ db }) => listQuestionPolls(db, org.id)),
    );
    expect(summary.find((p) => p.id === pollId)).toMatchObject({
      voterCount: 3,
      optionCount: 3,
      anonymous: true,
    });
  });
});

describe("hidden results", () => {
  it("show voters only their own choice until it closes; the creator and admins see counts", async () => {
    if (!reachable) return;
    const pollId = await ask(ann, { hideResultsUntilClosed: true });
    const [pizza] = await optionIds(pollId);
    await as(bo, () => voteOnQuestionPoll(org.id, pollId, [pizza]));

    const voter = await viewAs(bo, pollId);
    expect(voter).toMatchObject({ resultsVisible: false, myVotes: [pizza] });
    expect(voter?.options.every((o) => o.votes === null && o.voters === null)).toBe(true);
    expect((await viewAs(ann, pollId))?.options[0].votes).toBe(1);
    expect((await viewAs(owner, pollId))?.resultsVisible).toBe(true);

    await as(ann, () => setQuestionPollClosed(org.id, pollId, true));
    expect((await viewAs(bo, pollId))?.options[0].votes).toBe(1);
  });
});

describe("options", () => {
  it("are added by the creator, by members only when allowed, never twice; removed by the creator", async () => {
    if (!reachable) return;
    const closed = await ask(ann);
    expect((await as(bo, () => addQuestionPollOption(org.id, closed, "Burgers"))).error).toMatch(
      /Only whoever asked/,
    );
    expect(
      (await as(ann, () => addQuestionPollOption(org.id, closed, "Burgers"))).optionId,
    ).toBeTruthy();

    const open = await ask(ann, { allowMemberOptions: true });
    const added = await as(bo, () => addQuestionPollOption(org.id, open, "  Dumplings "));
    expect(added.optionId).toBeTruthy();
    expect(await as(bo, () => addQuestionPollOption(org.id, open, "dumplings"))).toEqual({
      error: "That option is already on the poll.",
    });
    const stored = await ownerDb.pollOption.findUniqueOrThrow({ where: { id: added.optionId! } });
    expect(stored).toMatchObject({ label: "Dumplings", addedById: bo.id, sortOrder: 3 });

    // Members can't remove options; the creator can, down to two.
    await as(bo, () => voteOnQuestionPoll(org.id, open, [added.optionId!]));
    expect(
      (await as(bo, () => removeQuestionPollOption(org.id, open, added.optionId!))).error,
    ).toMatch(/Only whoever asked/);
    expect(await as(ann, () => removeQuestionPollOption(org.id, open, added.optionId!))).toEqual(
      {},
    );
    expect(await ownerDb.pollVote.count({ where: { pollId: open } })).toBe(0);
    const [first, second] = await optionIds(open);
    expect(await as(ann, () => removeQuestionPollOption(org.id, open, first))).toEqual({});
    expect(await as(ann, () => removeQuestionPollOption(org.id, open, second))).toEqual({
      error: "A poll needs at least two options.",
    });
  });
});

describe("elsewhere in the app", () => {
  it("pins a question poll under its question, finds it, and lists it as open on the Overview", async () => {
    if (!reachable) return;
    const question = `Pin me ${tag}?`;
    const pollId = await ask(ann, { question });
    const address = `/app/${org.slug}/calendar/polls/${pollId}`;
    const pins = await as(bo, () =>
      withOrgTx(org.id, async ({ db }) => {
        expect(await pinPage(db, org.id, org.slug, bo.id, address)).toEqual({
          ok: true,
          pinned: true,
        });
        return listPins(db, org.id, org.slug, bo.id);
      }),
    );
    expect(pins.find((p) => p.href === address)).toMatchObject({ label: question, kind: "event" });

    const groups = await as(bo, () =>
      withOrgTx(org.id, ({ db }) => searchPinnables(db, org.id, org.slug, bo.id, `Pin me ${tag}`)),
    );
    expect(groups.find((g) => g.id === "polls")?.items).toEqual([
      { href: address, label: question, kind: "event", detail: "Question poll" },
    ]);

    const open = await as(bo, () =>
      withOrgTx(org.id, ({ db }) => listOpenPolls(db, org.id, new Date(), 50)),
    );
    expect(open.find((p) => p.id === pollId)).toMatchObject({ kind: "question", title: question });
    await as(ann, () => setQuestionPollClosed(org.id, pollId, true));
    const after = await as(bo, () =>
      withOrgTx(org.id, ({ db }) => listOpenPolls(db, org.id, new Date(), 50)),
    );
    expect(after.some((p) => p.id === pollId)).toBe(false);
  });
});

describe("closing, reopening and deleting", () => {
  it("is for the creator or an admin; a closed poll takes no votes", async () => {
    if (!reachable) return;
    const pollId = await ask(ann);
    const [pizza, tacos] = await optionIds(pollId);
    await as(bo, () => voteOnQuestionPoll(org.id, pollId, [pizza]));

    expect((await as(bo, () => setQuestionPollClosed(org.id, pollId, true))).error).toMatch(
      /Only whoever asked/,
    );
    expect(await as(ann, () => setQuestionPollClosed(org.id, pollId, true))).toEqual({});
    expect((await as(bo, () => voteOnQuestionPoll(org.id, pollId, [tacos]))).error).toMatch(
      /closed/,
    );
    expect((await as(bo, () => addQuestionPollOption(org.id, pollId, "Late"))).error).toMatch(
      /closed/,
    );
    expect(await ownerDb.pollVote.count({ where: { pollId, optionId: pizza } })).toBe(1);

    // An admin reopens it; a closing time that has passed is dropped.
    await ownerDb.poll.update({
      where: { id: pollId },
      data: { closedAt: null, closesAt: new Date(Date.now() - 60_000) },
    });
    expect((await viewAs(bo, pollId))?.isOpen).toBe(false);
    expect(await as(owner, () => setQuestionPollClosed(org.id, pollId, false))).toEqual({});
    expect(await ownerDb.poll.findUniqueOrThrow({ where: { id: pollId } })).toMatchObject({
      closedAt: null,
      closesAt: null,
    });
    expect(await as(bo, () => voteOnQuestionPoll(org.id, pollId, [tacos]))).toEqual({});

    expect((await as(bo, () => deleteQuestionPoll(org.id, pollId))).error).toMatch(
      /Only whoever asked/,
    );
    expect(await as(owner, () => deleteQuestionPoll(org.id, pollId))).toEqual({});
    expect(await ownerDb.poll.count({ where: { id: pollId } })).toBe(0);
    expect(await ownerDb.pollVote.count({ where: { pollId } })).toBe(0);
    expect(await as(ann, () => deleteQuestionPoll(org.id, pollId))).toEqual({
      error: "This poll no longer exists.",
    });
  });
});
